import { writeFile } from 'node:fs/promises';
import { decodeAudio, loudness, probe, render, SAMPLE_RATE } from './media.js';
import { buildAss, FONTS_DIR } from './ass.js';
import { transcribe } from './transcribe.js';
import { planCuts, noiseFloor } from './plan.js';
import { remapWords, toSrt } from './captions.js';

const round = (n) => +n.toFixed(3);

export const WAVEFORM_RATE = 20; // points per second of source

/**
 * A small picture of the sound for the editor's timeline: WAVEFORM_RATE loudness points a second,
 * each 0–100, from the quiet of the room (0) to the loudest moment (100).
 */
export function waveformOf({ db, frameSec }) {
  const per = Math.max(1, Math.round(1 / WAVEFORM_RATE / frameSec));
  const peaks = [];
  for (let f = 0; f < db.length; f += per) {
    let m = -120;
    for (let k = f; k < Math.min(db.length, f + per); k++) m = Math.max(m, db[k]);
    peaks.push(m);
  }
  const sorted = [...peaks].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.05)] ?? -60;
  const high = sorted[sorted.length - 1] ?? 0;
  const span = Math.max(6, high - low);
  return peaks.map((p) => Math.round(Math.max(0, Math.min(1, (p - low) / span)) * 100));
}

/** The waveform of a video file (for cuts made before waveforms were saved). */
export async function waveformOfFile(input) {
  return waveformOf(loudness(await decodeAudio(input)));
}

// Finds the cuts. Reports (stage, fraction 0–1 across the whole analysis).
export async function analyze(input, { plan: planOpts = {}, model, language, onProgress = () => {} } = {}) {
  onProgress('reading', 0.02);
  const samples = await decodeAudio(input);
  const duration = samples.length / SAMPLE_RATE;

  // Whisper gives no progress callback, so estimate from how long this machine usually takes
  // (about half real time) and ease towards the end of the stage.
  onProgress('listening', 0.05);
  const expected = Math.max(3, duration * 0.5);
  const started = Date.now();
  const tick = setInterval(() => {
    const t = (Date.now() - started) / 1000;
    onProgress('listening', 0.05 + 0.85 * (1 - Math.exp(-t / expected)));
  }, 400);
  let words;
  try {
    words = await transcribe(samples, { ...(model && { model }), ...(language && { language }) });
  } finally {
    clearInterval(tick);
  }

  onProgress('cutting', 0.93);
  const level = loudness(samples);
  level.floor = noiseFloor(level.db, words, level.frameSec);
  const plan = planCuts(words, planOpts, level);
  words = plan.words;
  onProgress('cutting', 1);

  return {
    duration: round(duration),
    keptDuration: round(plan.segments.reduce((t, s) => t + s.end - s.start, 0)),
    segments: plan.segments.map((s) => ({ start: round(s.start), end: round(s.end), text: s.words.map((w) => w.text).join(' ') })),
    cuts: plan.cuts,
    words,
    waveform: waveformOf(level),
  };
}

// Renders the kept ranges. Captions are rebuilt from the words that fall inside each range,
// so edited segment lists caption correctly too.
export async function renderCut(input, output, segments, words, { captions = false, height, fps, onProgress } = {}) {
  const withWords = segments.map(([start, end]) => ({
    start,
    end,
    words: words.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05),
  }));
  let subtitles;
  if (captions) {
    subtitles = output.replace(/\.mp4$/, '') + '.srt';
    await writeFile(subtitles, toSrt(remapWords(withWords)));
  }
  await render(input, output, segments, { subtitles, height, fps, onProgress });
}

/**
 * Renders an edit from the app: clips with speed/volume, styled captions and text overlays.
 * edit = { clips: [{ start, end, speed, volume }], captions?: { style, lines }, texts?: [...],
 *          music?: { file, volume }, keyframes?: [{ t, scale, x, y }], height?, fps?, bitrate? }
 * (caption lines, texts and keyframes are on the output timeline)
 */
export async function renderEdit(input, output, edit, { onProgress } = {}) {
  let ass;
  const needsSize = edit.captions?.lines?.length || edit.texts?.length || edit.keyframes?.length;
  const { width, height } = needsSize ? await probe(input) : {};
  if (edit.captions?.lines?.length || edit.texts?.length) {
    ass = output.replace(/\.mp4$/, '') + '.ass';
    await writeFile(ass, buildAss({ width, height, captions: edit.captions, texts: edit.texts }));
  }
  await render(input, output, edit.clips, {
    ass,
    fontsDir: FONTS_DIR,
    height: edit.height,
    fps: edit.fps,
    bitrate: edit.bitrate,
    music: edit.music,
    motion: edit.keyframes?.length ? { keyframes: edit.keyframes, width, height } : undefined,
    onProgress,
  });
}

// Raw take in, cut video out (used by the CLI).
export async function autocut(input, output, { captions = false, plan, model, language, onStage = () => {} } = {}) {
  let last;
  const result = await analyze(input, {
    plan,
    model,
    language,
    onProgress: (stage) => stage !== last && onStage((last = stage)),
  });
  onStage('rendering', result);
  if (result.segments.length) {
    await renderCut(input, output, result.segments.map((s) => [s.start, s.end]), result.words, { captions });
  }
  const srt = output.replace(/\.mp4$/, '') + '.srt';
  if (!captions) await writeFile(srt, toSrt(remapWords(result.segments.map((s) => ({ ...s, words: result.words.filter((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05) })))));
  return result;
}
