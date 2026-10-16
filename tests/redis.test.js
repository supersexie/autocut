import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { RedisMemoryServer } from 'redis-memory-server';
import WebSocket from 'ws';
import { openDb } from '../src/db.js';
import { openQueue, postgresQueue } from '../src/queue.js';
import { attachLive } from '../src/live.js';
import { openStorage } from '../src/storage.js';
import { startWorker, sweep } from '../src/worker.js';

// The Redis job list (what runs on AWS ElastiCache), against a real Redis built for the tests.
let redis, url;
before(async () => {
  redis = new RedisMemoryServer();
  url = `redis://${await redis.getHost()}:${await redis.getPort()}`;
});
after(async () => redis?.stop());

async function fresh() {
  const db = await openDb();
  const queue = await openQueue({ db, url });
  await queue.redis.flushall();
  return { db, queue, close: async () => (await queue.close(), await db.close()) };
}
const newCut = async (db, userId = 'u1', extra = {}) => {
  const id = randomUUID();
  await db.createCut({ id, userId, stage: 'queued', run: extra.run ?? {} });
  return id;
};

test('redis: 20 workers claiming 100 jobs at once never get the same one', async () => {
  const { db, queue, close } = await fresh();
  const ids = [];
  for (let i = 0; i < 100; i++) {
    const id = await newCut(db);
    await queue.addTask({ cutId: id, kind: 'cut' });
    ids.push(id);
  }
  const claimed = [];
  await Promise.all(Array.from({ length: 20 }, async (_, w) => {
    for (;;) {
      const t = await queue.claimTask(['cut'], `w${w}`);
      if (!t) break;
      claimed.push(t.cut_id);
    }
  }));
  assert.equal(claimed.length, 100);
  assert.equal(new Set(claimed).size, 100);
  assert.deepEqual(await queue.load(['cut']), { queued: 0, running: 100 });
  await close();
});

for (const kind of ['postgres', 'redis']) {
  test(`${kind}: one account's batch can't hold everyone else up (per-account limit)`, async () => {
    const db = await openDb();
    const queue = kind === 'redis' ? await openQueue({ db, url, perUser: { cut: 3, render: 2 } }) : postgresQueue(db, { cut: 3, render: 2 });
    if (kind === 'redis') await queue.redis.flushall();
    const add = async (userId, k = 'cut') => {
      const id = await newCut(db, userId);
      await queue.addTask({ cutId: id, userId, kind: k });
      return id;
    };
    const batch = [];
    for (let i = 0; i < 6; i++) batch.push(await add('alice'));
    const bob = await add('bob');
    const owner = async (t) => t && (await db.getCut(t.cut_id)).user_id;
    const got = [];
    for (let i = 0; i < 5; i++) got.push(await queue.claimTask(['cut'], 'w'));
    // Alice's first three run; then Bob's, though it came later; then nothing (Alice is at her limit).
    assert.deepEqual(await Promise.all(got.map(owner)), ['alice', 'alice', 'alice', 'bob', null]);
    // One of Alice's finishes: her next one starts.
    await queue.finishTask(got[0].id);
    const next = await queue.claimTask(['cut'], 'w');
    assert.equal(next.cut_id, batch[3]);
    // Limits are per kind: her exports and previews still go.
    await add('alice', 'render');
    await add('alice', 'preview');
    assert.deepEqual((await Promise.all([queue.claimTask(['render'], 'w'), queue.claimTask(['preview'], 'w')])).map((t) => t?.kind), ['render', 'preview']);
    // A job handed back or stopped frees its place too.
    await queue.releaseTasks('w');
    assert.equal(await owner(await queue.claimTask(['cut'], 'w2')), 'alice');
    assert.ok(bob);
    await queue.close?.();
    await db.close();
  });
}

test('redis: previews go first, scheduled jobs wait for their time', async () => {
  const { db, queue, close } = await fresh();
  const a = await newCut(db);
  await queue.addTask({ cutId: a, kind: 'cut' });
  await queue.addTask({ cutId: a, kind: 'render', priority: 2 });
  await queue.addTask({ cutId: a, kind: 'preview', payload: { key: 'k1' }, priority: 10 });
  await queue.addTask({ cutId: a, kind: 'cut', runAt: Date.now() + 60_000 });
  const order = [];
  for (let t; (t = await queue.claimTask(['preview', 'cut', 'render'])); ) order.push(t.kind);
  assert.deepEqual(order, ['preview', 'render', 'cut']); // the scheduled cut isn't due
  assert.equal((await queue.load(['cut'])).queued, 0);
  // Its time comes.
  await queue.redis.zadd('{ac}:later:cut', Date.now() - 1, (await queue.redis.zrange('{ac}:later:cut', 0, 0))[0]);
  assert.equal((await queue.claimTask(['cut'])).kind, 'cut');
  await close();
});

test("redis: a dead worker's job comes back, and fails (refunded) after 3 tries; a shutting-down worker hands its jobs back", async () => {
  const { db, queue, close } = await fresh();
  const id = await newCut(db, 'u9');
  await db.addUse('u9', 1);
  await queue.addTask({ cutId: id, kind: 'cut' });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t = await queue.claimTask(['cut'], 'dead');
    assert.equal(t.attempts, attempt);
    await queue.redis.zadd('{ac}:running:cut', Date.now() - 10 * 60_000, t.id);
    await sweep(db, queue);
  }
  assert.equal((await db.getCut(id)).stage, 'failed');
  assert.equal(await db.used('u9'), 0);
  assert.equal(await queue.claimTask(['cut']), null);

  const b = await newCut(db);
  await queue.addTask({ cutId: b, kind: 'render' });
  const t = await queue.claimTask(['render'], 'leaving');
  await queue.releaseTasks('leaving');
  const again = await queue.claimTask(['render'], 'other');
  assert.equal(again.id, t.id);
  assert.equal(again.attempts, 1);
  await close();
});

test('redis: stopping a cut ends its job at the next progress report; changes are published', async () => {
  const { db, queue, close } = await fresh();
  const id = await newCut(db);
  const seen = [];
  const off = queue.subscribe((e) => e.id === id && seen.push(e), { all: true });
  await new Promise((r) => setTimeout(r, 100)); // subscribed
  assert.equal(await queue.progress(id, { stage: 'listening', progress: 0.4 }), false);
  assert.deepEqual(await queue.live(id), { stage: 'listening', progress: 0.4, render: undefined, stopped: false });
  await queue.markStopped(id);
  assert.equal(await queue.progress(id, { stage: 'cutting', progress: 0.9 }), true); // stopped
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen.map((e) => e.stage), ['listening']);
  off();
  // Queued previews replaced, latest preview found by key.
  await queue.addTask({ cutId: id, kind: 'preview', payload: { key: 'a' } });
  await queue.dropWaitingPreviews(id);
  await queue.addTask({ cutId: id, kind: 'preview', payload: { key: 'b' } });
  assert.equal((await queue.taskFor(id, 'preview', 'a')).status, 'stopped');
  assert.equal((await queue.taskFor(id, 'preview', 'b')).status, 'queued');
  await close();
});

test('redis: workers cut every take once and stream progress', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autocut-redis-'));
  const take = path.join(dir, 'take.mp4');
  await promisify(execFile)(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=2', '-filter_complex', '[0:a]apad=pad_dur=1[a]', '-map', '1:v', '-map', '[a]', '-t', '2', take]);
  const realFetch = globalThis.fetch;
  process.env.DEEPGRAM_API_KEY = 'test';
  globalThis.fetch = async () => new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ words: [{ word: 'hi', punctuated_word: 'Hi.', start: 0.1, end: 0.6 }] }] }] } }));
  const { db, queue, close } = await fresh();
  const storage = await openStorage({ dir: path.join(dir, 'blobs') });
  const stages = new Map();
  queue.subscribe((e) => e.stage && stages.set(e.id, [...(stages.get(e.id) ?? []), e.stage]), { all: true });
  const ids = [];
  try {
    for (let i = 0; i < 6; i++) {
      const key = `users/u7/uploads/${randomUUID()}.mp4`;
      const copy = path.join(dir, `t${i}.mp4`);
      await promisify(execFile)('cp', [take, copy]);
      await storage.put(copy, key);
      const id = randomUUID();
      await db.createCut({ id, userId: 'u7', stage: 'queued', run: { uploads: [key], flips: [false], options: {} } });
      await queue.addTask({ cutId: id, kind: 'cut' });
      ids.push(id);
    }
    const workers = [0, 1].map((n) => startWorker({ db, queue, storage, workDir: path.join(dir, `w${n}`), concurrency: 4, idleMs: 20, kinds: ['cut'], log: () => {} }));
    const until = Date.now() + 60_000;
    while (Date.now() < until && !(await Promise.all(ids.map((id) => db.getCut(id)))).every((c) => c.stage === 'ready')) await new Promise((r) => setTimeout(r, 100));
    workers.forEach((w) => w.stop());
    const cuts = await Promise.all(ids.map((id) => db.getCut(id)));
    assert.ok(cuts.every((c) => c.stage === 'ready' && c.result.words.length === 1));
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(ids.every((id) => (stages.get(id) ?? []).at(-1) === 'ready'), 'every cut streamed its stages ending in ready');
    assert.deepEqual(await queue.load(['cut', 'preview']).then((l) => l.running), 0);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DEEPGRAM_API_KEY;
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('live: a phone gets pushes for its own cuts only, after signing in', async () => {
  const { db, queue, close } = await fresh();
  const mine = await newCut(db, 'alice');
  const theirs = await newCut(db, 'bob');
  const server = http.createServer();
  const accountFrom = async (req) => (req.headers.authorization === 'Bearer good' ? { id: 'alice' } : null);
  const live = attachLive(server, { queue, db, accountFrom, log: () => {} });
  await new Promise((r) => server.listen(0, r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/live`);
  const got = [];
  ws.on('message', (m) => got.push(JSON.parse(m)));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'watch', ids: [mine] })); // before signing in: ignored
  ws.send(JSON.stringify({ type: 'auth', token: 'good' }));
  await new Promise((r) => setTimeout(r, 150));
  ws.send(JSON.stringify({ type: 'watch', ids: [mine, theirs] }));
  await new Promise((r) => setTimeout(r, 150));
  await queue.progress(mine, { stage: 'cutting', progress: 0.5 });
  await queue.progress(theirs, { stage: 'cutting', progress: 0.5 });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(got.map((m) => m.type), ['ready', 'cut']);
  assert.equal(got[1].id, mine);
  assert.equal(got[1].progress, 0.5);
  // This server listens to the watched cut's channel only, and stops once the phone goes away.
  const listeners = async (id) => (await queue.redis.pubsub('NUMSUB', `{ac}:ev:${id}`))[1];
  assert.equal(await listeners(mine), 1);
  assert.equal(await listeners(theirs), 0);
  ws.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await listeners(mine), 0);
  live.close();
  server.close();
  await close();
});
