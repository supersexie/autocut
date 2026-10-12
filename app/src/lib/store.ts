import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

export type CutReason = 'dead air' | 'filler' | 'stutter' | 'retake';
export type Cut = { start: number; end: number; reason: CutReason; text: string };
export type Word = { text: string; start: number; end: number };
/** A kept [start, end] range of the source video, in play order. */
export type Clip = [number, number];

export type CutStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export type CutRecord = {
  id: string;
  serverId?: string;
  createdAt: string;
  title: string;
  status: CutStatus;
  stage?: string;
  progress: number; // 0–1 for the current status
  error?: string;
  takes: number;
  /** First raw take on this phone, for the thumbnail while cutting. */
  previewUri?: string;
  duration: number;
  words: Word[];
  cuts: Cut[]; // what Autocut removed originally
  clips: Clip[]; // the current edit
  source?: string; // file name of the downloaded source video in the cuts folder
  exports: number;
};

export type Settings = {
  maxGap: number;
  removeFillers: boolean;
  removeRetakes: boolean;
  captions: boolean;
  serverUrl: string; // empty = use the Mac running the dev server
};

const DEFAULT_SETTINGS: Settings = { maxGap: 0.3, removeFillers: true, removeRetakes: true, captions: true, serverUrl: '' };

export const cutsDir = new Directory(Paths.document, 'cuts');
const indexFile = new File(cutsDir, 'index-v2.json');
const settingsFile = new File(Paths.document, 'settings.json');

function readJson<T>(file: File, fallback: T): T {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as T) : fallback;
  } catch {
    return fallback;
  }
}

cutsDir.create({ intermediates: true, idempotent: true });

let state = {
  cuts: readJson<CutRecord[]>(indexFile, []),
  settings: { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(settingsFile, {}) },
};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const emit = () => listeners.forEach((l) => l());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Progress ticks arrive often; write the index at most twice a second.
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => indexFile.write(JSON.stringify(state.cuts)), 500);
};

export const cutFile = (name: string) => new File(cutsDir, name);
export const getCut = (id: string) => state.cuts.find((c) => c.id === id);
export const getCuts = () => state.cuts;

export function addCut(record: CutRecord) {
  state = { ...state, cuts: [record, ...state.cuts.filter((c) => c.id !== record.id)] };
  persist();
  emit();
}

export function updateCut(id: string, patch: Partial<CutRecord>) {
  state = { ...state, cuts: state.cuts.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
  persist();
  emit();
}

export function deleteCut(id: string) {
  const record = getCut(id);
  if (record?.source) {
    const file = cutFile(record.source);
    if (file.exists) file.delete();
  }
  state = { ...state, cuts: state.cuts.filter((c) => c.id !== id) };
  persist();
  emit();
}

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  settingsFile.write(JSON.stringify(state.settings));
  emit();
}

export const getSettings = () => state.settings;
export const useCuts = () => useSyncExternalStore(subscribe, () => state.cuts);
export const useCut = (id: string) => useSyncExternalStore(subscribe, () => getCut(id));
export const useSettings = () => useSyncExternalStore(subscribe, () => state.settings);

export const clipsDuration = (clips: Clip[]) => clips.reduce((t, [s, e]) => t + e - s, 0);
