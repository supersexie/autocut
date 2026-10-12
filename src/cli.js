#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { autocut } from './pipeline.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    captions: { type: 'boolean', default: false },
    'max-gap': { type: 'string' },
    'keep-fillers': { type: 'boolean', default: false },
    'keep-retakes': { type: 'boolean', default: false },
    model: { type: 'string' },
  },
});

const input = positionals[0];
if (!input) {
  console.error('usage: autocut <raw.mp4> [-o out.mp4] [--captions] [--max-gap 0.3] [--keep-fillers] [--keep-retakes]');
  process.exit(1);
}

const base = path.join(path.dirname(values.out ?? input), path.basename(input, path.extname(input)));
const output = values.out ?? `${base}.cut.mp4`;
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const labels = { reading: 'Reading the take', listening: 'Transcribing (first run downloads the Whisper model)', cutting: 'Finding dead air, fillers and retakes', rendering: 'Rendering' };

await mkdir(path.dirname(output), { recursive: true });
const result = await autocut(input, output, {
  captions: values.captions,
  model: values.model,
  plan: {
    ...(values['max-gap'] && { maxGap: Number(values['max-gap']) }),
    removeFillers: !values['keep-fillers'],
    removeRetakes: !values['keep-retakes'],
  },
  onStage: (stage, r) => {
    console.log(`• ${labels[stage]}`);
    if (r) for (const c of r.cuts) console.log(`  ✂ ${c.start.toFixed(2)}–${c.end.toFixed(2)}s  ${c.reason.padEnd(8)} ${c.text}`);
  },
});
await writeFile(`${base}.cut.json`, JSON.stringify({ input, output, ...result }, null, 2));

console.log(`\nCut ready  ${fmt(result.duration)} → ${fmt(result.keptDuration)}  (${result.cuts.length} cuts)`);
console.log(output);
