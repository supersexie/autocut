import Constants from 'expo-constants';
import { File, UploadType } from 'expo-file-system';
import { cutsDir, getSettings, type Clip, type Cut, type Word } from './store';

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

export const serverUrl = () => (getSettings().serverUrl.trim() || autoServerUrl()).replace(/\/+$/, '');

export class ServerUnreachable extends Error {
  constructor(base: string) {
    super(`Can't reach the Autocut server at ${base}. Start it on your Mac with "npm run server", and keep your phone on the same Wi-Fi.`);
  }
}

async function call(path: string, init?: RequestInit) {
  const base = serverUrl();
  let res: Response;
  try {
    res = await fetch(base + path, init);
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
      headers: { 'content-type': mime },
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

export async function createCut(uploadIds: string[], language: string): Promise<string> {
  const s = getSettings();
  const query = [
    `uploads=${uploadIds.join(',')}`,
    `maxGap=${s.maxGap}`,
    `fillers=${s.removeFillers ? 1 : 0}`,
    `retakes=${s.removeRetakes ? 1 : 0}`,
    `lang=${language}`,
  ].join('&');
  return (await call(`/cuts?${query}`, { method: 'POST' })).id;
}

export const getJob = (id: string): Promise<Job> => call(`/cuts/${id}`);
export const stopJob = (id: string): Promise<Job> => call(`/cuts/${id}/stop`, { method: 'POST' });

export async function startRender(id: string, clips: Clip[], options: { captions: boolean; height?: number; fps?: number }) {
  return (await call(`/cuts/${id}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments: clips, ...options }),
  })).renderId as string;
}

/** Downloads a file from the server into the cuts folder and returns its file name. */
export async function download(path: string, name: string, onProgress?: (fraction: number) => void) {
  const file = new File(cutsDir, name);
  if (file.exists) file.delete();
  try {
    await File.downloadFileAsync(serverUrl() + path, file, {
      onProgress: onProgress && (({ bytesWritten, totalBytes }) => onProgress(totalBytes ? bytesWritten / totalBytes : 0)),
    });
  } catch {
    throw new ServerUnreachable(serverUrl());
  }
  return file.name;
}
