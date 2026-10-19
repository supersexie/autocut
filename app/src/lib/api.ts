import Constants from 'expo-constants';
import { File, UploadType } from 'expo-file-system';
import { openBrowserAsync } from 'expo-web-browser';
import { cutsDir, deletePreviews, getSettings, previewsDir, type Cut, type Word } from './store';
import { sleep } from './theme';
import { supabase } from './supabase';

export type Stage = 'scheduled' | 'queued' | 'joining' | 'reading' | 'listening' | 'cutting' | 'ready' | 'failed' | 'stopped';

export type Job = {
  id: string;
  stage: Stage;
  progress: number;
  error?: string;
  duration?: number;
  keptDuration?: number;
  cuts?: Cut[];
  segments?: { start: number; end: number; text: string }[];
  words?: Word[];
  render?: { id: string; stage: 'queued' | 'rendering' | 'ready' | 'failed'; progress: number; error?: string; size?: number };
};

/** In development the server runs on the same Mac as the Expo dev server, so reuse its address. */
export function autoServerUrl() {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? 'localhost'}:8787`;
}

/** Settings override (development) → EXPO_PUBLIC_API_URL (the deployed server) → the Mac running Expo. */
export const serverUrl = () =>
  (getSettings().serverUrl.trim() || process.env.EXPO_PUBLIC_API_URL || autoServerUrl()).replace(/\/+$/, '');

/** Opens the privacy policy or terms, which the server hosts at /privacy and /terms. */
export const openLegal = (page: 'privacy' | 'terms') => openBrowserAsync(`${serverUrl()}/${page}`).catch(() => {});

/** The signed-in user's access token, which the server checks on every request. */
async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ServerUnreachable extends Error {
  constructor(base: string, detail?: string) {
    // The Mac hint only makes sense when the app is pointed at a server on the Mac running Expo.
    super(
      __DEV__ && base === autoServerUrl().replace(/\/+$/, '')
        ? `Can't reach the Autocut server at ${base}. Start it on your Mac with "npm run server", and keep your phone on the same Wi-Fi.`
        : "Couldn't reach Autocut. Check your internet connection and try again." + (detail ? ` (${detail})` : '')
    );
  }
}

async function call(path: string, init?: RequestInit) {
  const base = serverUrl();
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(await authHeaders()) } });
  } catch (e) {
    throw new ServerUnreachable(base, __DEV__ && e instanceof Error ? `${path.split('?')[0]}: ${e.message}` : undefined);
  }
  const body = await res.json().catch(() => null);
  if (res.status >= 502 && res.status <= 504) throw new ServerUnreachable(base); // restarting or swamped: try again
  if (!res.ok) throw new Error(body?.error ?? `Server error (${res.status}).`);
  return body;
}

export const checkServer = async () => (await call('/health')).ok === true;

export async function uploadTake(uri: string, mime: string, onProgress: (fraction: number) => void): Promise<string> {
  const base = serverUrl();
  const file = new File(uri);
  // Ask for a signed link, then send the file straight to storage (Cloudflare R2), not through
  // our servers. A server from before direct uploads doesn't know /uploads/sign: send it there.
  let signed: { id: string; url: string; headers: Record<string, string> } | null = null;
  try {
    signed = await call('/uploads/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: mime, size: file.size }) });
  } catch (e) {
    if (e instanceof ServerUnreachable || !(e instanceof Error) || !/\(404\)|Not found/.test(e.message)) throw e;
  }
  let result;
  try {
    result = signed
      ? await file.upload(signed.url, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: signed.headers,
          onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0),
        })
      : await file.upload(`${base}/uploads`, {
          httpMethod: 'POST',
          uploadType: UploadType.BINARY_CONTENT,
          headers: { 'content-type': mime, ...(await authHeaders()) },
          onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0),
        });
  } catch (e) {
    // While testing, say what actually went wrong sending the file (to storage or to us).
    if (__DEV__) console.warn('Upload failed:', signed ? new URL(signed.url).host : base, e);
    throw new ServerUnreachable(base, __DEV__ && e instanceof Error ? e.message : undefined);
  }
  // 502–504: restarting (a new version going live) or swamped. Worth another go.
  if (result.status >= 502 && result.status <= 504) throw new ServerUnreachable(base);
  if (signed) {
    if (result.status < 200 || result.status >= 300) throw new Error(`Upload failed (${result.status}).`);
    return signed.id;
  }
  let body: { id?: string; error?: string } | null = null;
  try {
    body = JSON.parse(result.body);
  } catch {}
  if (result.status !== 201 || !body?.id) throw new Error(body?.error ?? `Upload failed (${result.status}).`);
  return body.id;
}

/**
 * Where to fetch one of a cut's videos: a signed link straight to storage, or (from a server
 * before direct downloads) the server itself, with the sign-in token.
 */
async function videoUrl(path: string): Promise<{ url: string; headers: Record<string, string> }> {
  const sep = path.includes('?') ? '&' : '?';
  const linked = await call(`${path}${sep}link=1`).catch(() => null);
  if (typeof linked?.url === 'string') return { url: linked.url, headers: {} };
  return { url: serverUrl() + path, headers: await authHeaders() };
}

/** Starts cutting the uploads, or with `at` (ms since 1970) has the server cut them at that time. */
export async function createCut(uploadIds: string[], flips: boolean[], language: string, blend = false, batch = false, at?: number): Promise<string> {
  const s = getSettings();
  const query = [
    `uploads=${uploadIds.join(',')}`,
    `flips=${flips.map((f) => (f ? 1 : 0)).join(',')}`,
    `blend=${blend ? 1 : 0}`,
    `batch=${batch ? 1 : 0}`,
    `maxGap=${s.maxGap}`,
    `fillers=${s.removeFillers ? 1 : 0}`,
    `retakes=${s.removeRetakes ? 1 : 0}`,
    `lang=${language}`,
    ...(at ? [`at=${Math.round(at)}`] : []),
  ].join('&');
  return (await call(`/cuts?${query}`, { method: 'POST' })).id;
}

export const deleteAccountOnServer = () => call('/account', { method: 'DELETE' });

/** Records on the server what the user agreed to (and when): the terms, and AI use of their videos. */
export const postConsent = (consent: { termsVersion?: string; ai?: boolean }) =>
  call('/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(consent) });

export type Me = { plan: string | null; paid: string | null; termsVersion: string };

/** A Whop checkout link for this account (the server attaches the account to it). */
export async function startWhopCheckout(plan: string, billing: string): Promise<string> {
  return (await call('/billing/whop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, billing }) })).url;
}
export const getMe = (): Promise<Me> => call('/me');

export const getJob = (id: string): Promise<Job> => call(`/cuts/${id}`);

/** The take's loudness for the timeline: `peaks` (0–100), `rate` of them a second. */
export const getWaveform = (id: string): Promise<{ rate: number; peaks: number[] }> => call(`/cuts/${id}/waveform`);
export const stopJob = (id: string): Promise<Job> => call(`/cuts/${id}/stop`, { method: 'POST' });

export async function startRender(id: string, body: object) {
  return (await call(`/cuts/${id}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })).renderId as string;
}

/**
 * The edit stitched into one small video by the server and downloaded to the cache, so the editor
 * can play straight through the cuts. Resolves to the file's URI, or undefined if `alive()` turns
 * false first or the server couldn't make it. An edit previewed before comes straight from cache.
 */
export async function previewOf(
  cutId: string,
  serverId: string,
  clips: { start: number; end: number; speed: number; volume: number; grade?: object }[],
  alive: () => boolean
) {
  // `cutId` names the files on the phone; `serverId` is the same cut on the server.
  const body = JSON.stringify({ clips: clips.map(({ start, end, speed, volume, grade }) => ({ start, end, speed, volume, grade })) });
  let { key, stage } = await call(`/cuts/${serverId}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (!previewsDir.exists) previewsDir.create({ intermediates: true });
  const file = new File(previewsDir, `${cutId}-${key}.mp4`);
  if (file.exists) return file.uri;
  while (stage === 'rendering') {
    await sleep(700);
    if (!alive()) return;
    ({ stage } = await call(`/cuts/${serverId}/preview?key=${key}&status=1`));
  }
  if (stage !== 'ready' || !alive()) return;
  const { url, headers } = await videoUrl(`/cuts/${serverId}/preview?key=${key}`);
  await File.downloadFileAsync(url, file, { headers });
  deletePreviews(cutId, file.name);
  return file.uri;
}

/** Downloads a file from the server into the cuts folder and returns its file name. */
export async function download(path: string, name: string, onProgress?: (fraction: number) => void) {
  const file = new File(cutsDir, name);
  if (file.exists) file.delete();
  try {
    const { url, headers } = await videoUrl(path);
    await File.downloadFileAsync(url, file, {
      headers,
      onProgress: onProgress && (({ bytesWritten, totalBytes }) => onProgress(totalBytes ? bytesWritten / totalBytes : 0)),
    });
  } catch {
    throw new ServerUnreachable(serverUrl());
  }
  return file.name;
}
