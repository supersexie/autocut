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
  /** Override the style's background box / black outline (undefined = the style's own). */
  box?: boolean;
  outline?: boolean;
  /** Where every caption sits: x is its middle, y its bottom edge, as fractions of the frame. */
  x?: number;
  y?: number;
  /** Size, on top of the style's own. */
  scale?: number;
  /** Words (keyed like `edits`) that start a new line: where the user split a caption. */
  breaks?: string[];
};

/** Where captions sit unless moved: centred, bottom edge 24% up from the bottom of the frame. */
export const CAPTION_X = 0.5;
export const CAPTION_Y = 0.76;
export type TextAlign = 'left' | 'center' | 'right';
/** Per-text changes made on top of its style (font, colour, background box, alignment). */
export type TextLook = { font?: string; color?: string; box?: boolean; outline?: boolean; align?: TextAlign };
export type TextOverlay = { id: string; text: string; style: string; start: number; end: number; x: number; y: number; scale: number } & TextLook;
/** A song under the whole video: a file in the cuts folder, looped if it's shorter than the video. */
export type Music = { file: string; name: string; mime: string; duration: number; volume: number };

/** How the picture is framed: zoomed by `scale` (≥ 1) about the centre, then moved by x·width, y·height. */
export type Framing = { scale: number; x: number; y: number };
/** A framing pinned to a moment of the output; the picture glides between keyframes. */
export type Keyframe = Framing & { id: string; t: number };

/**
 * A photo or video laid over the main video for a stretch of it. Position, size and angle are in
 * frame terms: centre at (x, y) as fractions of the frame, `width` as a fraction of the frame's
 * width (height follows the media's shape), `rotation` in degrees clockwise.
 */
export type Overlay = {
  id: string;
  /** File name in the cuts folder. */
  file: string;
  kind: 'image' | 'video';
  mime: string;
  /** The media's own size in pixels (for its shape). */
  w: number;
  h: number;
  /** Output seconds it's on screen for. */
  start: number;
  end: number;
  /** Video: where in the video it starts, and how long the video is. */
  from: number;
  length: number;
  x: number;
  y: number;
  width: number;
  rotation: number;
  volume: number;
  muted?: boolean;
};

export type Edit = {
  clips: ClipEdit[];
  muted: boolean;
  captions: CaptionSettings;
  texts: TextOverlay[];
  /** Output time of the frame used as the cover (the first frame of the export). */
  cover?: number;
  music?: Music;
  /** Zoom and pan over time, sorted by `t` (output seconds). */
  keyframes?: Keyframe[];
  /** Photos and videos over the video, drawn in order (later ones on top). */
  overlays?: Overlay[];
};

export const MIN_OVERLAY = 0.3; // shortest an overlay can be on screen

/** An overlay's height as a fraction of the frame's height, for a frame of this shape (w / h). */
export const overlayHeight = (o: Pick<Overlay, 'w' | 'h' | 'width'>, frameAspect: number) => (o.width * frameAspect * o.h) / o.w;

/** Overlays showing at output time `t`, bottom to top. */
export const overlaysAt = (overlays: Overlay[] | undefined, t: number) => (overlays ?? []).filter((o) => t >= o.start && t < o.end);

/** Splits overlay `id` at `t` into two back-to-back overlays (a video carries on where it was). */
export function splitOverlay(overlays: Overlay[], id: string, t: number, newId: () => string): Overlay[] {
  const i = overlays.findIndex((o) => o.id === id);
  const o = overlays[i];
  if (!o || t - o.start < MIN_OVERLAY || o.end - t < MIN_OVERLAY) return overlays;
  const first = { ...o, end: t };
  const second = { ...o, id: newId(), start: t, from: o.kind === 'video' ? o.from + (t - o.start) : 0 };
  return [...overlays.slice(0, i), first, second, ...overlays.slice(i + 1)];
}

/** Moves an overlay's start or end (or both, to slide it), keeping it on the timeline and, for a video, inside its footage. */
export function retimeOverlay(o: Overlay, change: { start?: number; end?: number }, total: number): Overlay {
  if (change.start !== undefined && change.end !== undefined) {
    const span = o.end - o.start;
    const start = Math.max(0, Math.min(total - span, change.start));
    return { ...o, start, end: start + span };
  }
  if (change.start !== undefined) {
    // A video's start can't go earlier than its first frame.
    const earliest = o.kind === 'video' ? o.start - o.from : 0;
    const start = Math.max(Math.max(0, earliest), Math.min(o.end - MIN_OVERLAY, change.start));
    return { ...o, start, from: o.kind === 'video' ? o.from + (start - o.start) : 0 };
  }
  if (change.end !== undefined) {
    const latest = o.kind === 'video' ? o.start + (o.length - o.from) : total;
    return { ...o, end: Math.min(total, latest, Math.max(o.start + MIN_OVERLAY, change.end)) };
  }
  return o;
}

export const NO_FRAMING: Framing = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;

/** Ease in and out (cubic): the same curve the server renders with. */
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** The framing at output time `t`: held before the first and after the last keyframe, eased between. */
export function framingAt(keyframes: Keyframe[] | undefined, t: number): Framing {
  if (!keyframes?.length) return NO_FRAMING;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (t <= first.t) return { scale: first.scale, x: first.x, y: first.y };
  if (t >= last.t) return { scale: last.scale, x: last.x, y: last.y };
  const i = keyframes.findIndex((k, n) => t >= k.t && t < keyframes[n + 1].t);
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const u = ease((t - a.t) / Math.max(0.001, b.t - a.t));
  return { scale: a.scale + (b.scale - a.scale) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** Keeps the picture filling the frame: zoom 1–4×, and never moved far enough to show an edge. */
export function clampFraming({ scale, x, y }: Framing): Framing {
  const s = Math.max(1, Math.min(MAX_ZOOM, scale));
  const room = (s - 1) / 2;
  return { scale: s, x: Math.max(-room, Math.min(room, x)), y: Math.max(-room, Math.min(room, y)) };
}

/** The keyframe at (or within a frame or so of) `t`, if there is one. */
export const keyframeAt = (keyframes: Keyframe[] | undefined, t: number, within = 0.05) =>
  keyframes?.find((k) => Math.abs(k.t - t) <= within);

/** `keyframes` with `k` added, or replacing the one at its id, kept in time order. */
export const putKeyframe = (keyframes: Keyframe[] | undefined, k: Keyframe) =>
  [...(keyframes ?? []).filter((x) => x.id !== k.id), k].sort((a, b) => a.t - b.t);

/** Source time of the edit's cover frame: the chosen one, or a moment into the first clip. */
export function coverSource(edit: Pick<Edit, 'clips' | 'cover'>) {
  if (edit.cover === undefined) return (edit.clips[0]?.start ?? 0) + 0.3;
  return locate(edit.clips, Math.max(0, Math.min(edit.cover, totalDuration(edit.clips) - 0.01)))[1];
}

/** How long the cover frame is held at the very start of the export (two frames, just a flash). */
export const COVER_FRAME = 0.06;

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

const wordKey = (w: Word) => String(Math.round(w.start * 100));

/** Splits caption `line` at output time `t` into two lines (null if there's nothing to split, or it was retyped). */
export function splitCaption(s: CaptionSettings, line: CaptionLine, t: number): CaptionSettings | null {
  if (s.edits[line.key] !== undefined) return null;
  // The first word that starts at or after the playhead begins the new line (not the line's own first word).
  const i = line.words.findIndex((w) => w.start >= t - 0.01);
  const key = line.words[i]?.key;
  if (i < 1 || !key) return null;
  return { ...s, breaks: [...(s.breaks ?? []), key] };
}

/** Takes a caption line out (undo brings it back). */
export const deleteCaption = (s: CaptionSettings, line: CaptionLine): CaptionSettings => ({ ...s, edits: { ...s.edits, [line.key]: '' } });

const stripPunctuation = (text: string) => text.replace(/[.,!?;:…"“”]+/g, '');

export type CaptionWord = { text: string; start: number; end: number; key?: string }; // output time; key = the source word's, like a line's
export type CaptionLine = { key: string; clip: number; start: number; end: number; text: string; words: CaptionWord[] };

/** Caption lines on the output timeline, with grouping, formatting and the user's edits applied. */
export function captionLines(words: Word[], clips: ClipEdit[], s: CaptionSettings): CaptionLine[] {
  const lines: CaptionLine[] = [];
  clips.forEach((c, ci) => {
    const inClip = words.filter((w) => w.start >= c.start - 0.05 && w.end <= c.end + 0.05);
    const groups: Word[][] = [];
    let cur: Word[] = [];
    const breaks = new Set(s.breaks ?? []);
    for (const w of inClip) {
      if (cur.length && breaks.has(wordKey(w))) {
        groups.push(cur);
        cur = [];
      }
      cur.push(w);
      if (cur.length >= s.wordsPerLine || /[.?!]$/.test(w.text)) {
        groups.push(cur);
        cur = [];
      }
    }
    if (cur.length) groups.push(cur);
    for (const g of groups) {
      const key = wordKey(g[0]);
      const start = toOutput(clips, ci, Math.max(c.start, g[0].start));
      const end = Math.min(toOutput(clips, ci, c.end), toOutput(clips, ci, Math.min(c.end, g[g.length - 1].end)) + 0.2);
      let out: CaptionWord[] = g.map((w) => ({
        text: w.text,
        start: toOutput(clips, ci, Math.max(c.start, w.start)),
        end: toOutput(clips, ci, Math.min(c.end, w.end)),
        key: wordKey(w),
      }));
      const edited = s.edits[key];
      if (edited === '') continue; // deleted
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
/**
 * What the server needs to render the edit. A chosen cover goes first as a two-frame flash, which
 * is what TikTok and Instagram show as the cover, and everything else moves along to make room.
 * `musicUpload` is the song's upload id, when the edit has one.
 */
export function exportBody(
  edit: Edit,
  words: Word[],
  opts: { height?: number; fps?: number; bitrate?: number },
  musicUpload?: string,
  /** Overlay id → its upload id. */
  overlayUploads: Record<string, string> = {}
) {
  const cover = edit.cover === undefined ? [] : [{ start: locate(edit.clips, edit.cover)[1], speed: 1, volume: 0 }].map((c) => ({ ...c, end: c.start + COVER_FRAME }));
  const shift = cover.length ? COVER_FRAME : 0;
  const later = <T extends { start: number; end: number }>(x: T) => ({ ...x, start: x.start + shift, end: x.end + shift });
  return {
    clips: [...cover, ...edit.clips.map((c) => ({ ...c, volume: edit.muted ? 0 : c.volume }))],
    captions: edit.captions.enabled
      ? {
          style: edit.captions.style,
          box: edit.captions.box,
          outline: edit.captions.outline,
          x: edit.captions.x,
          y: edit.captions.y,
          scale: edit.captions.scale,
          lines: captionLines(words, edit.clips, edit.captions).map(({ start, end, words: w }) => later({ start, end, words: w.map(({ text, start: ws, end: we }) => later({ text, start: ws, end: we })) })),
        }
      : undefined,
    texts: edit.texts.map(({ text, style, start, end, x, y, scale, font, color, box, outline, align }) => later({ text, style, start, end, x, y, scale, font, color, box, outline, align })),
    music: musicUpload && edit.music ? { upload: musicUpload, volume: edit.music.volume } : undefined,
    keyframes: (edit.keyframes ?? []).map(({ t, scale, x, y }) => ({ t: t + shift, scale, x, y })),
    overlays: (edit.overlays ?? [])
      .filter((o) => overlayUploads[o.id])
      .map((o) => ({
        upload: overlayUploads[o.id],
        kind: o.kind,
        start: o.start + shift,
        end: o.end + shift,
        from: o.from,
        x: o.x,
        y: o.y,
        width: o.width,
        rotation: o.rotation,
        volume: o.muted ? 0 : o.volume,
      })),
    ...opts,
  };
}
