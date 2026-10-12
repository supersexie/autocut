import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

export type CutReason = 'dead air' | 'filler' | 'stutter' | 'retake';
export type Cut = { start: number; end: number; reason: CutReason; text: string };
export type Segment = { start: number; end: number; text: string };

export type CutRecord = {
  id: string;
  createdAt: string;
  title: string;
  duration: number;
  keptDuration: number;
  cuts: Cut[];
  segments: Segment[];
  video: string; // file name inside the cuts folder (absolute paths change between app updates on iOS)
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
const indexFile = new File(cutsDir, 'index.json');
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

export const cutFile = (name: string) => new File(cutsDir, name);

export function addCut(record: CutRecord) {
  state = { ...state, cuts: [record, ...state.cuts.filter((c) => c.id !== record.id)] };
  indexFile.write(JSON.stringify(state.cuts));
  emit();
}

export function deleteCut(id: string) {
  const record = state.cuts.find((c) => c.id === id);
  if (record) {
    const file = cutFile(record.video);
    if (file.exists) file.delete();
  }
  state = { ...state, cuts: state.cuts.filter((c) => c.id !== id) };
  indexFile.write(JSON.stringify(state.cuts));
  emit();
}

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  settingsFile.write(JSON.stringify(state.settings));
  emit();
}

export const getSettings = () => state.settings;
export const useCuts = () => useSyncExternalStore(subscribe, () => state.cuts);
export const useSettings = () => useSyncExternalStore(subscribe, () => state.settings);
