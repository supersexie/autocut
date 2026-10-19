import { cleanGrade, gradeKey } from '../app/src/lib/grade.mjs';
import { createHash } from 'node:crypto';

// Checks and clamps what the app sends for previews and exports. Shared by the API (which checks
// requests) and the workers (which make the first preview of a fresh cut).

/** Clips from a request (or a cut's own segments), checked and clamped to the source. */
export function parseClips(raw, duration) {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 500)
    .map((c) => ({
      start: Math.max(0, Number(c.start)),
      end: Math.min(duration, Number(c.end)),
      speed: Math.min(10, Math.max(0.25, Number(c.speed) || 1)),
      volume: Math.min(2, Math.max(0, c.volume === undefined ? 1 : Number(c.volume))),
      // Colour (the Adjust tool): checked and trimmed to what's known; left off when it changes nothing.
      ...(cleanGrade(c.grade) ? { grade: cleanGrade(c.grade) } : {}),
    }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end - c.start >= 0.05);
}

// Previews are named by a hash of the clips, so an edit previewed before (an undo, reopening the
// editor) is ready at once.
export const PREVIEW_KEY = /^[0-9a-f]{16}$/;
export const previewKey = (clips) =>
  createHash('sha1')
    .update(JSON.stringify(clips.map((c) => [...[c.start, c.end, c.speed, c.volume].map((n) => Math.round(n * 1000)), ...(c.grade ? [gradeKey(c.grade)] : [])])))
    .digest('hex')
    .slice(0, 16);

// Caption lines (4 words max) on the output timeline, for clients that don't send their own.
export function defaultLines(words, clips) {
  const lines = [];
  let offset = 0;
  for (const c of clips) {
    const inClip = words.filter((w) => w.start >= c.start - 0.05 && w.end <= c.end + 0.05);
    for (let i = 0; i < inClip.length; i += 4) {
      const group = inClip.slice(i, i + 4).map((w) => ({
        text: w.text,
        start: offset + (Math.max(w.start, c.start) - c.start) / c.speed,
        end: offset + (Math.min(w.end, c.end) - c.start) / c.speed,
      }));
      lines.push({ start: group[0].start, end: group.at(-1).end + 0.2, words: group });
    }
    offset += (c.end - c.start) / c.speed;
  }
  return lines;
}

const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : undefined);
const bool = (b) => (typeof b === 'boolean' ? b : undefined);
const clamp = (n, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(Number(n)) && n !== null ? Number(n) : d));

/**
 * An export request, checked. Returns { edit, music, overlays } where music and overlays still
 * name upload ids (the API turns them into storage keys), or { error }.
 */
export function parseRender(body, { duration, words = [], overlapAllowed }) {
  // `clips` (speed/volume per clip) from the editor, or plain `segments` [[start, end]].
  const raw = Array.isArray(body.clips) ? body.clips : Array.isArray(body.segments) ? body.segments.map(([start, end]) => ({ start, end })) : [];
  const clips = parseClips(raw, duration);
  if (!clips.length) return { error: 'There is nothing left in this cut to export.' };
  const height = [480, 720, 1080, 1440, 2160].includes(Number(body.height)) ? Number(body.height) : undefined;
  const fps = [24, 25, 30, 60].includes(Number(body.fps)) ? Number(body.fps) : undefined;
  const bitrate = [4, 8, 12, 20, 30, 60].includes(Number(body.bitrate)) ? Number(body.bitrate) : undefined;
  const wordsOf = (list) =>
    (Array.isArray(list) ? list : []).slice(0, 2000).map((w) => ({ text: String(w.text ?? '').slice(0, 80), start: Number(w.start) || 0, end: Number(w.end) || 0 }));
  let captions;
  if (body.captions && Array.isArray(body.captions.lines)) {
    const c = body.captions;
    captions = {
      style: String(c.style ?? 'classic'),
      box: bool(c.box),
      outline: bool(c.outline),
      color: hex(c.color),
      // Where the user moved captions to (x: middle, y: bottom edge, 0–1 of the frame) and their size.
      x: Number.isFinite(Number(c.x)) && c.x !== null ? clamp(c.x, 0, 1) : undefined,
      y: Number.isFinite(Number(c.y)) && c.y !== null ? clamp(c.y, 0, 1) : undefined,
      scale: Number(c.scale) > 0 ? clamp(c.scale, 0.3, 4) : undefined,
      lines: c.lines.slice(0, 2000).map((l) => ({ start: Number(l.start) || 0, end: Number(l.end) || 0, words: wordsOf(l.words) })),
    };
  } else if (body.captions === true) {
    // Older clients: default captions from the transcript.
    captions = { style: 'classic', lines: defaultLines(words, clips) };
  }
  const texts = (Array.isArray(body.texts) ? body.texts : []).slice(0, 50).map((t) => ({
    text: String(t.text ?? '').slice(0, 200),
    style: String(t.style ?? 'classic'),
    start: Number(t.start) || 0,
    end: Number(t.end) || 0,
    x: clamp(t.x ?? 0.5, 0, 1, 0.5),
    y: clamp(t.y ?? 0.5, 0, 1, 0.5),
    scale: Math.min(3, Math.max(0.3, Number(t.scale) || 1)),
    font: typeof t.font === 'string' ? t.font.slice(0, 60) : undefined,
    color: hex(t.color),
    box: bool(t.box),
    outline: bool(t.outline),
    align: ['left', 'center', 'right'].includes(t.align) ? t.align : undefined,
  }));
  // Zoom and pan over time, on the output timeline: the picture's scale and how far it's moved.
  const keyframes = (Array.isArray(body.keyframes) ? body.keyframes : [])
    .slice(0, 200)
    .map((k) => ({ t: Math.max(0, Number(k.t) || 0), scale: clamp(k.scale || 1, 1, 4, 1), x: clamp(k.x || 0, -1.5, 1.5, 0), y: clamp(k.y || 0, -1.5, 1.5, 0) }))
    .sort((a, b) => a.t - b.t);
  // Fade each cut's sound across the next one's (on unless the app says otherwise; Pro and Ultimate).
  const overlapAudio = body.overlapAudio !== false && !!overlapAllowed;
  // The song: where it starts and stops in the output and how far into it to begin (each optional).
  let music;
  if (body.music?.upload) {
    const m = body.music;
    const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : undefined);
    const start = num(m.start);
    const end = num(m.end);
    const from = num(m.from);
    music = {
      upload: String(m.upload),
      volume: Math.min(1, Math.max(0, Number(m.volume) || 0.5)),
      ...(start ? { start } : {}),
      ...(end !== undefined && end > (start ?? 0) ? { end } : {}),
      ...(from ? { from } : {}),
    };
  }
  const overlays = (Array.isArray(body.overlays) ? body.overlays : []).slice(0, 20).map((o) => {
    const start = Math.max(0, Number(o.start) || 0);
    return {
      upload: String(o.upload ?? ''),
      kind: o.kind === 'video' ? 'video' : 'image',
      start,
      end: Math.max(start + 0.05, Number(o.end) || start + 3),
      from: Math.max(0, Number(o.from) || 0),
      x: clamp(o.x, -1, 2, 0.5),
      y: clamp(o.y, -1, 2, 0.5),
      width: Math.min(4, Math.max(0.02, Number(o.width) || 0.5)),
      rotation: Math.max(-360, Math.min(360, Number(o.rotation) || 0)),
      volume: Math.min(2, Math.max(0, o.volume === undefined ? 1 : Number(o.volume))),
    };
  });
  return { edit: { clips, captions, texts, keyframes, overlapAudio, height, fps, bitrate }, music, overlays };
}
