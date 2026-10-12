#!/usr/bin/env node
// HTTP API the mobile app talks to.
//   POST /uploads                      body: raw video bytes              -> { id }
//   POST /cuts?uploads=a,b&maxGap=0.3&fillers=1&retakes=1&lang=en           -> { id }   (joins takes, finds cuts)
//   POST /cuts?...                     body: raw video bytes (one take)    -> { id }
//   GET  /cuts/:id                                                        -> stage, progress, words, segments, cuts, render
//   POST /cuts/:id/stop                                                   -> stops a cut that hasn't finished
//   GET  /cuts/:id/source                                                 -> the joined raw video the editor previews
//   POST /cuts/:id/render              { segments: [[s,e]], captions, height, fps } -> { renderId }
//   GET  /cuts/:id/video                                                  -> the latest finished render
import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { pipeline as pump } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { joinTakes } from './media.js';
import { analyze, renderCut } from './pipeline.js';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = path.resolve(process.env.AUTOCUT_DATA ?? new URL('../data', import.meta.url).pathname);
const UPLOADS = path.join(DATA, 'uploads');
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB per take
const ID = /^[0-9a-f-]{36}$/;

const jobs = new Map();
let queue = Promise.resolve(); // one job at a time: Whisper and ffmpeg each use every core
const enqueue = (fn) => (queue = queue.then(fn).catch((err) => console.error(err)));

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

function publicJob(job) {
  const { dir, source, ...rest } = job;
  return { ...rest, render: job.render && { ...job.render, output: undefined } };
}

const saveJob = (job) => writeFile(path.join(job.dir, 'job.json'), JSON.stringify(job, null, 2));

async function loadJob(id) {
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
  await pump(req, createWriteStream(file));
  return bytes;
}

const extFor = (type = '') => (type.includes('mp4') ? 'mp4' : 'mov');

async function createUpload(req, res) {
  const id = randomUUID();
  const file = path.join(UPLOADS, `${id}.${extFor(req.headers['content-type'])}`);
  try {
    if (!(await readBody(req, file))) return send(res, 400, { error: 'No video in the request body.' });
  } catch {
    return send(res, 413, { error: 'That take is too large (1 GB max).' });
  }
  send(res, 201, { id });
}

async function findUpload(id) {
  if (!ID.test(id)) return null;
  for (const ext of ['mov', 'mp4']) {
    const file = path.join(UPLOADS, `${id}.${ext}`);
    try {
      await stat(file);
      return file;
    } catch {}
  }
  return null;
}

async function createCut(req, res, url) {
  const q = url.searchParams;
  let takes;
  if (q.get('uploads')) {
    takes = await Promise.all(q.get('uploads').split(',').slice(0, 50).map(findUpload));
    if (!takes.length || takes.some((t) => !t)) return send(res, 400, { error: 'One of the takes is missing. Record it again.' });
  } else {
    const file = path.join(UPLOADS, `${randomUUID()}.${extFor(req.headers['content-type'])}`);
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
  const job = { id, dir, takes: takes.length, stage: 'queued', progress: 0, createdAt: new Date().toISOString() };
  jobs.set(id, job);
  await saveJob(job);
  send(res, 201, { id });

  enqueue(async () => {
    if (job.stage === 'stopped') return;
    const log = (stage) => job.stage !== stage && console.log(`[${id.slice(0, 8)}] ${stage}`);
    try {
      if (takes.length > 1) {
        log('joining');
        job.stage = 'joining';
        job.source = path.join(dir, 'source.mp4');
        await joinTakes(takes, job.source, { onProgress: (f) => (job.progress = 0.15 * f) });
      } else {
        job.source = path.join(dir, `source${path.extname(takes[0])}`);
        await copyFile(takes[0], job.source);
      }
      const base = takes.length > 1 ? 0.15 : 0;
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
  const segments = (Array.isArray(body.segments) ? body.segments : [])
    .map(([s, e]) => [Math.max(0, Number(s)), Math.min(job.duration, Number(e))])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s >= 0.05);
  if (!segments.length) return send(res, 400, { error: 'There is nothing left in this cut to export.' });
  const height = [480, 720, 1080, 1440, 2160].includes(Number(body.height)) ? Number(body.height) : undefined;
  const fps = [24, 25, 30, 60].includes(Number(body.fps)) ? Number(body.fps) : undefined;

  const renderId = randomUUID();
  job.render = { id: renderId, stage: 'queued', progress: 0, output: path.join(job.dir, `render-${renderId}.mp4`) };
  await saveJob(job);
  send(res, 201, { renderId });

  enqueue(async () => {
    const r = job.render;
    r.stage = 'rendering';
    console.log(`[${job.id.slice(0, 8)}] exporting`);
    try {
      await renderCut(job.source, r.output, segments, job.words ?? [], {
        captions: !!body.captions,
        height,
        fps,
        onProgress: (f) => (r.progress = f),
      });
      Object.assign(r, { stage: 'ready', progress: 1, size: (await stat(r.output)).size });
    } catch (err) {
      console.error(err);
      Object.assign(r, { stage: 'failed', error: 'The export failed. Try again.' });
    }
    await saveJob(job);
  });
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const [root, id, action] = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && root === 'health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && root === 'uploads' && !id) return await createUpload(req, res);
    if (req.method === 'POST' && root === 'cuts' && !id) return await createCut(req, res, url);
    if (root === 'cuts' && id) {
      const job = await loadJob(id);
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
server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;
  console.log(`Autocut server on http://localhost:${PORT}${lan ? `  (phone: http://${lan}:${PORT})` : ''}`);
});
