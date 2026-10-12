import { writeFile } from 'node:fs/promises';
import { decodeAudio, loudness, render, SAMPLE_RATE } from './media.js';
import { transcribe } from './transcribe.js';
import { planCuts, noiseFloor } from './plan.js';
import { remapWords, toSrt } from './captions.js';

const round = (n) => +n.toFixed(3);

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
  level.floor = noiseFloor(level.db);
  const plan = planCuts(words, planOpts, level);
  onProgress('cutting', 1);

  return {
    duration: round(duration),
    keptDuration: round(plan.segments.reduce((t, s) => t + s.end - s.start, 0)),
    segments: plan.segments.map((s) => ({ start: round(s.start), end: round(s.end), text: s.words.map((w) => w.text).join(' ') })),
    cuts: plan.cuts,
    words,
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
