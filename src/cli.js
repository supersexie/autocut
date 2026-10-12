#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { decodeAudio, loudness, render, SAMPLE_RATE } from './media.js';
import { transcribe } from './transcribe.js';
import { planCuts, noiseFloor } from './plan.js';
import { remapWords, toSrt } from './captions.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    captions: { type: 'boolean', default: false },
    'max-gap': { type: 'string' },
    'keep-fillers': { type: 'boolean', default: false },
    model: { type: 'string' },
    'plan-only': { type: 'boolean', default: false },
  },
});

const input = positionals[0];
if (!input) {
  console.error('usage: autocut <raw.mp4> [-o out.mp4] [--captions] [--max-gap 0.3] [--keep-fillers] [--plan-only]');
  process.exit(1);
}

const base = path.join(path.dirname(values.out ?? input), path.basename(input, path.extname(input)));
const output = values.out ?? `${base}.cut.mp4`;
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const step = (msg) => console.log(`• ${msg}`);

step('Reading the take');
const samples = await decodeAudio(input);
const duration = samples.length / SAMPLE_RATE;

step('Transcribing (first run downloads the Whisper model)');
const words = await transcribe(samples, values.model ? { model: values.model } : {});

step('Finding dead air, fillers and retakes');
const level = loudness(samples);
level.floor = noiseFloor(level.db);
const plan = planCuts(
  words,
  { ...(values['max-gap'] && { maxGap: Number(values['max-gap']) }), removeFillers: !values['keep-fillers'] },
  level
);
const kept = plan.segments.reduce((t, s) => t + s.end - s.start, 0);

const segments = plan.segments.map((s) => [s.start, s.end]);
const report = {
  input,
  output,
  duration: +duration.toFixed(3),
  keptDuration: +kept.toFixed(3),
  segments: plan.segments.map((s) => ({ start: +s.start.toFixed(3), end: +s.end.toFixed(3), text: s.words.map((w) => w.text).join(' ') })),
  cuts: plan.cuts,
  words,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(`${base}.cut.json`, JSON.stringify(report, null, 2));

const srt = toSrt(remapWords(plan.segments));
const srtPath = `${base}.cut.srt`;
await writeFile(srtPath, srt);

for (const c of plan.cuts) console.log(`  ✂ ${c.start.toFixed(2)}–${c.end.toFixed(2)}s  ${c.reason.padEnd(8)} ${c.text}`);

if (!values['plan-only']) {
  step('Rendering');
  await render(input, output, segments, { subtitles: values.captions ? srtPath : undefined });
}

console.log(`\nCut ready  ${fmt(duration)} → ${fmt(kept)}  (${plan.cuts.length} cuts)`);
console.log(values['plan-only'] ? `plan: ${base}.cut.json` : output);
