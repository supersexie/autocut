import { EventEmitter } from 'node:events';
import { STALE_MS, workerName } from './db.js';

// The job list and live progress, in one of two places:
//   Postgres (default): the `tasks` table, progress on the cut's row. Fine to thousands of jobs at once.
//   Redis (REDIS_URL, e.g. AWS ElastiCache): built for hundreds of thousands. Jobs live in sorted sets,
//     claimed atomically by a Lua script (never twice), progress in a hash per cut, and every change
//     published on that cut's own channel. An API server listens only to the cuts its connected
//     phones are watching, so each change reaches one server, not all of them (see live.js).
// Both give the same calls, so the API and workers don't care which is in use.

const MAX_ATTEMPTS = 3;
const KINDS = ['preview', 'cut', 'render'];

// How many cuts and exports one account runs at once; its other jobs wait their turn while other
// people's go ahead (CapCut-style fairness: a 10-video batch doesn't hold everyone else up).
// Previews aren't limited: they're small and the person is waiting on them in the editor.
export const perUserLimits = (env = process.env) => ({
  cut: Math.max(1, Number(env.PER_USER_CUTS ?? 3)),
  render: Math.max(1, Number(env.PER_USER_EXPORTS ?? 2)),
});

export async function openQueue({ db, url = process.env.REDIS_URL, perUser = perUserLimits() } = {}) {
  return url ? redisQueue(db, url, perUser) : postgresQueue(db, perUser);
}

// ---------------- Postgres: what db.js already does, plus in-process change events ----------------
export function postgresQueue(db, perUser = perUserLimits()) {
  const events = new EventEmitter().setMaxListeners(0);
  return {
    kind: 'postgres',
    addTask: (t) => db.addTask(t),
    claimTask: (kinds, worker) => db.claimTask(kinds, worker, perUser),
    heartbeat: (id) => db.heartbeat(id),
    finishTask: (id, status, error) => db.finishTask(id, status, error),
    requeueStale: (ms) => db.requeueStale(ms),
    releaseTasks: (worker) => db.releaseTasks(worker),
    stopTasks: (cutId, kind) => db.stopTasks(cutId, kind),
    taskFor: (cutId, kind, key) => db.taskFor(cutId, kind, key),
    dropWaitingPreviews: (cutId) => db.dropWaitingPreviews(cutId),
    stats: () => db.queueStats(),
    load: (kinds) => db.load(kinds),
    /** Progress for a cut. Resolves true if the cut was stopped (the job should end). */
    async progress(cutId, fields) {
      const row = await db.updateCut(cutId, fields, { unlessStopped: true });
      events.emit('cut', { id: cutId, ...fields });
      return !row;
    },
    live: async () => null, // progress is on the row itself
    markStopped: async () => {},
    publish: (cutId, fields) => events.emit('cut', { id: cutId, ...fields }),
    // Everything happens in this one process, so every change is seen; watching is a no-op.
    watch() {},
    unwatch() {},
    subscribe(fn) {
      events.on('cut', fn);
      return () => events.off('cut', fn);
    },
    close: async () => {},
  };
}

// ---------------- Redis ----------------
// Keys share the {ac} hash tag so they land on one slot (works with Redis Cluster too).
const K = {
  seq: '{ac}:task:seq',
  task: (id) => `{ac}:task:${id}`,
  ready: (kind) => `{ac}:ready:${kind}`, // score: -priority * 1e13 + enqueued ms (lowest first)
  later: (kind) => `{ac}:later:${kind}`, // scheduled: score = run_at ms
  running: (kind) => `{ac}:running:${kind}`, // score = last heartbeat ms
  ofCut: (cutId) => `{ac}:cuttasks:${cutId}`,
  ofWorker: (w) => `{ac}:worker:${w}`,
  userRunning: (kind, user) => `{ac}:userrun:${kind}:${user}`, // that account's running jobs of a kind
  live: (cutId) => `{ac}:live:${cutId}`,
  events: (cutId) => `{ac}:ev:${cutId}`, // pub/sub channel per cut
  allEvents: '{ac}:ev:*',
};
const LIVE_TTL = 3 * 86400; // live progress is only needed while a cut is in flight
const DONE_TTL = 7 * 86400;

// Moves due scheduled jobs into their ready set, then takes the best job across the given kinds
// (highest priority, then oldest) and marks it running. A kind with a per-account limit skips
// jobs of accounts already running that many (looking a few hundred deep), so the next account's
// job goes instead. ARGV: now, worker, then kind and limit (0 = none) pairs.
const CLAIM = `
local now = tonumber(ARGV[1])
local worker = ARGV[2]
-- An account's running set, with jobs that have since finished or gone back dropped.
local function running(kind, user)
  local set = '{ac}:userrun:' .. kind .. ':' .. user
  for _, id in ipairs(redis.call('SMEMBERS', set)) do
    if redis.call('HGET', '{ac}:task:' .. id, 'status') ~= 'running' then redis.call('SREM', set, id) end
  end
  return redis.call('SCARD', set)
end
local best, bestKind, bestScore = nil, nil, nil
for i = 3, #ARGV, 2 do
  local kind, limit = ARGV[i], tonumber(ARGV[i + 1])
  local due = redis.call('ZRANGEBYSCORE', '{ac}:later:' .. kind, '-inf', now, 'LIMIT', 0, 500)
  for _, id in ipairs(due) do
    redis.call('ZREM', '{ac}:later:' .. kind, id)
    local pr = tonumber(redis.call('HGET', '{ac}:task:' .. id, 'priority') or '0')
    redis.call('ZADD', '{ac}:ready:' .. kind, -pr * 1e13 + now, id)
  end
  local list = redis.call('ZRANGE', '{ac}:ready:' .. kind, 0, limit > 0 and 299 or 0, 'WITHSCORES')
  local full = {}
  for j = 1, #list, 2 do
    local id, score = list[j], tonumber(list[j + 1])
    if bestScore ~= nil and score >= bestScore then break end
    local user = limit > 0 and redis.call('HGET', '{ac}:task:' .. id, 'user') or false
    local ok = true
    if user and user ~= '' then
      if full[user] == nil then full[user] = running(kind, user) >= limit end
      ok = not full[user]
    end
    if ok then
      best, bestKind, bestScore = id, kind, score
      break
    end
  end
end
if not best then return nil end
redis.call('ZREM', '{ac}:ready:' .. bestKind, best)
local key = '{ac}:task:' .. best
redis.call('HSET', key, 'status', 'running', 'locked_by', worker, 'heartbeat', now)
redis.call('HINCRBY', key, 'attempts', 1)
redis.call('ZADD', '{ac}:running:' .. bestKind, now, best)
redis.call('SADD', '{ac}:worker:' .. worker, best)
local user = redis.call('HGET', key, 'user')
if user and user ~= '' then redis.call('SADD', '{ac}:userrun:' .. bestKind .. ':' .. user, best) end
return redis.call('HGETALL', key)
`;

// Jobs whose heartbeat is older than the cutoff: back to ready, or failed after MAX tries.
// Returns the failed ones' ids. ARGV: cutoff, now, maxAttempts, kinds…
const SWEEP = `
local cutoff, now, maxA = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local failed = {}
for i = 4, #ARGV do
  local kind = ARGV[i]
  local stale = redis.call('ZRANGEBYSCORE', '{ac}:running:' .. kind, '-inf', cutoff)
  for _, id in ipairs(stale) do
    local key = '{ac}:task:' .. id
    redis.call('ZREM', '{ac}:running:' .. kind, id)
    local w = redis.call('HGET', key, 'locked_by')
    if w then redis.call('SREM', '{ac}:worker:' .. w, id) end
    if tonumber(redis.call('HGET', key, 'attempts') or '0') < maxA then
      local pr = tonumber(redis.call('HGET', key, 'priority') or '0')
      redis.call('HSET', key, 'status', 'queued', 'locked_by', '')
      redis.call('ZADD', '{ac}:ready:' .. kind, -pr * 1e13 + now, id)
    else
      redis.call('HSET', key, 'status', 'failed', 'error', 'worker stopped responding')
      table.insert(failed, id)
    end
  end
end
return failed
`;

// Progress: merge fields into the cut's live hash and publish them, unless the cut was stopped.
// Returns 1 if stopped. KEYS: live hash. ARGV: ttl, channel, cutId, json, field, value…
const PROGRESS = `
if redis.call('HGET', KEYS[1], 'stopped') == '1' then return 1 end
for i = 5, #ARGV, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
redis.call('PUBLISH', ARGV[2], ARGV[4])
return 0
`;

async function redisQueue(db, url, perUser = perUserLimits()) {
  const { default: Redis } = await import('ioredis');
  const r = new Redis(url, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
  const sub = new Redis(url, { maxRetriesPerRequest: null });
  r.defineCommand('claimTask', { numberOfKeys: 0, lua: CLAIM });
  r.defineCommand('sweepTasks', { numberOfKeys: 0, lua: SWEEP });
  r.defineCommand('pushProgress', { numberOfKeys: 1, lua: PROGRESS });

  const parse = (flat) => {
    if (!flat || !flat.length) return null;
    const o = {};
    for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
    return toTask(o);
  };
  const toTask = (o) =>
    o && o.id
      ? { id: Number(o.id), cut_id: o.cut_id, user: o.user || null, kind: o.kind, payload: JSON.parse(o.payload || '{}'), priority: Number(o.priority || 0), status: o.status, attempts: Number(o.attempts || 0), locked_by: o.locked_by || null, error: o.error || null }
      : null;
  const get = async (id) => toTask(await r.hgetall(K.task(id)));
  const tasksOf = async (cutId) => (await Promise.all((await r.smembers(K.ofCut(cutId))).map(get))).filter(Boolean).sort((a, b) => a.id - b.id);
  const unlist = (t) => r.multi().zrem(K.ready(t.kind), t.id).zrem(K.later(t.kind), t.id).zrem(K.running(t.kind), t.id).exec();
  const events = new EventEmitter().setMaxListeners(0);
  const watching = new Map(); // cutId → how many watchers in this process
  let listeningToAll = false;
  sub.on('message', (_channel, msg) => {
    try {
      events.emit('watched', JSON.parse(msg));
    } catch {}
  });
  sub.on('pmessage', (_pattern, _channel, msg) => {
    try {
      events.emit('all', JSON.parse(msg));
    } catch {}
  });

  const q = {
    kind: 'redis',
    redis: r,
    async addTask({ cutId, userId = '', kind, payload = {}, priority = 0, runAt }) {
      const id = await r.incr(K.seq);
      const now = Date.now();
      const at = runAt ? new Date(runAt).getTime() : now;
      const m = r.multi().hset(K.task(id), { id, cut_id: cutId, user: userId ?? '', kind, payload: JSON.stringify(payload), priority, status: 'queued', attempts: 0, run_at: at, created_at: now }).sadd(K.ofCut(cutId), id);
      if (at > now) m.zadd(K.later(kind), at, id);
      else m.zadd(K.ready(kind), -priority * 1e13 + now, id);
      await m.exec();
      return { id };
    },
    claimTask: async (kinds, worker = workerName) => parse(await r.claimTask(Date.now(), worker, ...kinds.flatMap((k) => [k, perUser[k] ?? 0]))),
    async heartbeat(id) {
      const t = await get(id);
      if (t?.status === 'running') await r.multi().hset(K.task(id), 'heartbeat', Date.now()).zadd(K.running(t.kind), 'XX', Date.now(), id).exec();
    },
    async finishTask(id, status = 'done', error = null) {
      const t = await get(id);
      if (!t) return;
      const m = r.multi().hset(K.task(id), { status, error: error ?? '' }).zrem(K.running(t.kind), id).srem(K.ofWorker(t.locked_by ?? ''), id).expire(K.task(id), DONE_TTL);
      if (t.user) m.srem(K.userRunning(t.kind, t.user), id);
      await m.exec();
    },
    async requeueStale(staleMs = STALE_MS) {
      const ids = await r.sweepTasks(Date.now() - staleMs, Date.now(), MAX_ATTEMPTS, ...KINDS);
      return (await Promise.all(ids.map(get))).filter(Boolean);
    },
    async releaseTasks(worker = workerName) {
      for (const id of await r.smembers(K.ofWorker(worker))) {
        const t = await get(id);
        if (t?.status !== 'running') continue;
        await r.multi().zrem(K.running(t.kind), id).hset(K.task(id), { status: 'queued', locked_by: '', attempts: Math.max(0, t.attempts - 1) }).zadd(K.ready(t.kind), -t.priority * 1e13 + Date.now(), id).exec();
      }
      await r.del(K.ofWorker(worker));
    },
    async stopTasks(cutId, kind) {
      for (const t of await tasksOf(cutId)) {
        if (t.kind !== kind || !['queued', 'running'].includes(t.status)) continue;
        await unlist(t);
        await r.hset(K.task(t.id), 'status', 'stopped');
      }
    },
    async taskFor(cutId, kind, key) {
      return (await tasksOf(cutId)).reverse().find((t) => t.kind === kind && t.payload?.key === key) ?? null;
    },
    async dropWaitingPreviews(cutId) {
      for (const t of await tasksOf(cutId)) {
        if (t.kind !== 'preview' || t.status !== 'queued') continue;
        await unlist(t);
        await r.hset(K.task(t.id), 'status', 'stopped');
      }
    },
    async load(kinds) {
      const now = Date.now();
      const m = r.multi();
      for (const k of kinds) m.zcard(K.ready(k)).zcount(K.later(k), '-inf', now).zcard(K.running(k));
      const res = (await m.exec()).map(([, v]) => Number(v));
      let queued = 0, running = 0;
      for (let i = 0; i < kinds.length; i++) {
        queued += res[i * 3] + res[i * 3 + 1];
        running += res[i * 3 + 2];
      }
      return { queued, running };
    },
    stats: () => q.load(KINDS),
    async progress(cutId, fields) {
      const flat = Object.entries(fields).flatMap(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
      return (await r.pushProgress(K.live(cutId), LIVE_TTL, K.events(cutId), cutId, JSON.stringify({ id: cutId, ...fields }), ...flat)) === 1;
    },
    /** A cut's live progress (stage, progress, render), or null. */
    async live(cutId) {
      const h = await r.hgetall(K.live(cutId));
      if (!h || !Object.keys(h).length) return null;
      return { stage: h.stage, progress: h.progress !== undefined ? Number(h.progress) : undefined, render: h.render ? JSON.parse(h.render) : undefined, stopped: h.stopped === '1' };
    },
    /** The user stopped the cut: the worker's next progress report sees it and ends the job. */
    markStopped: (cutId) => r.multi().hset(K.live(cutId), 'stopped', '1', 'stage', 'stopped').expire(K.live(cutId), LIVE_TTL).exec(),
    publish: (cutId, fields) => r.publish(K.events(cutId), JSON.stringify({ id: cutId, ...fields })),
    /** Start (or stop) receiving a cut's changes in this process. Counted, so pairs can overlap. */
    watch(cutId) {
      const n = watching.get(cutId) ?? 0;
      watching.set(cutId, n + 1);
      if (!n) sub.subscribe(K.events(cutId)).catch(() => {});
    },
    unwatch(cutId) {
      const n = watching.get(cutId) ?? 0;
      if (n > 1) return watching.set(cutId, n - 1);
      watching.delete(cutId);
      if (n) sub.unsubscribe(K.events(cutId)).catch(() => {});
    },
    /**
     * Calls `fn` with each change to the watched cuts, or to every cut with { all: true } (tests and
     * tools only: at scale that is every message).
     */
    subscribe(fn, { all = false } = {}) {
      const name = all ? 'all' : 'watched';
      if (all && !listeningToAll) {
        listeningToAll = true;
        sub.psubscribe(K.allEvents).catch(() => {});
      }
      events.on(name, fn);
      return () => events.off(name, fn);
    },
    close: async () => {
      sub.disconnect();
      await r.quit();
    },
  };
  return q;
}
