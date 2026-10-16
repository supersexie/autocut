import { readFile } from 'node:fs/promises';
import os from 'node:os';

// The state every server shares: cuts, the job list, monthly edit counts and consents.
// Production: Postgres from DATABASE_URL (Supabase). Development: the same schema in PGlite, a
// Postgres that runs inside Node and keeps its data in a folder, so there's nothing to set up.
const MIGRATION = new URL('../supabase/migrations/20261016_shared_state.sql', import.meta.url);

// A job whose worker hasn't checked in for this long is taken to have died with it.
export const STALE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;

export const workerName = `${os.hostname()}-${process.pid}`;

/** Connects: `url` for Postgres, else `dir` for a local PGlite (or in-memory with neither). */
export async function openDb({ url = process.env.DATABASE_URL, dir } = {}) {
  let query, close;
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL ?? 5), ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    query = (text, params) => pool.query(text, params);
    close = () => pool.end();
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (dir) await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
    const lite = dir ? new PGlite(dir) : new PGlite();
    // PGlite runs one statement at a time; queue them so concurrent callers don't interleave.
    let chain = Promise.resolve();
    query = (text, params) => {
      const next = chain.then(() => lite.query(text, params));
      chain = next.catch(() => {});
      return next;
    };
    close = () => lite.close();
    await lite.exec(await readFile(MIGRATION, 'utf8')); // production runs it once in Supabase
  }
  return makeDb(query, close);
}

const one = async (p) => (await p).rows[0] ?? null;
const month = () => new Date().toISOString().slice(0, 7);

export function makeDb(query, close = async () => {}) {
  const db = {
    query,
    close,

    // ---- Cuts
    createCut: (c) =>
      query(
        `insert into cuts (id, user_id, stage, takes, at, run, source, created_at) values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, now()))`,
        [c.id, c.userId, c.stage, c.takes ?? 1, c.at ? new Date(c.at) : null, c.run ?? null, c.source ?? null, c.createdAt ? new Date(c.createdAt) : null]
      ),
    getCut: (id) => one(query(`select * from cuts where id = $1`, [id])),
    /** Changes a cut. `unlessStopped`: only while it hasn't been stopped (returns null if it has). */
    updateCut: (id, fields, { unlessStopped = false } = {}) => {
      const cols = Object.keys(fields);
      const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(', ');
      return one(query(`update cuts set ${sets}, updated_at = now() where id = $1${unlessStopped ? ` and stage <> 'stopped'` : ''} returning id`, [id, ...cols.map((k) => fields[k])]));
    },
    cutsOf: (userId) => query(`select id, source, run, render from cuts where user_id = $1`, [userId]).then((r) => r.rows),
    deleteCutsOf: (userId) => query(`delete from cuts where user_id = $1`, [userId]),

    // ---- The job list
    addTask: ({ cutId, kind, payload = {}, priority = 0, runAt }) =>
      one(query(`insert into tasks (cut_id, kind, payload, priority, run_at) values ($1, $2, $3, $4, coalesce($5, now())) returning id`, [cutId, kind, payload, priority, runAt ? new Date(runAt) : null])),
    /** The next job that's due, now this worker's, or null. Two workers never get the same one. */
    claimTask: (kinds, worker = workerName) =>
      one(
        query(
          `update tasks t set status = 'running', locked_by = $2, heartbeat = now(), attempts = t.attempts + 1
             where t.id = (select id from tasks where status = 'queued' and run_at <= now() and kind = any($1)
                           order by priority desc, run_at, id for update skip locked limit 1)
           returning t.*`,
          [kinds, worker]
        )
      ),
    heartbeat: (taskId) => query(`update tasks set heartbeat = now() where id = $1 and status = 'running'`, [taskId]),
    finishTask: (taskId, status = 'done', error = null) => query(`update tasks set status = $2, error = $3, heartbeat = now() where id = $1`, [taskId, status, error]),
    /** Puts jobs whose worker went quiet back on the list; returns the ones that failed too often. */
    async requeueStale(staleMs = STALE_MS) {
      const cutoff = new Date(Date.now() - staleMs);
      await query(`update tasks set status = 'queued', locked_by = null where status = 'running' and heartbeat < $1 and attempts < $2`, [cutoff, MAX_ATTEMPTS]);
      return (await query(`update tasks set status = 'failed', error = 'worker stopped responding' where status = 'running' and heartbeat < $1 and attempts >= $2 returning *`, [cutoff, MAX_ATTEMPTS])).rows;
    },
    stopTasks: (cutId, kind) => query(`update tasks set status = 'stopped' where cut_id = $1 and kind = $2 and status in ('queued', 'running')`, [cutId, kind]),
    taskFor: (cutId, kind, key) =>
      one(query(`select * from tasks where cut_id = $1 and kind = $2 and payload->>'key' = $3 order by id desc limit 1`, [cutId, kind, key])),
    /** A preview of this cut still waiting is replaced by a newer one (the user kept editing). */
    dropWaitingPreviews: (cutId) => query(`update tasks set status = 'stopped' where cut_id = $1 and kind = 'preview' and status = 'queued'`, [cutId]),
    queueStats: () => one(query(`select count(*) filter (where status = 'queued' and run_at <= now())::int as queued, count(*) filter (where status = 'running')::int as running from tasks`)),

    // ---- Edits used this month
    used: async (userId) => (await one(query(`select used from usage where user_id = $1 and month = $2`, [userId, month()])))?.used ?? 0,
    addUse: (userId, by = 1) =>
      query(`insert into usage (user_id, month, used) values ($1, $2, greatest($3, 0)) on conflict (user_id, month) do update set used = greatest(usage.used + $3, 0)`, [userId, month(), by]),
    forgetUsage: (userId) => query(`delete from usage where user_id = $1`, [userId]),

    // ---- Consent
    setConsent: (userId, { termsVersion, ai }) =>
      query(
        `insert into consents (user_id, terms_version, terms_at, ai, ai_at) values ($1, $2, case when $2::text is null then null else now() end, coalesce($3, false), case when $3::boolean is null then null else now() end)
         on conflict (user_id) do update set
           terms_version = coalesce(excluded.terms_version, consents.terms_version),
           terms_at = coalesce(excluded.terms_at, consents.terms_at),
           ai = case when $3::boolean is null then consents.ai else $3 end,
           ai_at = case when $3::boolean is null then consents.ai_at else now() end,
           updated_at = now()`,
        [userId, termsVersion ?? null, typeof ai === 'boolean' ? ai : null]
      ),
    consentOf: (userId) => one(query(`select * from consents where user_id = $1`, [userId])),
    forgetConsent: (userId) => query(`delete from consents where user_id = $1`, [userId]),
  };
  return db;
}
