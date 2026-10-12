import Constants from 'expo-constants';
import { File, UploadType } from 'expo-file-system';
import { cutsDir, type Cut, type Segment, type Settings } from './store';

export type Stage = 'queued' | 'reading' | 'listening' | 'cutting' | 'rendering' | 'ready' | 'failed';

export type Job = {
  id: string;
  stage: Stage;
  error?: string;
  duration?: number;
  keptDuration?: number;
  cuts?: Cut[];
  segments?: Segment[];
  words?: { text: string; start: number; end: number }[];
};

/** In development the server runs on the same Mac as the Expo dev server, so reuse its address. */
export function autoServerUrl() {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? 'localhost'}:8787`;
}

export const serverUrl = (s: Settings) => (s.serverUrl.trim() || autoServerUrl()).replace(/\/+$/, '');

export class ServerUnreachable extends Error {
  constructor(base: string) {
    super(`Can't reach the Autocut server at ${base}. Start it on your Mac with "npm run server", and keep your phone on the same Wi-Fi.`);
  }
}

async function request(base: string, path: string) {
  try {
    return await fetch(base + path);
  } catch {
    throw new ServerUnreachable(base);
  }
}

export async function checkServer(base: string) {
  const res = await request(base, '/health');
  return res.ok;
}

export async function uploadTake(uri: string, mime: string, settings: Settings, language: string, onProgress: (fraction: number) => void) {
  const base = serverUrl(settings);
  const query = [
    `maxGap=${settings.maxGap}`,
    `fillers=${settings.removeFillers ? 1 : 0}`,
    `retakes=${settings.removeRetakes ? 1 : 0}`,
    `captions=${settings.captions ? 1 : 0}`,
    `lang=${language}`,
  ].join('&');
  let result;
  try {
    result = await new File(uri).upload(`${base}/cuts?${query}`, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'content-type': mime },
      onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0),
    });
  } catch {
    throw new ServerUnreachable(base);
  }
  const body = safeJson(result.body);
  if (result.status !== 201 || !body?.id) throw new Error(body?.error ?? `Upload failed (${result.status}).`);
  return body.id as string;
}

export async function getJob(base: string, id: string): Promise<Job> {
  const res = await request(base, `/cuts/${id}`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Server error (${res.status}).`);
  return res.json();
}

/** Downloads the finished cut into the app's documents so it plays and shares offline. */
export async function downloadCut(base: string, id: string) {
  const file = new File(cutsDir, `${id}.mp4`);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/cuts/${id}/video`, file);
  return file.name;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
