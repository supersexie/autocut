import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// What each plan includes (mirrors app/src/lib/plans.ts). Edits are cuts a month.
export const PLAN_RULES = {
// Batch edits are on every plan; `schedule` is whether batch edits can be given a time.
  starter: { name: 'Starter', edits: 100, overlap: false, schedule: false },
  pro: { name: 'Pro', edits: 300, overlap: true, schedule: true },
  ultimate: { name: 'Ultimate', edits: Infinity, overlap: true, schedule: true },
};

/** A plan's rules; an unknown or missing plan gets Starter's. */
export const rulesFor = (plan) => PLAN_RULES[plan] ?? PLAN_RULES.starter;

const month = () => new Date().toISOString().slice(0, 7); // 2026-10 (UTC)

/**
 * How many edits each account has started this month, kept apart from the cuts themselves (which
 * are deleted after a few days), so the count holds for the whole month.
 */
export function usageStore(dir) {
  const file = (userId) => path.join(dir, `${userId}.json`);
  const read = async (userId) => {
    const saved = JSON.parse(await readFile(file(userId), 'utf8').catch(() => '{}'));
    return saved.month === month() ? saved.used ?? 0 : 0;
  };
  const write = async (userId, used) => {
    await mkdir(dir, { recursive: true });
    await writeFile(file(userId), JSON.stringify({ month: month(), used: Math.max(0, used) }));
  };
  // One change at a time per account, so edits started together are all counted.
  const queues = new Map();
  const change = (userId, by) => {
    const next = (queues.get(userId) ?? Promise.resolve()).then(async () => write(userId, (await read(userId)) + by));
    queues.set(userId, next.catch(() => {}));
    return next;
  };
  return {
    used: read,
    add: (userId) => change(userId, 1),
    /** A cut that failed or was stopped doesn't use up an edit. */
    refund: (userId) => change(userId, -1),
    forget: (userId) => rm(file(userId), { force: true }),
  };
}
