import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { openDb } from '../src/db.js';
import { openStorage } from '../src/storage.js';
import { startWorker, sweep } from '../src/worker.js';
import { effectivePlan, revenueCatChange, verifyWhop, whopChange, whopPlanMap } from '../src/billing.js';
import { deepgramWords, toPcm16 } from '../src/transcribe.js';
import { parseRender } from '../src/edits.js';

const newCut = async (db, userId = 'u1', extra = {}) => {
  const id = randomUUID();
  await db.createCut({ id, userId, stage: 'queued', run: extra.run ?? {} });
  return id;
};

test('two workers never claim the same job, and a job scheduled for later waits', async () => {
  const db = await openDb();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(await newCut(db));
  for (const id of ids) await db.addTask({ cutId: id, kind: 'cut' });
  const later = await newCut(db);
  await db.addTask({ cutId: later, kind: 'cut', runAt: Date.now() + 60_000 });
  const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => db.claimTask(['cut'], `w${i % 2}`)));
  const got = claims.filter(Boolean).map((t) => t.cut_id);
  assert.equal(got.length, 6);
  assert.equal(new Set(got).size, 6);
  assert.ok(!got.includes(later));
  await db.close();
});

test('previews go before cuts, and a newer preview replaces one still waiting', async () => {
  const db = await openDb();
  const a = await newCut(db);
  await db.addTask({ cutId: a, kind: 'cut' });
  await db.addTask({ cutId: a, kind: 'preview', payload: { key: 'old' }, priority: 10 });
  await db.dropWaitingPreviews(a);
  await db.addTask({ cutId: a, kind: 'preview', payload: { key: 'new' }, priority: 10 });
  const first = await db.claimTask(['cut', 'preview']);
  assert.equal(first.kind, 'preview');
  assert.equal(first.payload.key, 'new');
  assert.equal((await db.claimTask(['cut', 'preview'])).kind, 'cut');
  assert.equal(await db.claimTask(['cut', 'preview']), null);
  await db.close();
});

test("a job whose worker died goes back on the list, and fails (with the edit refunded) after 3 tries", async () => {
  const db = await openDb();
  const id = await newCut(db, 'u2');
  await db.addUse('u2', 1);
  await db.addTask({ cutId: id, kind: 'cut' });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t = await db.claimTask(['cut']);
    assert.equal(t?.attempts, attempt);
    await db.query(`update tasks set heartbeat = now() - interval '10 minutes' where id = $1`, [t.id]);
    await sweep(db);
  }
  const cut = await db.getCut(id);
  assert.equal(cut.stage, 'failed');
  assert.equal(await db.used('u2'), 0);
  assert.equal(await db.claimTask(['cut']), null);
  await db.close();
});

test('edit counts per month never go below zero', async () => {
  const db = await openDb();
  await db.addUse('u3', 1);
  await db.addUse('u3', 1);
  await db.addUse('u3', -1);
  assert.equal(await db.used('u3'), 1);
  await db.addUse('u3', -5);
  assert.equal(await db.used('u3'), 0);
  await db.close();
});

test('consent is recorded, and agreeing to AI use can change on its own', async () => {
  const db = await openDb();
  await db.setConsent('u4', { termsVersion: '2026-10-16', ai: false });
  let c = await db.consentOf('u4');
  assert.equal(c.terms_version, '2026-10-16');
  assert.equal(c.ai, false);
  await db.setConsent('u4', { ai: true });
  c = await db.consentOf('u4');
  assert.equal(c.terms_version, '2026-10-16');
  assert.equal(c.ai, true);
  assert.ok(c.ai_at);
  await db.close();
});

test('Whop webhooks are checked with the Standard Webhooks signature', () => {
  const secret = 'ws_test_secret';
  const raw = '{"type":"membership.activated"}';
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const sig = createHmac('sha256', secret).update(`msg_1.${ts}.${raw}`).digest('base64');
  const headers = { 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
  assert.ok(verifyWhop(headers, raw, secret, now));
  assert.ok(!verifyWhop(headers, raw + ' ', secret, now)); // body changed
  assert.ok(!verifyWhop(headers, raw, 'ws_other', now)); // wrong secret
  assert.ok(!verifyWhop(headers, raw, secret, now + 10 * 60_000)); // too old
});

test('Whop and Apple purchases become plans; the best active one is in force', () => {
  const map = whopPlanMap('starter-monthly=plan_s, pro-yearly=plan_p');
  assert.deepEqual(map.plan_p, { plan: 'pro', billing: 'yearly' });
  const on = whopChange({ type: 'membership.activated', data: { id: 'mem_1', plan: { id: 'plan_p' }, metadata: { user_id: 'u5' } } }, map);
  assert.deepEqual([on.userId, on.plan, on.active], ['u5', 'pro', true]);
  assert.equal(whopChange({ type: 'membership_went_invalid', data: { plan_id: 'plan_s', metadata: { user_id: 'u5' } } }, map).active, false);
  assert.equal(whopChange({ type: 'membership.activated', data: { plan: { id: 'plan_unknown' }, metadata: { user_id: 'u5' } } }, map), null);

  const rc = revenueCatChange({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'u5', product_id: 'autocut.ultimate.monthly', expiration_at_ms: Date.now() + 864e5 } });
  assert.deepEqual([rc.plan, rc.active], ['ultimate', true]);
  assert.equal(revenueCatChange({ event: { type: 'EXPIRATION', app_user_id: 'u5', entitlement_ids: ['pro'] } }).active, false);
  assert.equal(revenueCatChange({ event: { type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:x', product_id: 'pro' } }), null);

  const now = Date.now();
  assert.equal(effectivePlan({ whop: { plan: 'pro', active: true }, apple: { plan: 'starter', active: true } }), 'pro');
  assert.equal(effectivePlan({ whop: { plan: 'pro', active: false }, apple: { plan: 'starter', active: true } }), 'starter');
  assert.equal(effectivePlan({ apple: { plan: 'ultimate', active: true, until: now - 1000 } }, now), null); // lapsed
  assert.equal(effectivePlan(undefined), null);
});

test("Deepgram's words come back as ours, ums kept, clamped to the audio", () => {
  const body = { results: { channels: [{ alternatives: [{ words: [
    { word: 'um', punctuated_word: 'Um,', start: 0.1, end: 0.3 },
    { word: 'hello', punctuated_word: 'hello', start: 0.4, end: 0.4 },
    { word: 'there', punctuated_word: 'there.', start: 0.9, end: 9 },
  ] }] }] } };
  const words = deepgramWords(body, 2);
  assert.deepEqual(words.map((w) => w.text), ['Um,', 'hello', 'there.']);
  assert.ok(words[1].end > words[1].start); // zero-length word given a little length
  assert.equal(words[2].end, 2);
  assert.equal(toPcm16(new Float32Array([0, 1, -1, 2])).readInt16LE(6), 32767);
});

test('export requests are checked and clamped', () => {
  const out = parseRender({ clips: [{ start: -1, end: 99, speed: 50 }], height: 999, music: { upload: 'x.mp3', volume: 5 } }, { duration: 10, overlapAllowed: false });
  assert.deepEqual(out.edit.clips[0], { start: 0, end: 10, speed: 10, volume: 1 });
  assert.equal(out.edit.height, undefined);
  assert.equal(out.edit.overlapAudio, false);
  assert.equal(out.music.volume, 1);
  assert.equal(parseRender({ clips: [] }, { duration: 10 }).error, 'There is nothing left in this cut to export.');
});

test('two workers sharing one job list cut every take exactly once', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autocut-scale-'));
  // A short take: a tone with a pause, standing in for speech; Deepgram is faked below.
  const take = path.join(dir, 'take.mp4');
  await promisify(execFile)(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=3',
    '-filter_complex', '[0:a]apad=pad_dur=2[a]', '-map', '2:v', '-map', '[a]', '-t', '3', '-shortest', take]);
  const realFetch = globalThis.fetch;
  process.env.DEEPGRAM_API_KEY = 'test';
  globalThis.fetch = async () => new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ words: [{ word: 'hello', punctuated_word: 'Hello', start: 0.1, end: 0.6 }, { word: 'world', punctuated_word: 'world.', start: 0.6, end: 0.95 }] }] }] } }));
  const db = await openDb();
  const storage = await openStorage({ dir: path.join(dir, 'blobs') });
  const seen = [];
  const ids = [];
  try {
    for (let i = 0; i < 4; i++) {
      const key = `users/u6/uploads/${randomUUID()}.mp4`;
      const copy = path.join(dir, `t${i}.mp4`);
      await promisify(execFile)('cp', [take, copy]);
      await storage.put(copy, key);
      const id = randomUUID();
      await db.createCut({ id, userId: 'u6', stage: 'queued', run: { uploads: [key], flips: [false], options: { plan: { maxGap: 0.3 } } } });
      await db.addTask({ cutId: id, kind: 'cut' });
      ids.push(id);
    }
    const log = (line) => line.endsWith(' ready') && seen.push(line);
    const workers = [0, 1].map((n) => startWorker({ db, storage, workDir: path.join(dir, `w${n}`), idleMs: 50, kinds: ['cut'], log }));
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const cuts = await Promise.all(ids.map((id) => db.getCut(id)));
      if (cuts.every((c) => c.stage === 'ready' || c.stage === 'failed')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    workers.forEach((w) => w.stop());
    const cuts = await Promise.all(ids.map((id) => db.getCut(id)));
    assert.deepEqual(cuts.map((c) => c.stage), ['ready', 'ready', 'ready', 'ready']);
    assert.equal(seen.length, 4); // each cut once, not twice
    assert.ok(cuts.every((c) => c.result.words.length === 2 && c.source.startsWith('users/u6/uploads/'))); // a single take is its own source: kept as sent
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DEEPGRAM_API_KEY;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
