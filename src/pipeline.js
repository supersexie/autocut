import { writeFile } from 'node:fs/promises';
import { decodeAudio, loudness, render, SAMPLE_RATE } from './media.js';
import { transcribe } from './transcribe.js';
import { planCuts, noiseFloor } from './plan.js';
import { remapWords, toSrt } from './captions.js';

// Raw take in, cut video out. `onStage` reports progress for the CLI and the app.
export async function autocut(input, output, { captions = false, plan: planOpts = {}, model, onStage = () => {} } = {}) {
  onStage('reading');
  const samples = await decodeAudio(input);
  const duration = samples.length / SAMPLE_RATE;

  onStage('listening');
  const words = await transcribe(samples, model ? { model } : {});

  onStage('cutting');
  const level = loudness(samples);
  level.floor = noiseFloor(level.db);
  const plan = planCuts(words, planOpts, level);
  const keptDuration = plan.segments.reduce((t, s) => t + s.end - s.start, 0);

  const srtPath = output.replace(/\.mp4$/, '') + '.srt';
  await writeFile(srtPath, toSrt(remapWords(plan.segments)));

  const result = {
    duration: +duration.toFixed(3),
    keptDuration: +keptDuration.toFixed(3),
    segments: plan.segments.map((s) => ({
      start: +s.start.toFixed(3),
      end: +s.end.toFixed(3),
      text: s.words.map((w) => w.text).join(' '),
    })),
    cuts: plan.cuts,
    words,
  };
  onStage('rendering', result);

  if (plan.segments.length) await render(input, output, plan.segments.map((s) => [s.start, s.end]), { subtitles: captions ? srtPath : undefined });
  return result;
}
