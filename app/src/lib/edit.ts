import type { Clip, Cut, Word } from './store';

// Pure editing operations on a list of clips (kept [start, end] source ranges, in play order).

const MIN = 0.1; // shortest clip worth keeping, in seconds

/** Where clip `i` starts on the edited timeline. */
export function clipOffset(clips: Clip[], i: number) {
  let t = 0;
  for (let k = 0; k < i; k++) t += clips[k][1] - clips[k][0];
  return t;
}

/** Edited-timeline time → [clip index, source time]. */
export function locate(clips: Clip[], t: number): [number, number] {
  let offset = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = clips[i][1] - clips[i][0];
    if (t < offset + d) return [i, clips[i][0] + Math.max(0, t - offset)];
    offset += d;
  }
  const last = clips.length - 1;
  return [last, clips[last]?.[1] ?? 0];
}

/** Splits the clip under the edited-timeline time `t` in two. */
export function splitAt(clips: Clip[], t: number): Clip[] {
  const [i, source] = locate(clips, t);
  const clip = clips[i];
  if (!clip || source - clip[0] < MIN || clip[1] - source < MIN) return clips;
  return [...clips.slice(0, i), [clip[0], source], [source, clip[1]], ...clips.slice(i + 1)];
}

export const removeClip = (clips: Clip[], i: number): Clip[] => clips.filter((_, k) => k !== i);

export const duplicateClip = (clips: Clip[], i: number): Clip[] =>
  clips[i] ? [...clips.slice(0, i + 1), [...clips[i]] as Clip, ...clips.slice(i + 1)] : clips;

/** Is any part of this original cut back in the edit? */
export const isRestored = (clips: Clip[], cut: Cut) => clips.some(([s, e]) => s < cut.end - 0.02 && e > cut.start + 0.02);

/**
 * Puts a removed range back. It joins any clip that touches it, otherwise it goes in at its place
 * in source order.
 */
export function restoreCut(clips: Clip[], cut: Cut): Clip[] {
  const range: Clip = [cut.start, cut.end];
  const touching = (c: Clip) => c[0] <= range[1] + 0.02 && c[1] >= range[0] - 0.02;
  const i = clips.findIndex(touching);
  if (i === -1) {
    const at = clips.findIndex((c) => c[0] > range[0]);
    return at === -1 ? [...clips, range] : [...clips.slice(0, at), range, ...clips.slice(at)];
  }
  // Merge the range with every consecutive clip it touches.
  let j = i;
  while (j + 1 < clips.length && touching(clips[j + 1])) j++;
  const merged: Clip = [Math.min(range[0], clips[i][0]), Math.max(range[1], clips[j][1])];
  return [...clips.slice(0, i), merged, ...clips.slice(j + 1)];
}

export type CaptionLine = { text: string; start: number; end: number }; // source times

/** Short UGC-style caption lines (up to 4 words) for each clip's words. */
export function captionLines(words: Word[], clips: Clip[]): CaptionLine[][] {
  return clips.map(([s, e]) => {
    const inClip = words.filter((w) => w.start >= s - 0.05 && w.end <= e + 0.05);
    const lines: CaptionLine[] = [];
    let cur: Word[] = [];
    const flush = () => {
      if (cur.length) lines.push({ text: cur.map((w) => w.text).join(' '), start: cur[0].start, end: cur[cur.length - 1].end + 0.25 });
      cur = [];
    };
    for (const w of inClip) {
      if (cur.length >= 4 || [...cur, w].map((x) => x.text).join(' ').length > 22) flush();
      cur.push(w);
      if (/[.?!,]$/.test(w.text)) flush();
    }
    flush();
    return lines;
  });
}
