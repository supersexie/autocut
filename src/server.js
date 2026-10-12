#!/usr/bin/env node
// HTTP API the mobile app talks to.
//   POST /cuts?maxGap=0.3&fillers=1&retakes=1&captions=1   body: raw video bytes  -> { id }
//   GET  /cuts/:id                                                               -> job status + plan
//   GET  /cuts/:id/video                                                         -> the cut mp4 (Range supported)
import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { pipeline as pump } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { autocut } from './pipeline.js';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = path.resolve(process.env.AUTOCUT_DATA ?? new URL('../data', import.meta.url).pathname);
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

const jobs = new Map();
let queue = Promise.resolve(); // one take at a time: Whisper and ffmpeg each use every core

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

function publicJob(job) {
  const { input, output, dir, ...rest } = job;
  return rest;
}

async function saveJob(job) {
  await writeFile(path.join(job.dir, 'job.json'), JSON.stringify(job, null, 2));
}

async function loadJob(id) {
  if (jobs.has(id)) return jobs.get(id);
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try {
    const job = JSON.parse(await readFile(path.join(DATA, id, 'job.json'), 'utf8'));
    jobs.set(id, job);
    return job;
  } catch {
    return null;
  }
}

async function createCut(req, res, url) {
  const id = randomUUID();
  const dir = path.join(DATA, id);
  await mkdir(dir, { recursive: true });
  const ext = (req.headers['content-type'] ?? '').includes('mp4') ? 'mp4' : 'mov';
  const input = path.join(dir, `source.${ext}`);

  let bytes = 0;
  req.on('data', (c) => {
    bytes += c.length;
    if (bytes > MAX_BYTES) req.destroy(new Error('too large'));
  });
  try {
    await pump(req, createWriteStream(input));
  } catch {
    return send(res, 413, { error: 'Video is too large (1 GB max).' });
  }
  if (!bytes) return send(res, 400, { error: 'No video in the request body.' });

  const q = url.searchParams;
  const options = {
    captions: q.get('captions') === '1',
    language: q.get('lang') === 'es' ? 'spanish' : 'english',
    plan: {
      ...(q.has('maxGap') && { maxGap: Math.min(1.5, Math.max(0.1, Number(q.get('maxGap')) || 0.3)) }),
      removeFillers: q.get('fillers') !== '0',
      removeRetakes: q.get('retakes') !== '0',
    },
  };

  const job = { id, dir, input, output: path.join(dir, 'cut.mp4'), stage: 'queued', createdAt: new Date().toISOString(), bytes };
  jobs.set(id, job);
  await saveJob(job);
  send(res, 201, { id });

  queue = queue.then(async () => {
    try {
      const result = await autocut(input, job.output, {
        ...options,
        onStage: (stage, r) => {
          job.stage = stage;
          if (r) Object.assign(job, r);
          console.log(`[${id.slice(0, 8)}] ${stage}`);
        },
      });
      Object.assign(job, result, { stage: result.segments.length ? 'ready' : 'failed' });
      if (!result.segments.length) job.error = "Couldn't hear any speech in this take.";
    } catch (err) {
      console.error(err);
      Object.assign(job, { stage: 'failed', error: 'Something went wrong while cutting this take.' });
    }
    await saveJob(job);
  });
}

async function sendVideo(req, res, job) {
  if (job.stage !== 'ready') return send(res, 409, { error: 'Not ready yet.' });
  const { size } = await stat(job.output);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return createReadStream(job.output, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  createReadStream(job.output).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/cuts') return await createCut(req, res, url);
    if (req.method === 'GET' && parts[0] === 'cuts' && parts[1]) {
      const job = await loadJob(parts[1]);
      if (!job) return send(res, 404, { error: 'No cut with that id.' });
      if (parts[2] === 'video') return await sendVideo(req, res, job);
      return send(res, 200, publicJob(job));
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});

await mkdir(DATA, { recursive: true });
server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;
  console.log(`Autocut server on http://localhost:${PORT}${lan ? `  (phone: http://${lan}:${PORT})` : ''}`);
});
