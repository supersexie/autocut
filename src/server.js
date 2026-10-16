#!/usr/bin/env node
// HTTP API the mobile app talks to. Runs as ROLE=api (just this), ROLE=worker (just the heavy
// work, see worker.js) or ROLE=all (both, the default: local development and small deployments).
// Any number of either can run at once: they share the database (db.js) and storage (storage.js).
//
//   POST /uploads/sign                 { type, size }                     -> { id, url, method, headers }  (the phone PUTs the file to url: straight to storage)
//   POST /uploads                      body: raw bytes (older apps)       -> { id }
//   POST /cuts?uploads=a,b&flips=1,0&blend=1&maxGap=0.3&fillers=1&retakes=1&lang=en -> { id }   (joins takes, un-mirrors selfies, finds cuts)
//        &at=<ms since 1970>          scheduled: kept as stage "scheduled" and cut at that time (up to 30 days ahead)
//   GET  /cuts/:id                                                        -> stage, progress, words, segments, cuts, render
//   POST /cuts/:id/stop                                                   -> stops a cut that hasn't finished
//   GET  /cuts/:id/source[?link=1]                                        -> the video the editor plays (link=1: { url } to fetch it from storage)
//   POST /cuts/:id/render              { clips, captions, texts, music: {upload, volume}, keyframes, overlapAudio?, overlays: [{upload, …}], height, fps, bitrate } -> { renderId }
//   GET  /cuts/:id/video[?link=1]                                         -> the latest finished export
//   POST /cuts/:id/preview             { clips }                          -> { key, stage }  (a small stitched preview of the edit)
//   GET  /cuts/:id/preview?key=K[&status=1|&link=1]                       -> the preview, or { stage } while it renders
//   GET  /cuts/:id/waveform                                               -> { rate, peaks }: loudness 0–100, `rate` points a second
//   GET  /me                                                              -> { plan, plans, consent, termsVersion }
//   POST /consent                      { termsVersion?, ai? }             -> records what the user agreed to
//   POST /billing/whop                 { plan, billing }                  -> { url }  (Whop checkout for this account)
//   DELETE /account                                                       -> deletes the user, their videos and cuts
//   POST /webhooks/whop, /webhooks/revenuecat                             (payments, signed by Whop / RevenueCat)
//   GET  /health, /privacy, /terms                                        (public)
// Every other route needs `Authorization: Bearer <Supabase access token>` (see auth.js).
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { accountFrom, authEnabled, deleteAuthUser, LOCAL_USER, planOf, plansOf, setPlanFrom } from './auth.js';
import { effectivePlan, revenueCatChange, verifyWhop, whopChange, whopCheckout } from './billing.js';
import { openDb } from './db.js';
import { parseClips, parseRender, PREVIEW_KEY, previewKey } from './edits.js';
import { legalPage, TERMS_VERSION } from './legal.js';
import { rulesFor } from './plans.js';
import { WAVEFORM_RATE } from './pipeline.js';
import { openStorage } from './storage.js';
import { cutKey, previewName, startWorker, sweep } from './worker.js';

const PORT = Number(process.env.PORT ?? 8787);
const ROLE = process.env.ROLE ?? 'all';
const DATA = path.resolve(process.env.AUTOCUT_DATA ?? new URL('../data', import.meta.url).pathname);
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 1024) * 1024 * 1024;
// Jobs at once per worker process: Whisper/ffmpeg each use every core, so keep it low and add workers.
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 1));
const MAX_AHEAD = 30 * 864e5; // how far ahead an edit can be scheduled
const ID = /^[0-9a-f-]{36}$/;
const USER = /^([0-9a-f-]{36}|local)$/;
const UPLOAD = /^[0-9a-f-]{36}\.(mov|mp4|jpg|png|mp3|m4a|wav|aac)$/;

if (!process.env.DATABASE_URL) console.warn('No DATABASE_URL: using a local database in', path.join(DATA, 'db'), '(one server only).');
const db = await openDb({ dir: path.join(DATA, 'db') });
const storage = await openStorage({ dir: path.join(DATA, 'blobs') });
if (storage.kind === 'local') console.warn('No R2_* settings: videos are kept on this machine in', storage.root);
// Checked once at start, and shown on /health, so a wrong key shows up right away (not on the first upload).
const checks = { storage: storage.kind };
if (storage.check) {
  storage.check().then((problem) => {
    checks.storageOk = !problem;
    if (problem) checks.storageError = problem;
    console.log(problem ? `Storage check FAILED: ${problem}` : 'Storage check: R2 works (signed upload, read, delete).');
  });
}
if (process.env.DEEPGRAM_API_KEY) {
  fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } })
    .then((r) => {
      checks.deepgramOk = r.ok;
      console.log(r.ok ? 'Deepgram check: key works.' : `Deepgram check FAILED: HTTP ${r.status}`);
    })
    .catch((e) => console.log(`Deepgram check FAILED: ${e.message}`));
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

// The address the phone used to reach us, for signed links when videos are kept on this machine.
const baseOf = (req) => `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

/** A cut as the app sees it (the waveform has its own route; storage keys stay private). */
function publicCut(c) {
  const result = c.result ?? {};
  const { waveform, ...found } = result;
  // A scheduled cut whose time has come is waiting for a free worker.
  const stage = c.stage === 'scheduled' && c.at && new Date(c.at) <= new Date() ? 'queued' : c.stage;
  return {
    id: c.id,
    stage,
    progress: c.progress,
    error: c.error ?? undefined,
    takes: c.takes,
    at: c.at ? new Date(c.at).getTime() : undefined,
    createdAt: new Date(c.created_at).toISOString(),
    ...found,
    render: c.render ? { id: c.render.id, stage: c.render.stage, progress: c.render.progress, error: c.render.error, size: c.render.size } : undefined,
  };
}

/** A cut, only if it belongs to `userId` (cuts from before the shared database are brought over). */
async function loadCut(id, userId) {
  if (!ID.test(id)) return null;
  const cut = (await db.getCut(id)) ?? (await importLegacy(id));
  return cut && cut.user_id === userId ? cut : null;
}

async function readText(req, limit = 1e6) {
  let text = '';
  for await (const c of req) {
    text += c;
    if (text.length > limit) throw new Error('too large');
  }
  return text;
}
const jsonBody = async (req) => JSON.parse((await readText(req)) || '{}');

// ---- Uploads: straight from the phone to storage, kept until the account is deleted.
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/aac': 'aac' };
const extFor = (type = '') => EXTENSIONS[type.split(';')[0].trim()] ?? (type.includes('mp4') ? 'mp4' : 'mov');
const uploadKey = (userId, id) => `users/${userId}/uploads/${id}`;

async function signUpload(req, res, userId) {
  let body;
  try {
    body = await jsonBody(req);
  } catch {
    return send(res, 400, { error: 'Bad upload request.' });
  }
  const type = String(body.type || 'video/quicktime');
  if (Number(body.size) > MAX_BYTES) return send(res, 413, { error: 'That take is too large (1 GB max).' });
  const id = `${randomUUID()}.${extFor(type)}`;
  const url = await storage.signPut(uploadKey(userId, id), type, baseOf(req));
  send(res, 201, { id, url, method: 'PUT', headers: { 'content-type': type } });
}

/** Older apps send the bytes to us; they're passed on to storage. */
async function legacyUpload(req, res, userId) {
  const id = `${randomUUID()}.${extFor(req.headers['content-type'])}`;
  const tmp = path.join(DATA, 'tmp', id);
  await mkdir(path.dirname(tmp), { recursive: true });
  try {
    let bytes = 0;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > MAX_BYTES) req.destroy(new Error('too large'));
    });
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(req, createWriteStream(tmp));
    if (!bytes) return send(res, 400, { error: 'No video in the request body.' });
    await storage.put(tmp, uploadKey(userId, id), req.headers['content-type']);
    send(res, 201, { id });
  } catch {
    send(res, 413, { error: 'That take is too large (1 GB max).' });
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Storage keys for upload ids the app names, or null if any is missing. */
async function uploadKeys(ids, userId) {
  if (!ids.length || ids.some((u) => !UPLOAD.test(u))) return null;
  const keys = ids.map((u) => uploadKey(userId, u));
  const sizes = await Promise.all(keys.map((k) => storage.size(k)));
  return sizes.every((s) => s && s <= MAX_BYTES) ? keys : null;
}

// ---- Cuts
async function createCut(req, res, url, userId) {
  const plan = await planOf(userId);
  if (!plan && process.env.PAYMENTS_REQUIRED === '1') return send(res, 402, { error: 'Choose a plan to start editing.', code: 'plan' });
  const rules = rulesFor(plan);
  const q = url.searchParams;
  const at = Number(q.get('at'));
  const scheduled = Number.isFinite(at) && at > Date.now() + 30e3;
  // What the plan includes: scheduling edits for later, and a number of edits a month.
  if (scheduled && !rules.schedule) return send(res, 403, { error: `Scheduled batch edits are on Pro and Ultimate. You're on ${rules.name}.`, code: 'plan' });
  if (scheduled && at > Date.now() + MAX_AHEAD) return send(res, 400, { error: 'You can schedule an edit up to 30 days ahead.' });
  if ((await db.used(userId)) >= rules.edits) return send(res, 402, { error: `You've used all ${rules.edits} edits on ${rules.name} this month. Upgrade for more.`, code: 'limit' });

  let keys;
  if (q.get('uploads')) keys = await uploadKeys(q.get('uploads').split(',').slice(0, 50), userId);
  else return send(res, 400, { error: 'No takes to cut. Update the app and try again.' });
  if (!keys) return send(res, 400, { error: 'One of the takes is missing. Record it again.' });

  const id = randomUUID();
  const run = {
    uploads: keys,
    flips: (q.get('flips') ?? '').split(',').map((f) => f === '1'),
    blend: q.get('blend') === '1',
    options: {
      language: q.get('lang') === 'es' ? 'spanish' : 'english',
      plan: {
        ...(q.has('maxGap') && { maxGap: Math.min(1.5, Math.max(0.1, Number(q.get('maxGap')) || 0.3)) }),
        removeFillers: q.get('fillers') !== '0',
        removeRetakes: q.get('retakes') !== '0',
      },
    },
  };
  await db.createCut({ id, userId, stage: scheduled ? 'scheduled' : 'queued', takes: keys.length, at: scheduled ? at : null, run });
  await db.addUse(userId, 1); // counted now, so edits started together can't slip past the limit
  await db.addTask({ cutId: id, kind: 'cut', runAt: scheduled ? at : undefined });
  send(res, 201, { id });
}

async function stopCut(res, cut) {
  if (!['ready', 'failed', 'stopped'].includes(cut.stage)) {
    await db.updateCut(cut.id, { stage: 'stopped', error: 'You stopped this cut.', run: null });
    await db.stopTasks(cut.id, 'cut');
    await db.addUse(cut.user_id, -1); // a stopped cut doesn't use up an edit
    cut = await db.getCut(cut.id);
  }
  send(res, 200, publicCut(cut));
}

async function createRender(req, res, cut, userId) {
  if (cut.stage !== 'ready') return send(res, 409, { error: 'This cut is not ready to export yet.' });
  if (cut.render && ['queued', 'rendering'].includes(cut.render.stage)) return send(res, 409, { error: 'Already exporting this cut.' });
  let body;
  try {
    body = await jsonBody(req);
  } catch {
    return send(res, 400, { error: 'Bad export request.' });
  }
  const rules = rulesFor(await planOf(userId));
  const parsed = parseRender(body, { duration: cut.result.duration, words: cut.result.words, overlapAllowed: rules.overlap });
  if (parsed.error) return send(res, 400, { error: parsed.error });
  // A song, photos and clips laid into the export, each uploaded first like a take.
  let music;
  if (parsed.music) {
    const [key] = (await uploadKeys([parsed.music.upload], userId)) ?? [];
    if (!key) return send(res, 400, { error: 'The song didn’t upload. Try exporting again.' });
    music = { key, volume: parsed.music.volume };
  }
  const overlays = [];
  for (const o of parsed.overlays) {
    const [key] = (await uploadKeys([o.upload], userId)) ?? [];
    if (!key) return send(res, 400, { error: 'An overlay didn’t upload. Try exporting again.' });
    const { upload, ...rest } = o;
    overlays.push({ ...rest, key });
  }
  const renderId = randomUUID();
  await db.updateCut(cut.id, { render: { id: renderId, stage: 'queued', progress: 0 } });
  await db.addTask({ cutId: cut.id, kind: 'render', payload: { renderId, edit: parsed.edit, music, overlays }, priority: 2 });
  send(res, 201, { renderId });
}

// ---- Previews: the edit stitched into one small video, so the editor can play straight through
// the cuts (the phone can't stitch clips itself in Expo Go). A newer edit of a cut replaces one of
// its previews still waiting.
async function previewStage(cut, key) {
  if ((await storage.size(cutKey(cut.user_id, cut.id, previewName(key)))) !== null) return 'ready';
  const task = await db.taskFor(cut.id, 'preview', key);
  return task && ['queued', 'running'].includes(task.status) ? 'rendering' : 'failed';
}

async function createPreview(req, res, cut) {
  if (cut.stage !== 'ready') return send(res, 409, { error: 'This cut is not ready yet.' });
  let body;
  try {
    body = await jsonBody(req);
  } catch {
    return send(res, 400, { error: 'Bad preview request.' });
  }
  const clips = parseClips(body.clips, cut.result.duration);
  if (!clips.length) return send(res, 400, { error: 'There is nothing in this edit to preview.' });
  const key = previewKey(clips);
  const stage = await previewStage(cut, key);
  if (stage === 'ready') return send(res, 200, { key, stage });
  if (stage === 'failed') {
    await db.dropWaitingPreviews(cut.id);
    await db.addTask({ cutId: cut.id, kind: 'preview', payload: { key, clips }, priority: 10 });
  }
  send(res, 202, { key, stage: 'rendering' });
}

// ---- Downloads: a signed link straight to storage (link=1), or streamed through us for older apps.
async function sendStored(req, res, url, key, type, filename) {
  if (url.searchParams.has('link')) return send(res, 200, { url: await storage.signGet(key, { filename, base: baseOf(req) }) });
  if (storage.kind === 'local') return sendFile(req, res, storage.fileOf(key), type);
  const range = /bytes=\d*-\d*/.exec(req.headers.range ?? '')?.[0];
  const obj = await storage.read(key, range);
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'content-length': obj.length };
  if (range && obj.range) res.writeHead(206, { ...headers, 'content-range': obj.range });
  else res.writeHead(200, headers);
  obj.body.pipe(res);
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

/** Signed links for videos kept on this machine (development): the stand-in for R2. */
async function blob(req, res, token) {
  const claims = storage.kind === 'local' && storage.verify(token);
  if (!claims || claims.m !== req.method) return send(res, 403, { error: 'Link expired.' });
  if (req.method === 'PUT') {
    await storage.write(req, claims.k);
    res.writeHead(200, { 'access-control-allow-origin': '*' });
    return res.end();
  }
  const file = storage.fileOf(claims.k);
  if (!(await stat(file).catch(() => null))) return send(res, 404, { error: 'Not found' });
  if (claims.f) res.setHeader('content-disposition', `attachment; filename="${claims.f}"`);
  return sendFile(req, res, file, file.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
}

// ---- Account
async function me(res, userId) {
  const plans = await plansOf(userId);
  send(res, 200, { plan: (await planOf(userId)) ?? null, paid: effectivePlan(plans), plans, consent: await db.consentOf(userId), termsVersion: TERMS_VERSION });
}

async function consent(req, res, userId) {
  let body;
  try {
    body = await jsonBody(req);
  } catch {
    return send(res, 400, { error: 'Bad request.' });
  }
  const termsVersion = typeof body.termsVersion === 'string' ? body.termsVersion.slice(0, 40) : undefined;
  await db.setConsent(userId, { termsVersion, ai: typeof body.ai === 'boolean' ? body.ai : undefined });
  send(res, 200, { consent: await db.consentOf(userId) });
}

async function deleteAccount(res, userId) {
  await db.deleteCutsOf(userId); // their jobs go with them
  await storage.removePrefix(`users/${userId}/`);
  await db.forgetUsage(userId);
  await db.forgetConsent(userId);
  await deleteAuthUser(userId);
  console.log(`[account] deleted ${userId.slice(0, 8)}`);
  send(res, 200, { ok: true });
}

// ---- Payments
async function whopWebhook(req, res) {
  const raw = await readText(req);
  if (!verifyWhop(req.headers, raw, process.env.WHOP_WEBHOOK_SECRET)) return send(res, 401, { error: 'bad signature' });
  const change = whopChange(JSON.parse(raw));
  if (change) {
    await setPlanFrom('whop', change);
    console.log(`[billing] whop ${change.active ? 'on' : 'off'} ${change.plan} for ${change.userId.slice(0, 8)}`);
  }
  send(res, 200, { ok: true });
}

async function revenueCatWebhook(req, res) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected || req.headers.authorization !== expected) return send(res, 401, { error: 'unauthorized' });
  const change = revenueCatChange(JSON.parse(await readText(req)));
  if (change && ID.test(change.userId)) {
    await setPlanFrom('apple', change);
    console.log(`[billing] apple ${change.active ? 'on' : 'off'} ${change.plan} for ${change.userId.slice(0, 8)}`);
  }
  send(res, 200, { ok: true });
}

// ---- Cuts made before the shared database (kept in folders under DATA) come over the first
// time they're asked for: their video moves to storage and the cut gets a row.
async function importLegacy(id) {
  const dir = path.join(DATA, id);
  let job;
  try {
    job = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8'));
  } catch {
    return null;
  }
  const userId = job.userId ?? LOCAL_USER;
  let source = null;
  if (job.stage === 'ready' && job.source) {
    const file = path.join(dir, path.basename(job.source));
    if (await stat(file).catch(() => null)) {
      source = cutKey(userId, id, `source${path.extname(file)}`);
      const { copyFile } = await import('node:fs/promises');
      const tmp = path.join(DATA, 'tmp', `${id}${path.extname(file)}`);
      await mkdir(path.dirname(tmp), { recursive: true });
      await copyFile(file, tmp);
      await storage.put(tmp, source, 'video/mp4');
    }
  }
  const ready = job.stage === 'ready' && source;
  const { duration, keptDuration, segments, cuts, words, waveform } = job;
  await db.createCut({ id, userId, stage: ready ? 'ready' : 'failed', takes: job.takes ?? 1, source, createdAt: job.createdAt });
  await db.updateCut(id, ready ? { progress: 1, result: { duration, keptDuration, segments, cuts, words, waveform } } : { error: 'This cut is from an older version. Send the take again.' });
  return db.getCut(id);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const [root, id, action] = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && root === 'health') return send(res, 200, { ok: true, role: ROLE, ...checks, ...(await db.queueStats()) });
    if (ROLE === 'worker') return send(res, 404, { error: 'Not found' });
    if (req.method === 'GET' && (root === 'privacy' || root === 'terms') && !id) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(await legalPage(root));
    }
    if (root === 'blobs' && id && (req.method === 'PUT' || req.method === 'GET')) return await blob(req, res, id);
    if (req.method === 'POST' && root === 'webhooks' && id === 'whop') return await whopWebhook(req, res);
    if (req.method === 'POST' && root === 'webhooks' && id === 'revenuecat') return await revenueCatWebhook(req, res);

    const account = await accountFrom(req);
    const userId = account?.id;
    if (!userId || !USER.test(userId)) return send(res, 401, { error: 'Your session ended. Sign in again.' });

    if (req.method === 'POST' && root === 'uploads' && id === 'sign') return await signUpload(req, res, userId);
    if (req.method === 'POST' && root === 'uploads' && !id) return await legacyUpload(req, res, userId);
    if (req.method === 'POST' && root === 'cuts' && !id) return await createCut(req, res, url, userId);
    if (req.method === 'GET' && root === 'me' && !id) return await me(res, userId);
    if (req.method === 'POST' && root === 'consent' && !id) return await consent(req, res, userId);
    if (req.method === 'POST' && root === 'billing' && id === 'whop') {
      try {
        return send(res, 200, { url: await whopCheckout(userId, await jsonBody(req)) });
      } catch (e) {
        return send(res, e.status ?? 500, { error: e.message });
      }
    }
    if (req.method === 'DELETE' && root === 'account' && !id) return await deleteAccount(res, userId);
    if (root === 'cuts' && id) {
      const cut = await loadCut(id, userId);
      if (!cut) return send(res, 404, { error: 'No cut with that id.' });
      if (req.method === 'GET' && !action) return send(res, 200, publicCut(cut));
      if (req.method === 'POST' && action === 'stop') return await stopCut(res, cut);
      if (req.method === 'POST' && action === 'render') return await createRender(req, res, cut, userId);
      if (req.method === 'POST' && action === 'preview') return await createPreview(req, res, cut);
      if (req.method === 'GET' && action === 'source') {
        if (!cut.source || cut.stage !== 'ready') return send(res, 409, { error: 'Not ready yet.' });
        return await sendStored(req, res, url, cut.source, cut.source.endsWith('.mp4') ? 'video/mp4' : 'video/quicktime');
      }
      if (req.method === 'GET' && action === 'waveform') {
        if (cut.stage !== 'ready') return send(res, 409, { error: 'Not ready yet.' });
        return send(res, 200, { rate: WAVEFORM_RATE, peaks: cut.result?.waveform ?? [] });
      }
      if (req.method === 'GET' && action === 'preview') {
        const key = url.searchParams.get('key') ?? '';
        if (!PREVIEW_KEY.test(key)) return send(res, 400, { error: 'Bad preview key.' });
        const stage = await previewStage(cut, key);
        if (url.searchParams.has('status') || stage !== 'ready') return send(res, stage === 'ready' ? 200 : 202, { stage });
        return await sendStored(req, res, url, cutKey(cut.user_id, cut.id, previewName(key)), 'video/mp4');
      }
      if (req.method === 'GET' && action === 'video') {
        if (cut.render?.stage !== 'ready') return send(res, 409, { error: 'Not exported yet.' });
        return await sendStored(req, res, url, cut.render.key, 'video/mp4', 'Autocut.mp4');
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});

if (ROLE === 'worker' || ROLE === 'all') {
  const w = startWorker({ db, storage, concurrency: CONCURRENCY, workDir: path.join(DATA, 'work') });
  console.log(`Worker ${w.name} taking jobs (${CONCURRENCY} at a time)`);
}
// Every server keeps an eye out for jobs whose worker died, and puts them back on the list.
setInterval(() => sweep(db).catch((err) => console.error('sweep', err.message)), 30_000).unref();
if (!authEnabled) console.warn('Auth is off (no SUPABASE_URL): every request runs as one local user. Fine for development only.');
server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;
  console.log(`Autocut ${ROLE} on http://localhost:${PORT}${lan ? `  (phone: http://${lan}:${PORT})` : ''}`);
});
