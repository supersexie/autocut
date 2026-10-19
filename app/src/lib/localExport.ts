// The phone export's job: the same edit the server renders (exportBody), turned into what the
// native exporter (modules/autocut-export) needs: local files, looks resolved, and captions split
// into what's on screen when (one per word for word-by-word styles), exactly as src/ass.js does.
import type { Grade } from './grade.mjs';
import { withLook, type StylePreset } from './look.ts';

type BodyWord = { text: string; start: number; end: number };
type BodyLine = { start: number; end: number; words: BodyWord[] };
type Look = { box?: boolean; outline?: boolean; color?: string; font?: string; align?: 'left' | 'center' | 'right' };

/** The parts of exportBody(...) the phone export reads. */
export type ExportBody = {
  clips: { start: number; end: number; speed?: number; volume?: number; grade?: Grade }[];
  overlapAudio?: boolean;
  captions?: { style: string; box?: boolean; outline?: boolean; color?: string; x?: number; y?: number; scale?: number; lines: BodyLine[] };
  texts: ({ text: string; style: string; start: number; end: number; x: number; y: number; scale: number } & Look)[];
  music?: { upload: string; volume: number; start?: number; end?: number; from?: number };
  keyframes: { t: number; scale: number; x: number; y: number }[];
  overlays: { upload: string; kind: 'image' | 'video'; start: number; end: number; from?: number; x: number; y: number; width: number; rotation?: number; volume?: number }[];
  height?: number;
  fps?: number;
};

export type NativeStyle = {
  font: string;
  size: number;
  color: string;
  outline?: string;
  outlineWidth?: number;
  box?: string;
  shadow?: number;
  rotate?: number;
  glow?: number;
  highlightMode?: 'box' | 'color' | 'single';
  highlightColor?: string;
};
export type CaptionEvent = { start: number; end: number; words: string[]; active: number };

/** Where captions sit unless moved (CAPTION_X / CAPTION_Y in edit.ts). */
const CAPTION_X = 0.5;
const CAPTION_Y = 0.76;

function nativeStyle(p: StylePreset, scale = 1): NativeStyle {
  return {
    font: p.font,
    size: (p.size ?? 1) * scale,
    color: p.color,
    outline: p.outline,
    outlineWidth: p.outlineWidth ?? 0,
    box: p.box,
    shadow: p.shadow ?? 0,
    rotate: p.rotate ?? 0,
    glow: p.glow ?? 0,
    highlightMode: p.highlight?.mode,
    highlightColor: p.highlight?.color,
  };
}

/** What's on screen when: lines never overlap, and word-by-word styles get one event per word. */
export function captionEvents(lines: BodyLine[], p: StylePreset): CaptionEvent[] {
  const up = (t: string) => (p.uppercase ? t.toUpperCase() : t);
  const ordered = [...lines].sort((a, b) => a.start - b.start);
  const clamped = ordered.map((l, i) => (i + 1 < ordered.length && ordered[i + 1].start < l.end ? { ...l, end: Math.max(l.start + 0.05, ordered[i + 1].start) } : l));
  const events: CaptionEvent[] = [];
  for (const line of clamped) {
    const words = line.words.filter((w) => w.text);
    const mode = p.highlight?.mode;
    if (!mode || !words.length) {
      if (words.length) events.push({ start: line.start, end: line.end, words: words.map((w) => up(w.text)), active: -1 });
      continue;
    }
    words.forEach((w, i) => {
      const start = i === 0 ? line.start : w.start;
      const end = i + 1 < words.length ? words[i + 1].start : line.end;
      if (end <= start) return;
      events.push(mode === 'single' ? { start, end, words: [up(w.text)], active: -1 } : { start, end, words: words.map((x) => up(x.text)), active: i });
    });
  }
  return events;
}

/**
 * The native exporter's job. `files` gives local file URIs: the source, where to write, the song,
 * each overlay by its upload id, and each caption font by family. `grade` turns a clip's grade into
 * its LUT file and effects (nativeGrade in gradeFiles.ts).
 */
export function exportSpec(
  body: ExportBody,
  presets: { captions: StylePreset[]; texts: StylePreset[] },
  files: { source: string; output: string; music?: string; overlays: Record<string, string>; fonts: Record<string, string>; grade?: (g: Grade | undefined) => object | undefined }
) {
  const caps = body.captions;
  let captions;
  if (caps?.lines.length) {
    const p = withLook(presets.captions.find((c) => c.id === caps.style) ?? presets.captions[0], { box: caps.box, outline: caps.outline, color: caps.color });
    captions = { style: nativeStyle(p, caps.scale ?? 1), x: caps.x ?? CAPTION_X, y: caps.y ?? CAPTION_Y, events: captionEvents(caps.lines, p) };
  }
  const texts = body.texts.map((t) => {
    const p = withLook(presets.texts.find((x) => x.id === t.style) ?? presets.texts[0], t);
    return { style: nativeStyle(p, t.scale ?? 1), text: p.uppercase ? t.text.toUpperCase() : t.text, start: t.start, end: t.end, x: t.x ?? 0.5, y: t.y ?? 0.5, align: t.align ?? 'center' };
  });
  return {
    source: files.source,
    output: files.output,
    height: body.height ?? 1080,
    fps: body.fps ?? 30,
    clips: body.clips.map((c) => ({ start: c.start, end: c.end, speed: c.speed ?? 1, volume: c.volume ?? 1, ...(c.grade && files.grade ? { grade: files.grade(c.grade) } : {}) })),
    overlap: body.overlapAudio !== false,
    music: body.music && files.music ? (({ upload: _, ...m }) => ({ ...m, file: files.music! }))(body.music) : undefined,
    keyframes: body.keyframes,
    overlays: body.overlays.filter((o) => files.overlays[o.upload]).map(({ upload, ...o }) => ({ ...o, file: files.overlays[upload] })),
    captions,
    texts,
    fonts: files.fonts,
  };
}
