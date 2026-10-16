import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { joinTakes, render } from './media.js';
import { analyze, renderEdit } from './pipeline.js';
import { fileCache } from './storage.js';
import { workerName } from './db.js';
import { postgresQueue } from './queue.js';

// How often a running job reports its progress (each report is a Redis write and a push to the
// phone). Raise it (e.g. 2000) when very many jobs run at once.
const PROGRESS_MS = Math.max(250, Number(process.env.PROGRESS_MS ?? 1000));

// Does the heavy work. Any number of these run at once, on any number of machines: each takes the
// next job off the shared list (queue.js: Postgres or Redis), fetches what it needs from storage,
// does the job, reports progress as it goes (pushed live to the phone), and puts the results in
// storage and on the cut's row. A job whose worker dies is put back on the list by whichever server
// notices its heartbeat stopped.
export const cutKey = (userId, cutId, name) => `users/${userId}/cuts/${cutId}/${name}`;
export const previewName = (key) => `preview-${key}.mp4`;

class Stopped extends Error {}

export const ALL_KINDS = ['preview', 'cut', 'render'];

export function startWorker({ db, queue = postgresQueue(db), storage, workDir = path.join(os.tmpdir(), 'autocut-work'), concurrency = 1, kinds = ALL_KINDS, idleMs = 1000, maxIdleMs = 5000, log = console.log } = {}) {
  const cache = fileCache(storage, path.join(workDir, 'cache'));
  let running = 0;
  let stopping = false;
  let wake = () => {};

  // When the list is empty, look less often (up to maxIdleMs, with jitter so hundreds of workers
  // don't all ask at the same moment); look again at once after finding a job.
  let idle = idleMs;
  async function loop() {
    while (!stopping) {
      if (running >= concurrency) {
        await new Promise((r) => (wake = r));
        continue;
      }
      let task;
      try {
        task = await queue.claimTask(kinds);
      } catch (err) {
        console.error('claim failed', err.message);
      }
      if (!task) {
        await new Promise((r) => setTimeout(r, idle * (0.75 + Math.random() * 0.5)).unref?.());
        idle = Math.min(maxIdleMs, idle * 1.5);
        continue;
      }
      idle = idleMs;
      running++;
      runTask(task).finally(() => {
        running--;
        wake();
      });
    }
  }

  async function runTask(task) {
    const tag = `[${task.cut_id.slice(0, 8)}]`;
    const beat = setInterval(() => queue.heartbeat(task.id).catch(() => {}), 20_000);
    const dir = await mkdtemp(path.join(await ensure(workDir), `${task.kind}-`));
    try {
      const cut = await db.getCut(task.cut_id);
      if (!cut || (task.kind === 'cut' && cut.stage === 'stopped')) return await queue.finishTask(task.id, 'stopped');
      if (task.kind === 'cut') await doCut(task, cut, dir, tag);
      else if (task.kind === 'render') await doRender(task, cut, dir, tag);
      else if (task.kind === 'preview') await doPreview(task, cut, dir);
      await queue.finishTask(task.id, 'done');
    } catch (err) {
      if (err instanceof Stopped) return await queue.finishTask(task.id, 'stopped');
      console.error(tag, task.kind, err);
      await queue.finishTask(task.id, 'failed', String(err.message ?? err).slice(0, 500));
      await failCut(db, task, task.kind === 'render' ? 'The export failed. Try again.' : 'Something went wrong while cutting this take.', queue);
    } finally {
      clearInterval(beat);
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function doCut(task, cut, dir, tag) {
    const { uploads, flips = [], blend = false, options = {} } = cut.run ?? {};
    let last = 0;
    let lastStage = cut.stage;
    // Progress goes to the job list's live view (pushed to the phone), about once a second; a new
    // stage is also saved on the cut's row. Either finds the cut stopped if the user stopped it,
    // which ends the job here.
    const report = async (stage, progress, force = false) => {
      if (!force && stage === lastStage && Date.now() - last < PROGRESS_MS) return;
      last = Date.now();
      const changed = stage !== lastStage;
      if (changed) log(`${tag} ${stage}`);
      lastStage = stage;
      if (changed && queue.kind !== 'postgres' && !(await db.updateCut(cut.id, { stage }, { unlessStopped: true }))) throw new Stopped();
      if (await queue.progress(cut.id, { stage, progress })) throw new Stopped();
    };
    const joined = uploads.length > 1 || flips[0];
    await report(joined ? 'joining' : 'reading', 0, true);
    const takes = await Promise.all(uploads.map((k) => cache.get(k)));
    let source = uploads[0];
    let sourceFile = takes[0];
    if (joined) {
      sourceFile = path.join(dir, 'source.mp4');
      let joining = Promise.resolve();
      await joinTakes(takes, sourceFile, { flips, blend, onProgress: (f) => (joining = joining.then(() => report('joining', 0.15 * f))) });
      await joining;
      source = cutKey(cut.user_id, cut.id, 'source.mp4');
      await storage.put(sourceFile, source, 'video/mp4');
      sourceFile = await cache.get(source);
    }
    const base = joined ? 0.15 : 0;
    let pending = Promise.resolve();
    const result = await analyze(sourceFile, {
      ...options,
      onProgress: (stage, f) => {
        pending = pending.then(() => report(stage, base + (1 - base) * f));
      },
    });
    await pending;
    const ready = result.segments.length > 0;
    const done = await db.updateCut(
      cut.id,
      { stage: ready ? 'ready' : 'failed', progress: 1, result, source, run: null, error: ready ? null : "We couldn't hear any speech in this video." },
      { unlessStopped: true }
    );
    if (!done) throw new Stopped();
    await queue.progress(cut.id, { stage: ready ? 'ready' : 'failed', progress: 1 });
    log(`${tag} ${ready ? 'ready' : 'no speech'}`);
    if (!ready) await db.addUse(cut.user_id, -1);
    // Have the editor's first preview waiting by the time the app opens it.
    else {
      const { parseClips, previewKey } = await import('./edits.js');
      const clips = parseClips(result.segments, result.duration);
      await queue.addTask({ cutId: cut.id, kind: 'preview', payload: { key: previewKey(clips), clips }, priority: 5 });
    }
  }

  async function doRender(task, cut, dir, tag) {
    const p = task.payload;
    const r = cut.render ?? {};
    if (r.id !== p.renderId) return; // a newer export replaced this one
    log(`${tag} exporting`);
    await db.updateCut(cut.id, { render: { ...r, stage: 'rendering', progress: 0 } });
    if (queue.kind !== 'postgres') await queue.progress(cut.id, { render: { ...r, stage: 'rendering', progress: 0 } });
    const source = await cache.get(cut.source);
    const music = p.music && { ...p.music, file: await cache.get(p.music.key) };
    const overlays = await Promise.all((p.overlays ?? []).map(async (o) => ({ ...o, file: await cache.get(o.key) })));
    const output = path.join(dir, `render-${p.renderId}.mp4`);
    let last = 0;
    await renderEdit(source, output, { ...p.edit, music, overlays }, {
      onProgress: (f) => {
        if (Date.now() - last < Math.max(1500, PROGRESS_MS)) return;
        last = Date.now();
        queue.progress(cut.id, { render: { ...r, stage: 'rendering', progress: f } }).catch(() => {});
      },
    });
    const key = cutKey(cut.user_id, cut.id, `render-${p.renderId}.mp4`);
    const size = await storage.put(output, key, 'video/mp4');
    const done = { id: p.renderId, stage: 'ready', progress: 1, size, key };
    await db.updateCut(cut.id, { render: done });
    if (queue.kind !== 'postgres') await queue.progress(cut.id, { render: done });
    log(`${tag} exported`);
  }

  async function doPreview(task, cut, dir) {
    const { key, clips } = task.payload;
    const name = cutKey(cut.user_id, cut.id, previewName(key));
    if ((await storage.size(name)) !== null) return;
    const out = path.join(dir, previewName(key));
    await render(await cache.get(cut.source), out, clips, { height: 540, fast: true });
    await storage.put(out, name, 'video/mp4');
  }

  loop();
  return {
    name: workerName,
    get running() {
      return running;
    },
    stop() {
      stopping = true;
      wake();
    },
    /**
     * For shutting down (a deploy, or the autoscaler removing this copy): stop taking jobs, give
     * running ones up to `graceMs` to finish, then hand the rest back to the list for another worker.
     */
    async drain(graceMs = 20_000) {
      stopping = true;
      wake();
      const until = Date.now() + graceMs;
      while (running > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
      if (running > 0) await queue.releaseTasks(workerName);
    },
  };
}

const ensure = async (dir) => (await mkdir(dir, { recursive: true }), dir);

/** Marks what a failed job was making as failed, and gives back the edit a failed cut used. */
export async function failCut(db, task, message, queue) {
  const cut = await db.getCut(task.cut_id);
  if (!cut) return;
  if (task.kind === 'cut' && !['ready', 'failed', 'stopped'].includes(cut.stage)) {
    await db.updateCut(cut.id, { stage: 'failed', error: message, run: null });
    await db.addUse(cut.user_id, -1);
    if (queue && queue.kind !== 'postgres') await queue.progress(cut.id, { stage: 'failed' });
  } else if (task.kind === 'render' && cut.render?.id === task.payload?.renderId && cut.render.stage !== 'ready') {
    const failed = { ...cut.render, stage: 'failed', error: message };
    await db.updateCut(cut.id, { render: failed });
    if (queue && queue.kind !== 'postgres') await queue.progress(cut.id, { render: failed });
  }
}

/** Puts back jobs whose worker went quiet; fails (and refunds) the ones that kept failing. */
export async function sweep(db, queue = postgresQueue(db)) {
  for (const task of await queue.requeueStale()) {
    await failCut(db, task, task.kind === 'render' ? 'The export failed. Try again.' : 'Something went wrong while cutting this take. Try again.', queue);
  }
}
