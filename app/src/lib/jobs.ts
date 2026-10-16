import { File } from 'expo-file-system';
import { createCut, download, getJob, getWaveform, ServerUnreachable, stopJob, uploadTake } from './api';
import { addCut, cutFile, getCut, getCuts, getSettings, updateCut, type Clip, type CutRecord, type Word } from './store';
import { sleep } from './theme';

/** `flip`: a front-camera take, which iOS records mirrored; the server flips it back. */
export type Take = { uri: string; mime: string; duration: number; flip?: boolean };

const tracking = new Set<string>();
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Sends takes off to be cut. Runs in the background: the record in the store carries the status,
 * so screens just render it, and the cut keeps going if the user leaves the screen.
 */
export function startCut(takes: Take[], language: string, { blend = false, batch = false, at }: { blend?: boolean; batch?: boolean; at?: number } = {}): string {
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
    previewFlip: !!takes[0]?.flip,
    // One take that needs no flipping is exactly what the server will cut, so the editor can use
    // this copy instead of downloading it back.
    localSource: takes.length === 1 && !takes[0].flip ? takes[0].uri : undefined,
    // Filed where the camera's folder button says (if that folder still exists).
    folderId: getSettings().saveFolder || undefined,
    retry: { takes, language, blend, batch, at },
    scheduledFor: at,
    duration: takes.reduce((t, k) => t + k.duration, 0),
    words: [],
    cuts: [],
    clips: [],
    exports: 0,
  };
  addCut(record);
  run(id, takes, language, blend, batch, at);
  return id;
}

/**
 * Runs `request` again when the phone can't reach the server, waiting a little longer each time
 * (`onRetry` says so meanwhile), and gives up after `tries`. Other errors come straight back.
 */
async function withRetries<T>(request: () => Promise<T>, tries: number, onRetry: () => void): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (e) {
      if (!(e instanceof ServerUnreachable) || attempt >= tries) throw e;
      onRetry();
      await sleep(Math.min(15000, 2000 * attempt));
    }
  }
}

// Uploads go one at a time, so a batch of 10 doesn't split the phone's connection ten ways.
let uploads: Promise<unknown> = Promise.resolve();

function uploadAll(id: string, takes: Take[]) {
  const mine = uploads.then(async () => {
    updateCut(id, { stage: 'uploading' });
    const ids: string[] = [];
    for (const [i, take] of takes.entries()) {
      const progress = (f: number) => updateCut(id, { stage: 'uploading', progress: (i + f) / takes.length });
      ids.push(await withRetries(() => uploadTake(take.uri, take.mime, progress), 4, () => updateCut(id, { stage: 'reconnecting' })));
    }
    return ids;
  });
  uploads = mine.catch(() => {});
  return mine;
}

async function run(id: string, takes: Take[], language: string, blend = false, batch = false, at?: number) {
  try {
    const ids = await uploadAll(id, takes);
    // A time already passed (e.g. trying again later) just cuts it now.
    const when = at && at > Date.now() + 60e3 ? at : undefined;
    const serverId = await createCut(ids, takes.map((t) => !!t.flip), language, blend, batch, when);
    updateCut(id, { serverId, status: 'processing', stage: when ? 'scheduled' : 'queued', progress: 0, scheduledFor: when });
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
    let lostSince = 0;
    while (true) {
      const record = getCut(id);
      if (!record?.serverId || record.status !== 'processing') return;
      let job;
      try {
        job = await getJob(record.serverId);
        lostSince = 0;
      } catch (e) {
        // The server keeps cutting without us. Ride out a locked phone or a patchy connection for
        // a few minutes before calling it; reopening the app picks it up again anyway.
        if (!(e instanceof ServerUnreachable)) throw e;
        lostSince ||= Date.now();
        if (Date.now() - lostSince > 4 * 60_000) throw e;
        updateCut(id, { stage: 'reconnecting' });
        await sleep(3000);
        continue;
      }
      if (job.stage === 'failed' || job.stage === 'stopped') {
        updateCut(id, { status: 'failed', error: job.error ?? "The edit didn't finish." });
        return;
      }
      if (job.stage === 'ready') {
        updateCut(id, { stage: 'downloading', progress: 0.97 });
        const source = await sourceFor(id, record, record.serverId);
        const waveform = await getWaveform(record.serverId).catch(() => undefined); // nice to have
        const words = job.words ?? [];
        const clips: Clip[] = (job.segments ?? []).map((s) => [s.start, s.end]);
        updateCut(id, {
          status: 'ready',
          stage: 'ready',
          progress: 1,
          duration: job.duration ?? record.duration,
          words,
          cuts: job.cuts ?? [],
          clips,
          title: titleFrom(words, clips),
          source,
          waveform,
        });
        return;
      }
      // Scheduled for later: look in now and then rather than every moment.
      if (job.stage === 'scheduled') {
        updateCut(id, { stage: 'scheduled', progress: 0 });
        await sleep(15000);
        continue;
      }
      updateCut(id, { stage: job.stage, progress: job.progress ?? 0 });
      // Often enough for the progress bar (it animates between readings), rare enough that thousands
      // of phones cutting at once don't swamp the server.
      await sleep(1500);
    }
  } catch (e) {
    updateCut(id, { status: 'failed', error: message(e) });
  } finally {
    tracking.delete(id);
  }
}

/** The video the editor plays: the phone's own copy when it's the same file, else the server's. */
async function sourceFor(id: string, record: CutRecord, serverId: string) {
  const local = record.localSource ? new File(record.localSource) : null;
  if (local?.exists) {
    const name = `${id}-source.${(local.name.split('.').pop() ?? 'mov').toLowerCase()}`;
    const copy = cutFile(name);
    if (copy.exists) copy.delete();
    local.copy(copy);
    return name;
  }
  return withRetries(() => download(`/cuts/${serverId}/source`, `${id}-source.mp4`), 4, () => updateCut(id, { stage: 'reconnecting' }));
}

/** What to send again: what was sent, or for cuts made before that was kept, their single take. */
function retryTakes(cut: CutRecord): Take[] | undefined {
  if (cut.retry) return cut.retry.takes;
  if (cut.takes === 1 && cut.previewUri) return [{ uri: cut.previewUri, mime: 'video/quicktime', duration: cut.duration, flip: cut.previewFlip }];
}

const stillHere = (takes?: Take[]) => !!takes?.length && takes.every((t) => new File(t.uri).exists);

/** Whether a failed cut can be tried again: the server still has it, or its videos are still here. */
export function canRetry(cut: CutRecord) {
  return cut.status === 'failed' && (!!cut.serverId || stillHere(retryTakes(cut)));
}

/**
 * Tries a failed cut again. If the server got it, pick up where it is (it may even be done);
 * otherwise send the videos again.
 */
export async function retryCut(id: string) {
  const record = getCut(id);
  if (!record || record.status !== 'failed') return;
  if (record.serverId) {
    const job = await getJob(record.serverId).catch(() => null);
    if (job && job.stage !== 'failed' && job.stage !== 'stopped') {
      updateCut(id, { status: 'processing', stage: job.stage, progress: job.progress ?? 0, error: undefined });
      track(id);
      return;
    }
  }
  const takes = retryTakes(record);
  if (!takes || !stillHere(takes)) {
    updateCut(id, { error: 'The original video isn’t on this phone any more. Record or import it again.' });
    return;
  }
  updateCut(id, { status: 'uploading', stage: 'waiting', progress: 0, error: undefined, serverId: undefined });
  run(id, takes, record.retry?.language ?? 'en', record.retry?.blend, record.retry?.batch, record.retry?.at);
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
    if (c.status === 'uploading') updateCut(c.id, { status: 'failed', error: 'The upload was interrupted. Tap Try again.' });
  }
}

/** The cut's opening words, from what was kept (not a retake that was cut). */
const titleFrom = (words: Word[], clips: Clip[]) => {
  const kept = words.filter((w) => clips.some(([a, b]) => w.start >= a - 0.05 && w.start < b));
  const text = (kept.length ? kept : words).slice(0, 7).map((w) => w.text).join(' ');
  return text || 'Untitled take';
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
