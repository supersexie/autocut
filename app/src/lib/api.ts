import Constants from 'expo-constants';
import { File, UploadType } from 'expo-file-system';
import { openBrowserAsync } from 'expo-web-browser';
import { cutsDir, deletePreviews, getSettings, previewsDir, type Cut, type Word } from './store';
import { sleep } from './theme';
import { supabase } from './supabase';

export type Stage = 'queued' | 'joining' | 'reading' | 'listening' | 'cutting' | 'ready' | 'failed' | 'stopped';

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
  constructor(base: string) {
    super(
      __DEV__
        ? `Can't reach the Autocut server at ${base}. Start it on your Mac with "npm run server", and keep your phone on the same Wi-Fi.`
        : "Can't reach Autocut right now. Check your internet connection and try again."
    );
  }
}

async function call(path: string, init?: RequestInit) {
  const base = serverUrl();
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(await authHeaders()) } });
  } catch {
    throw new ServerUnreachable(base);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Server error (${res.status}).`);
  return body;
}

export const checkServer = async () => (await call('/health')).ok === true;

export async function uploadTake(uri: string, mime: string, onProgress: (fraction: number) => void): Promise<string> {
  const base = serverUrl();
  let result;
  try {
    result = await new File(uri).upload(`${base}/uploads`, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'content-type': mime, ...(await authHeaders()) },
      onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0),
    });
  } catch {
    throw new ServerUnreachable(base);
  }
  let body: { id?: string; error?: string } | null = null;
  try {
    body = JSON.parse(result.body);
  } catch {}
  if (result.status !== 201 || !body?.id) throw new Error(body?.error ?? `Upload failed (${result.status}).`);
  return body.id;
}

export async function createCut(uploadIds: string[], flips: boolean[], language: string): Promise<string> {
  const s = getSettings();
  const query = [
    `uploads=${uploadIds.join(',')}`,
    `flips=${flips.map((f) => (f ? 1 : 0)).join(',')}`,
    `maxGap=${s.maxGap}`,
    `fillers=${s.removeFillers ? 1 : 0}`,
    `retakes=${s.removeRetakes ? 1 : 0}`,
    `lang=${language}`,
  ].join('&');
  return (await call(`/cuts?${query}`, { method: 'POST' })).id;
}

export const deleteAccountOnServer = () => call('/account', { method: 'DELETE' });

export const getJob = (id: string): Promise<Job> => call(`/cuts/${id}`);
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
export async function previewOf(cutId: string, clips: { start: number; end: number; speed: number; volume: number }[], alive: () => boolean) {
  const body = JSON.stringify({ clips: clips.map(({ start, end, speed, volume }) => ({ start, end, speed, volume })) });
  let { key, stage } = await call(`/cuts/${cutId}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (!previewsDir.exists) previewsDir.create({ intermediates: true });
  const file = new File(previewsDir, `${cutId}-${key}.mp4`);
  if (file.exists) return file.uri;
  while (stage === 'rendering') {
    await sleep(700);
    if (!alive()) return;
    ({ stage } = await call(`/cuts/${cutId}/preview?key=${key}&status=1`));
  }
  if (stage !== 'ready' || !alive()) return;
  await File.downloadFileAsync(`${serverUrl()}/cuts/${cutId}/preview?key=${key}`, file, { headers: await authHeaders() });
  deletePreviews(cutId, file.name);
  return file.uri;
}

/** Downloads a file from the server into the cuts folder and returns its file name. */
export async function download(path: string, name: string, onProgress?: (fraction: number) => void) {
  const file = new File(cutsDir, name);
  if (file.exists) file.delete();
  try {
    await File.downloadFileAsync(serverUrl() + path, file, {
      headers: await authHeaders(),
      onProgress: onProgress && (({ bytesWritten, totalBytes }) => onProgress(totalBytes ? bytesWritten / totalBytes : 0)),
    });
  } catch {
    throw new ServerUnreachable(serverUrl());
  }
  return file.name;
}
