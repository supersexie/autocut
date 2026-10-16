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

test('each worker sends Deepgram only so many requests at once, and retries when it is busy', async () => {
  const { withSlot, withRetries } = await import('../src/transcribe.js');
  let now = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      withSlot(async () => {
        peak = Math.max(peak, ++now);
        await new Promise((r) => setTimeout(r, 5));
        now--;
      }, 3)
    )
  );
  assert.equal(peak, 3);

  let calls = 0;
  const busyTwice = () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error('busy'), { status: 429 });
    return 'words';
  };
  assert.equal(await withRetries(busyTwice, { sleep: async () => {} }), 'words');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(withRetries(() => { calls++; throw Object.assign(new Error('bad audio'), { status: 400 }); }, { sleep: async () => {} }));
  assert.equal(calls, 1); // a bad request isn't retried
});

test('the autoscaler sizes each pool by its jobs, adds copies at once and removes them slowly', async () => {
  const { parsePools, desiredCopies, nextCopies, startScaler } = await import('../src/scaler.js');
  const [cut, render] = parsePools('cut=svc_c:16:1:10,render=svc_r:6:2:40,bogus=x:1:1:1');
  assert.deepEqual(cut, { name: 'cut', kinds: ['cut'], serviceId: 'svc_c', per: 16, min: 1, max: 10 });
  assert.deepEqual(render.kinds, ['render', 'preview']);
  assert.equal(desiredCopies({ queued: 0, running: 0 }, render), 2); // never below min
  assert.equal(desiredCopies({ queued: 90, running: 10 }, cut), 7);
  assert.equal(desiredCopies({ queued: 5000, running: 0 }, cut), 10); // never above max
  const t = 10 * 60_000;
  assert.equal(nextCopies(2, 7, 0, t), 7); // up straight away
  assert.equal(nextCopies(7, 2, t - 60_000, t), null); // down only after a quiet spell
  assert.equal(nextCopies(7, 2, 0, t), 6); // and one at a time

  const sent = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ headers: init.headers, body });
    const data = body.query.startsWith('query') ? { serviceInstance: { numReplicas: 1 } } : { serviceInstanceUpdate: true };
    return new Response(JSON.stringify({ data }));
  };
  const db = { load: async () => ({ queued: 40, running: 8 }) };
  const scaler = startScaler({ db, fetchImpl, log: () => {}, env: { RAILWAY_API_TOKEN: 'tok', RAILWAY_ENVIRONMENT_ID: 'env_1', SCALE_POOLS: 'cut=svc_c:16:1:10' } });
  await scaler.step(parsePools('cut=svc_c:16:1:10')[0]);
  scaler.stop();
  assert.equal(sent[0].headers['Project-Access-Token'], 'tok');
  assert.deepEqual(sent[1].body.variables, { serviceId: 'svc_c', environmentId: 'env_1', input: { numReplicas: 3 } });
  assert.equal(startScaler({ db, env: {} }), null); // off unless configured
});

test('a worker shutting down hands its unfinished jobs straight back', async () => {
  const db = await openDb();
  const id = await newCut(db);
  await db.addTask({ cutId: id, kind: 'cut' });
  const t = await db.claimTask(['cut'], 'dying-worker');
  assert.equal(t.attempts, 1);
  await db.releaseTasks('dying-worker');
  const again = await db.claimTask(['cut'], 'other-worker');
  assert.equal(again.id, t.id);
  assert.equal(again.attempts, 1); // the handed-back try doesn't count against it
  await db.close();
});

test('workers run many cuts at once when Deepgram does the listening', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autocut-many-'));
  const take = path.join(dir, 'take.mp4');
  await promisify(execFile)(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=2', '-filter_complex', '[0:a]apad=pad_dur=1[a]', '-map', '1:v', '-map', '[a]', '-t', '2', take]);
  const realFetch = globalThis.fetch;
  process.env.DEEPGRAM_API_KEY = 'test';
  let inDeepgram = 0;
  let peak = 0;
  globalThis.fetch = async () => {
    peak = Math.max(peak, ++inDeepgram);
    await new Promise((r) => setTimeout(r, 300)); // Deepgram thinking
    inDeepgram--;
    return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ words: [{ word: 'hi', punctuated_word: 'Hi.', start: 0.1, end: 0.6 }] }] }] } }));
  };
  const db = await openDb();
  const storage = await openStorage({ dir: path.join(dir, 'blobs') });
  const ids = [];
  try {
    for (let i = 0; i < 24; i++) {
      const key = `users/u7/uploads/${randomUUID()}.mp4`;
      const copy = path.join(dir, `t${i}.mp4`);
      await promisify(execFile)('cp', [take, copy]);
      await storage.put(copy, key);
      const id = randomUUID();
      await db.createCut({ id, userId: 'u7', stage: 'queued', run: { uploads: [key], flips: [false], options: {} } });
      await db.addTask({ cutId: id, kind: 'cut' });
      ids.push(id);
    }
    const started = Date.now();
    const workers = [0, 1].map((n) => startWorker({ db, storage, workDir: path.join(dir, `w${n}`), concurrency: 8, idleMs: 20, kinds: ['cut'], log: () => {} }));
    while (Date.now() - started < 90_000) {
      const cuts = await Promise.all(ids.map((id) => db.getCut(id)));
      if (cuts.every((c) => c.stage === 'ready')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    workers.forEach((w) => w.stop());
    const cuts = await Promise.all(ids.map((id) => db.getCut(id)));
    assert.ok(cuts.every((c) => c.stage === 'ready'), cuts.map((c) => c.stage).join(','));
    assert.ok(peak >= 6, `only ${peak} Deepgram requests at once`); // many in flight, not one by one
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DEEPGRAM_API_KEY;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
