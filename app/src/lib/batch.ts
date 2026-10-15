import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import type { Take } from './jobs';

/** One video in a batch being put together: its clips in order, combined when the batch is edited. */
export type BatchVideo = { key: string; takes: Take[]; blend: boolean };

export const MAX_VIDEOS = 10;
export const MAX_CLIPS = 20;

// Kept on the phone so a batch can be put together over time; clips deleted since are dropped.
const file = new File(Paths.document, 'batch-draft.json');

let videos: BatchVideo[] = (() => {
  try {
    const saved = file.exists ? (JSON.parse(file.textSync()) as BatchVideo[]) : [];
    return saved.map((v) => ({ ...v, takes: v.takes.filter((t) => new File(t.uri).exists) })).filter((v) => v.takes.length);
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function save(next: BatchVideo[]) {
  videos = next;
  if (videos.length) file.write(JSON.stringify(videos));
  else if (file.exists) file.delete();
  listeners.forEach((l) => l());
}

const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Adds a video made of these clips and returns its key. */
export function addVideo(takes: Take[]) {
  const key = newKey();
  save([...videos, { key, takes: takes.slice(0, MAX_CLIPS), blend: true }]);
  return key;
}

/** Changes one video, from its current state. */
export function updateVideo(key: string, change: (video: BatchVideo) => BatchVideo) {
  save(
    videos.map((v) => {
      if (v.key !== key) return v;
      const next = change(v);
      return { ...next, takes: next.takes.slice(0, MAX_CLIPS) };
    })
  );
}

export const removeVideo = (key: string) => save(videos.filter((v) => v.key !== key));
export const clearBatch = () => save([]);

export const useBatch = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => videos
  );
