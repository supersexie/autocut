#!/usr/bin/env node
// HTTP API the mobile app talks to.
//   POST /uploads                      body: raw video bytes              -> { id }
//   POST /cuts?uploads=a,b&flips=1,0&maxGap=0.3&fillers=1&retakes=1&lang=en -> { id }   (joins takes, un-mirrors selfies, finds cuts)
//   POST /cuts?...                     body: raw video bytes (one take)    -> { id }
//   GET  /cuts/:id                                                        -> stage, progress, words, segments, cuts, render
//   POST /cuts/:id/stop                                                   -> stops a cut that hasn't finished
//   GET  /cuts/:id/source                                                 -> the joined raw video the editor previews
//   POST /cuts/:id/render              { clips: [{start,end,speed,volume}], captions: {style, lines}, texts, height, fps, bitrate } -> { renderId }
//   GET  /cuts/:id/video                                                  -> the latest finished render
//   DELETE /account                                                       -> deletes the user, their takes and cuts
// Every route but /health needs `Authorization: Bearer <Supabase access token>` (see auth.js).
import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { pipeline as streamTo } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { authEnabled, deleteAuthUser, LOCAL_USER, userIdFrom } from './auth.js';
import { joinTakes } from './media.js';
import { analyze, renderEdit } from './pipeline.js';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = path.resolve(process.env.AUTOCUT_DATA ?? new URL('../data', import.meta.url).pathname);
const UPLOADS = path.join(DATA, 'uploads');
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 1024) * 1024 * 1024;
// Whisper and ffmpeg each use every core, so run few jobs at once and queue the rest.
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 1));
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 7);
const ID = /^[0-9a-f-]{36}$/;
const USER = /^([0-9a-f-]{36}|local)$/;

const jobs = new Map();
let running = 0;
const waiting = [];
function enqueue(fn) {
  waiting.push(fn);
  drain();
}
function drain() {
  while (running < CONCURRENCY && waiting.length) {
    const fn = waiting.shift();
    running++;
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error(err))
      .finally(() => {
        running--;
        drain();
      });
  }
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

function publicJob(job) {
  const { dir, source, userId, ...rest } = job;
  return { ...rest, render: job.render && { ...job.render, output: undefined } };
}

const saveJob = (job) => writeFile(path.join(job.dir, 'job.json'), JSON.stringify(job, null, 2));

/** A job, only if it belongs to `userId`. */
async function loadJob(id, userId) {
  const job = await readJob(id);
  return job && (job.userId ?? LOCAL_USER) === userId ? job : null;
}

async function readJob(id) {
  if (jobs.has(id)) return jobs.get(id);
  if (!ID.test(id)) return null;
  try {
    const job = JSON.parse(await readFile(path.join(DATA, id, 'job.json'), 'utf8'));
    // A server restart interrupts anything that was running.
    if (!['ready', 'failed', 'stopped'].includes(job.stage)) Object.assign(job, { stage: 'failed', error: 'The server restarted. Send the take again.' });
    if (job.render && !['ready', 'failed'].includes(job.render.stage)) Object.assign(job.render, { stage: 'failed', error: 'The server restarted. Export again.' });
    jobs.set(id, job);
    return job;
  } catch {
    return null;
  }
}

async function readBody(req, file) {
  let bytes = 0;
  req.on('data', (c) => {
    bytes += c.length;
    if (bytes > MAX_BYTES) req.destroy(new Error('too large'));
  });
  await streamTo(req, createWriteStream(file));
  return bytes;
}

const extFor = (type = '') => (type.includes('mp4') ? 'mp4' : 'mov');

const uploadsFor = async (userId) => {
  const dir = path.join(UPLOADS, userId);
  await mkdir(dir, { recursive: true });
  return dir;
};

async function createUpload(req, res, userId) {
  const id = randomUUID();
  const file = path.join(await uploadsFor(userId), `${id}.${extFor(req.headers['content-type'])}`);
  try {
    if (!(await readBody(req, file))) return send(res, 400, { error: 'No video in the request body.' });
  } catch {
    return send(res, 413, { error: 'That take is too large (1 GB max).' });
  }
  send(res, 201, { id });
}

async function findUpload(id, userId) {
  if (!ID.test(id)) return null;
  for (const ext of ['mov', 'mp4']) {
    const file = path.join(UPLOADS, userId, `${id}.${ext}`);
    try {
      await stat(file);
      return file;
    } catch {}
  }
  return null;
}

async function createCut(req, res, url, userId) {
  const q = url.searchParams;
  let takes;
  if (q.get('uploads')) {
    takes = await Promise.all(q.get('uploads').split(',').slice(0, 50).map((u) => findUpload(u, userId)));
    if (!takes.length || takes.some((t) => !t)) return send(res, 400, { error: 'One of the takes is missing. Record it again.' });
  } else {
    const file = path.join(await uploadsFor(userId), `${randomUUID()}.${extFor(req.headers['content-type'])}`);
    try {
      if (!(await readBody(req, file))) return send(res, 400, { error: 'No video in the request body.' });
    } catch {
      return send(res, 413, { error: 'That take is too large (1 GB max).' });
    }
    takes = [file];
  }

  const id = randomUUID();
  const dir = path.join(DATA, id);
  await mkdir(dir, { recursive: true });
  const options = {
    language: q.get('lang') === 'es' ? 'spanish' : 'english',
    plan: {
      ...(q.has('maxGap') && { maxGap: Math.min(1.5, Math.max(0.1, Number(q.get('maxGap')) || 0.3)) }),
      removeFillers: q.get('fillers') !== '0',
      removeRetakes: q.get('retakes') !== '0',
    },
  };
  const job = { id, dir, userId, takes: takes.length, stage: 'queued', progress: 0, createdAt: new Date().toISOString() };
  jobs.set(id, job);
  await saveJob(job);
  send(res, 201, { id });

  enqueue(async () => {
    if (job.stage === 'stopped') return;
    const log = (stage) => job.stage !== stage && console.log(`[${id.slice(0, 8)}] ${stage}`);
    try {
      const flips = (q.get('flips') ?? '').split(',').map((f) => f === '1');
      const joined = takes.length > 1 || flips[0];
      if (joined) {
        log('joining');
        job.stage = 'joining';
        job.source = path.join(dir, 'source.mp4');
        await joinTakes(takes, job.source, { flips, onProgress: (f) => (job.progress = 0.15 * f) });
      } else {
        job.source = path.join(dir, `source${path.extname(takes[0])}`);
        await copyFile(takes[0], job.source);
      }
      const base = joined ? 0.15 : 0;
      const result = await analyze(job.source, {
        ...options,
        onProgress: (stage, f) => {
          if (job.stage === 'stopped') return;
          log(stage);
          job.stage = stage;
          job.progress = base + (1 - base) * f;
        },
      });
      if (job.stage === 'stopped') return;
      Object.assign(job, result, { progress: 1, stage: result.segments.length ? 'ready' : 'failed' });
      if (!result.segments.length) job.error = "We couldn't hear any speech in this video.";
    } catch (err) {
      console.error(err);
      Object.assign(job, { stage: 'failed', error: 'Something went wrong while cutting this take.' });
    }
    log(job.stage);
    await saveJob(job);
  });
}

async function stopCut(res, job) {
  if (!['ready', 'failed'].includes(job.stage)) {
    Object.assign(job, { stage: 'stopped', error: 'You stopped this cut.' });
    await saveJob(job);
  }
  send(res, 200, publicJob(job));
}

async function jsonBody(req) {
  let text = '';
  for await (const c of req) {
    text += c;
    if (text.length > 1e6) throw new Error('too large');
  }
  return JSON.parse(text || '{}');
}

async function createRender(req, res, job) {
  if (job.stage !== 'ready') return send(res, 409, { error: 'This cut is not ready to export yet.' });
  if (job.render && ['queued', 'rendering'].includes(job.render.stage)) return send(res, 409, { error: 'Already exporting this cut.' });
  let body;
  try {
    body = await jsonBody(req);
  } catch {
    return send(res, 400, { error: 'Bad export request.' });
  }
  // `clips` (speed/volume per clip) from the editor, or plain `segments` [[start, end]].
  const raw = Array.isArray(body.clips) ? body.clips : Array.isArray(body.segments) ? body.segments.map(([start, end]) => ({ start, end })) : [];
  const clips = raw
    .slice(0, 500)
    .map((c) => ({
      start: Math.max(0, Number(c.start)),
      end: Math.min(job.duration, Number(c.end)),
      speed: Math.min(4, Math.max(0.25, Number(c.speed) || 1)),
      volume: Math.min(2, Math.max(0, c.volume === undefined ? 1 : Number(c.volume))),
    }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end - c.start >= 0.05);
  if (!clips.length) return send(res, 400, { error: 'There is nothing left in this cut to export.' });
  const height = [480, 720, 1080, 1440, 2160].includes(Number(body.height)) ? Number(body.height) : undefined;
  const fps = [24, 25, 30, 60].includes(Number(body.fps)) ? Number(body.fps) : undefined;
  const bitrate = [4, 8, 12, 20, 30, 60].includes(Number(body.bitrate)) ? Number(body.bitrate) : undefined;
  const words = (list) =>
    (Array.isArray(list) ? list : []).slice(0, 2000).map((w) => ({ text: String(w.text ?? '').slice(0, 80), start: Number(w.start) || 0, end: Number(w.end) || 0 }));
  let captions;
  if (body.captions && Array.isArray(body.captions.lines)) {
    captions = {
      style: String(body.captions.style ?? 'classic'),
      box: typeof body.captions.box === 'boolean' ? body.captions.box : undefined,
      outline: typeof body.captions.outline === 'boolean' ? body.captions.outline : undefined,
      lines: body.captions.lines.slice(0, 2000).map((l) => ({ start: Number(l.start) || 0, end: Number(l.end) || 0, words: words(l.words) })),
    };
  } else if (body.captions === true) {
    // Older clients: default captions from the transcript.
    captions = { style: 'classic', lines: defaultLines(job.words ?? [], clips) };
  }
  const texts = (Array.isArray(body.texts) ? body.texts : []).slice(0, 50).map((t) => ({
    text: String(t.text ?? '').slice(0, 200),
    style: String(t.style ?? 'classic'),
    start: Number(t.start) || 0,
    end: Number(t.end) || 0,
    x: Math.min(1, Math.max(0, Number(t.x ?? 0.5))),
    y: Math.min(1, Math.max(0, Number(t.y ?? 0.5))),
    scale: Math.min(3, Math.max(0.3, Number(t.scale) || 1)),
    font: typeof t.font === 'string' ? t.font.slice(0, 60) : undefined,
    color: /^#[0-9a-f]{6}$/i.test(t.color ?? '') ? t.color : undefined,
    box: typeof t.box === 'boolean' ? t.box : undefined,
    outline: typeof t.outline === 'boolean' ? t.outline : undefined,
    align: ['left', 'center', 'right'].includes(t.align) ? t.align : undefined,
  }));

  const renderId = randomUUID();
  job.render = { id: renderId, stage: 'queued', progress: 0, output: path.join(job.dir, `render-${renderId}.mp4`) };
  await saveJob(job);
  send(res, 201, { renderId });

  enqueue(async () => {
    const r = job.render;
    r.stage = 'rendering';
    console.log(`[${job.id.slice(0, 8)}] exporting`);
    try {
      await renderEdit(job.source, r.output, { clips, captions, texts, height, fps, bitrate }, { onProgress: (f) => (r.progress = f) });
      Object.assign(r, { stage: 'ready', progress: 1, size: (await stat(r.output)).size });
    } catch (err) {
      console.error(err);
      Object.assign(r, { stage: 'failed', error: 'The export failed. Try again.' });
    }
    await saveJob(job);
  });
}

// Caption lines (4 words max) on the output timeline, for clients that don't send their own.
function defaultLines(words, clips) {
  const lines = [];
  let offset = 0;
  for (const c of clips) {
    const inClip = words.filter((w) => w.start >= c.start - 0.05 && w.end <= c.end + 0.05);
    for (let i = 0; i < inClip.length; i += 4) {
      const group = inClip.slice(i, i + 4).map((w) => ({
        text: w.text,
        start: offset + (Math.max(w.start, c.start) - c.start) / c.speed,
        end: offset + (Math.min(w.end, c.end) - c.start) / c.speed,
      }));
      lines.push({ start: group[0].start, end: group.at(-1).end + 0.2, words: group });
    }
    offset += (c.end - c.start) / c.speed;
  }
  return lines;
}

async function sendFile(req, res, file, type) {
  const { size } = await stat(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  createReadStream(file).pipe(res);
}

async function deleteAccount(res, userId) {
  for (const id of await readdir(DATA).catch(() => [])) {
    if (!ID.test(id)) continue;
    const job = await readJob(id);
    if (job && (job.userId ?? LOCAL_USER) === userId) {
      job.stage = 'stopped';
      jobs.delete(id);
      await rm(job.dir, { recursive: true, force: true });
    }
  }
  await rm(path.join(UPLOADS, userId), { recursive: true, force: true });
  await deleteAuthUser(userId);
  console.log(`[account] deleted ${userId.slice(0, 8)}`);
  send(res, 200, { ok: true });
}

// Delete cuts older than RETENTION_DAYS and takes that were uploaded but never cut.
async function cleanUp() {
  const now = Date.now();
  for (const id of await readdir(DATA).catch(() => [])) {
    if (!ID.test(id)) continue;
    const job = await readJob(id);
    if (!job || now - Date.parse(job.createdAt) < RETENTION_DAYS * 864e5) continue;
    if (['queued', 'joining', 'reading', 'listening', 'cutting'].includes(job.stage) || job.render?.stage === 'rendering') continue;
    jobs.delete(id);
    await rm(path.join(DATA, id), { recursive: true, force: true });
  }
  for (const user of await readdir(UPLOADS).catch(() => [])) {
    for (const f of await readdir(path.join(UPLOADS, user)).catch(() => [])) {
      const file = path.join(UPLOADS, user, f);
      const info = await stat(file).catch(() => null);
      if (info && now - info.mtimeMs > 864e5) await rm(file, { force: true });
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const [root, id, action] = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && root === 'health') return send(res, 200, { ok: true, queued: waiting.length, running });

    const userId = await userIdFrom(req);
    if (!userId || !USER.test(userId)) return send(res, 401, { error: 'Your session ended. Sign in again.' });

    if (req.method === 'POST' && root === 'uploads' && !id) return await createUpload(req, res, userId);
    if (req.method === 'POST' && root === 'cuts' && !id) return await createCut(req, res, url, userId);
    if (req.method === 'DELETE' && root === 'account' && !id) return await deleteAccount(res, userId);
    if (root === 'cuts' && id) {
      const job = await loadJob(id, userId);
      if (!job) return send(res, 404, { error: 'No cut with that id.' });
      if (req.method === 'GET' && !action) return send(res, 200, publicJob(job));
      if (req.method === 'POST' && action === 'stop') return await stopCut(res, job);
      if (req.method === 'POST' && action === 'render') return await createRender(req, res, job);
      if (req.method === 'GET' && action === 'source') {
        if (!job.source) return send(res, 409, { error: 'Not ready yet.' });
        return await sendFile(req, res, job.source, job.source.endsWith('.mp4') ? 'video/mp4' : 'video/quicktime');
      }
      if (req.method === 'GET' && action === 'video') {
        if (job.render?.stage !== 'ready') return send(res, 409, { error: 'Not exported yet.' });
        return await sendFile(req, res, job.render.output, 'video/mp4');
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});

await mkdir(UPLOADS, { recursive: true });
setInterval(() => cleanUp().catch((err) => console.error(err)), 3600e3).unref();
cleanUp().catch((err) => console.error(err));
if (!authEnabled) console.warn('Auth is off (no SUPABASE_URL): every request runs as one local user. Fine for development only.');
server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;
  console.log(`Autocut server on http://localhost:${PORT}${lan ? `  (phone: http://${lan}:${PORT})` : ''}`);
});
