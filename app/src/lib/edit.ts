// Pure editing operations. Clips are kept source ranges in play order, each with its own
// speed and volume; everything shown to the user is on the "output" timeline (after speed).
import type { Cut, Word } from './store';

export type ClipEdit = { start: number; end: number; speed: number; volume: number };
export type Caps = 'none' | 'upper' | 'lower' | 'title';
export type CaptionSettings = {
  enabled: boolean;
  style: string;
  caps: Caps;
  punctuation: boolean;
  wordsPerLine: number;
  /** Text the user typed over a line, keyed by the line's first word (source time, cs). */
  edits: Record<string, string>;
};
export type TextOverlay = { id: string; text: string; style: string; start: number; end: number; x: number; y: number; scale: number };
export type Edit = { clips: ClipEdit[]; muted: boolean; captions: CaptionSettings; texts: TextOverlay[] };

const MIN = 0.1; // shortest clip worth keeping, in seconds

export const DEFAULT_CAPTIONS: CaptionSettings = { enabled: true, style: 'classic', caps: 'none', punctuation: true, wordsPerLine: 3, edits: {} };

export const makeClip = (start: number, end: number): ClipEdit => ({ start, end, speed: 1, volume: 1 });
export const outDuration = (c: ClipEdit) => (c.end - c.start) / c.speed;
export const totalDuration = (clips: ClipEdit[]) => clips.reduce((t, c) => t + outDuration(c), 0);

/** Where clip `i` starts on the output timeline. */
export function clipOffset(clips: ClipEdit[], i: number) {
  let t = 0;
  for (let k = 0; k < i; k++) t += outDuration(clips[k]);
  return t;
}

/** Output time → [clip index, source time]. */
export function locate(clips: ClipEdit[], t: number): [number, number] {
  let offset = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = outDuration(clips[i]);
    if (t < offset + d) return [i, clips[i].start + Math.max(0, t - offset) * clips[i].speed];
    offset += d;
  }
  const last = clips.length - 1;
  return [last, clips[last]?.end ?? 0];
}

/** Source time inside clip `i` → output time. */
export const toOutput = (clips: ClipEdit[], i: number, source: number) => clipOffset(clips, i) + (source - clips[i].start) / clips[i].speed;

export function splitAt(clips: ClipEdit[], t: number): ClipEdit[] {
  const [i, source] = locate(clips, t);
  const c = clips[i];
  if (!c || source - c.start < MIN || c.end - source < MIN) return clips;
  return [...clips.slice(0, i), { ...c, end: source }, { ...c, start: source }, ...clips.slice(i + 1)];
}

export const removeClip = (clips: ClipEdit[], i: number) => clips.filter((_, k) => k !== i);
export const duplicateClip = (clips: ClipEdit[], i: number) => (clips[i] ? [...clips.slice(0, i + 1), { ...clips[i] }, ...clips.slice(i + 1)] : clips);
export const updateClip = (clips: ClipEdit[], i: number, patch: Partial<ClipEdit>) => clips.map((c, k) => (k === i ? { ...c, ...patch } : c));

export function moveClip(clips: ClipEdit[], from: number, to: number) {
  if (from === to || !clips[from]) return clips;
  const next = clips.slice();
  const [c] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, c);
  return next;
}

/** Moves a clip's edges (source seconds), keeping it inside the take and at least MIN long. */
export function trimClip(clips: ClipEdit[], i: number, edges: { start?: number; end?: number }, sourceDuration: number) {
  const c = clips[i];
  if (!c) return clips;
  const start = Math.max(0, Math.min(edges.start ?? c.start, c.end - MIN));
  const end = Math.min(sourceDuration, Math.max(edges.end ?? c.end, start + MIN));
  return updateClip(clips, i, { start, end });
}

/** Is any part of this original cut back in the edit? */
export const isRestored = (clips: ClipEdit[], cut: Cut) => clips.some((c) => c.start < cut.end - 0.02 && c.end > cut.start + 0.02);

/** Puts a removed range back, joining any clip it touches, else at its place in source order. */
export function restoreCut(clips: ClipEdit[], cut: Cut): ClipEdit[] {
  const touching = (c: ClipEdit) => c.start <= cut.end + 0.02 && c.end >= cut.start - 0.02;
  const i = clips.findIndex(touching);
  if (i === -1) {
    const at = clips.findIndex((c) => c.start > cut.start);
    const clip = makeClip(cut.start, cut.end);
    return at === -1 ? [...clips, clip] : [...clips.slice(0, at), clip, ...clips.slice(at)];
  }
  let j = i;
  while (j + 1 < clips.length && touching(clips[j + 1])) j++;
  const merged = { ...clips[i], start: Math.min(cut.start, clips[i].start), end: Math.max(cut.end, clips[j].end) };
  return [...clips.slice(0, i), merged, ...clips.slice(j + 1)];
}

export function applyCaps(text: string, caps: Caps) {
  if (caps === 'upper') return text.toUpperCase();
  if (caps === 'lower') return text.toLowerCase();
  if (caps === 'title') return text.replace(/\b(\p{L})(\p{L}*)/gu, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
  return text;
}

const stripPunctuation = (text: string) => text.replace(/[.,!?;:…"“”]+/g, '');

export type CaptionWord = { text: string; start: number; end: number }; // output time
export type CaptionLine = { key: string; clip: number; start: number; end: number; text: string; words: CaptionWord[] };

/** Caption lines on the output timeline, with grouping, formatting and the user's edits applied. */
export function captionLines(words: Word[], clips: ClipEdit[], s: CaptionSettings): CaptionLine[] {
  const lines: CaptionLine[] = [];
  clips.forEach((c, ci) => {
    const inClip = words.filter((w) => w.start >= c.start - 0.05 && w.end <= c.end + 0.05);
    const groups: Word[][] = [];
    let cur: Word[] = [];
    for (const w of inClip) {
      cur.push(w);
      if (cur.length >= s.wordsPerLine || /[.?!]$/.test(w.text)) {
        groups.push(cur);
        cur = [];
      }
    }
    if (cur.length) groups.push(cur);
    for (const g of groups) {
      const key = String(Math.round(g[0].start * 100));
      const start = toOutput(clips, ci, Math.max(c.start, g[0].start));
      const end = Math.min(toOutput(clips, ci, c.end), toOutput(clips, ci, Math.min(c.end, g[g.length - 1].end)) + 0.2);
      let out: CaptionWord[] = g.map((w) => ({
        text: w.text,
        start: toOutput(clips, ci, Math.max(c.start, w.start)),
        end: toOutput(clips, ci, Math.min(c.end, w.end)),
      }));
      const edited = s.edits[key];
      if (edited !== undefined) {
        // Spread the typed words evenly over the line's time.
        const typed = edited.split(/\s+/).filter(Boolean);
        const span = (end - start) / Math.max(1, typed.length);
        out = typed.map((t, k) => ({ text: t, start: start + k * span, end: start + (k + 1) * span }));
      }
      out = out
        .map((w) => ({ ...w, text: applyCaps(s.punctuation ? w.text : stripPunctuation(w.text), s.caps) }))
        .filter((w) => w.text);
      lines.push({ key, clip: ci, start, end, text: out.map((w) => w.text).join(' '), words: out });
    }
  });
  return lines;
}

/** The body the server's export expects. */
export function exportBody(edit: Edit, words: Word[], opts: { height?: number; fps?: number; bitrate?: number }) {
  return {
    clips: edit.clips.map((c) => ({ ...c, volume: edit.muted ? 0 : c.volume })),
    captions: edit.captions.enabled
      ? { style: edit.captions.style, lines: captionLines(words, edit.clips, edit.captions).map(({ start, end, words: w }) => ({ start, end, words: w })) }
      : undefined,
    texts: edit.texts.map(({ text, style, start, end, x, y, scale }) => ({ text, style, start, end, x, y, scale })),
    ...opts,
  };
}
