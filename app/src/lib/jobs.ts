import { createCut, download, getJob, stopJob, uploadTake } from './api';
import { addCut, getCut, getCuts, updateCut, type CutRecord } from './store';
import { sleep } from './theme';

export type Take = { uri: string; mime: string; duration: number };

const tracking = new Set<string>();
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Sends takes off to be cut. Runs in the background: the record in the store carries the status,
 * so screens just render it, and the cut keeps going if the user leaves the screen.
 */
export function startCut(takes: Take[], language: string): string {
  const id = newId();
  const record: CutRecord = {
    id,
    createdAt: new Date().toISOString(),
    title: 'New take',
    status: 'uploading',
    stage: 'waiting',
    progress: 0,
    takes: takes.length,
    previewUri: takes[0]?.uri,
    duration: takes.reduce((t, k) => t + k.duration, 0),
    words: [],
    cuts: [],
    clips: [],
    exports: 0,
  };
  addCut(record);
  run(id, takes, language);
  return id;
}

// Uploads go one at a time, so a batch of 10 doesn't split the phone's connection ten ways.
let uploads: Promise<unknown> = Promise.resolve();

function uploadAll(id: string, takes: Take[]) {
  const mine = uploads.then(async () => {
    updateCut(id, { stage: 'uploading' });
    const ids: string[] = [];
    for (const [i, take] of takes.entries()) {
      ids.push(await uploadTake(take.uri, take.mime, (f) => updateCut(id, { progress: (i + f) / takes.length })));
    }
    return ids;
  });
  uploads = mine.catch(() => {});
  return mine;
}

async function run(id: string, takes: Take[], language: string) {
  try {
    const ids = await uploadAll(id, takes);
    const serverId = await createCut(ids, language);
    updateCut(id, { serverId, status: 'processing', stage: 'queued', progress: 0 });
    await track(id);
  } catch (e) {
    updateCut(id, { status: 'failed', error: message(e) });
  }
}

/** Polls the server until the cut is ready, then downloads the source for the editor. */
export async function track(id: string) {
  if (tracking.has(id)) return;
  tracking.add(id);
  try {
    let misses = 0;
    while (true) {
      const record = getCut(id);
      if (!record?.serverId || record.status !== 'processing') return;
      let job;
      try {
        job = await getJob(record.serverId);
        misses = 0;
      } catch (e) {
        if (++misses >= 5) throw e;
        await sleep(2000);
        continue;
      }
      if (job.stage === 'failed' || job.stage === 'stopped') {
        updateCut(id, { status: 'failed', error: job.error ?? "The edit didn't finish." });
        return;
      }
      if (job.stage === 'ready') {
        updateCut(id, { stage: 'downloading', progress: 0.97 });
        const source = await download(`/cuts/${record.serverId}/source`, `${id}-source.mp4`);
        const words = job.words ?? [];
        updateCut(id, {
          status: 'ready',
          stage: 'ready',
          progress: 1,
          duration: job.duration ?? record.duration,
          words,
          cuts: job.cuts ?? [],
          clips: (job.segments ?? []).map((s) => [s.start, s.end]),
          title: titleFrom(words),
          source,
        });
        return;
      }
      updateCut(id, { stage: job.stage, progress: job.progress ?? 0 });
      await sleep(700);
    }
  } catch (e) {
    updateCut(id, { status: 'failed', error: message(e) });
  } finally {
    tracking.delete(id);
  }
}

export async function stopCut(id: string) {
  const record = getCut(id);
  updateCut(id, { status: 'failed', error: 'You stopped this cut.' });
  if (record?.serverId) await stopJob(record.serverId).catch(() => {});
}

/** On launch, pick up cuts that were still running, and mark interrupted uploads. */
export function resumeJobs() {
  for (const c of getCuts()) {
    if (c.status === 'processing') track(c.id);
    if (c.status === 'uploading') updateCut(c.id, { status: 'failed', error: 'The upload was interrupted. Send the take again.' });
  }
}

const titleFrom = (words: { text: string }[]) => {
  const text = words.slice(0, 7).map((w) => w.text).join(' ');
  return text || 'Untitled take';
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
