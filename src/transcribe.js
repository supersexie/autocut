import { pipeline, env } from '@huggingface/transformers';
import { SAMPLE_RATE } from './media.js';

env.cacheDir = new URL('../.models', import.meta.url).pathname;

// Word-level timestamps need a Whisper export that keeps cross-attention alignment heads.
// Small, not base: on fast talkers base misheard whole phrases ("call me all the photos" for "copy
// all the photos"); small gets them right and keeps punctuation, for about 2.5× the time.
// Medium and large-v3-turbo were slower and no better (medium repeated phrases; turbo dropped
// punctuation partway through a take).
const DEFAULT_MODEL = 'onnx-community/whisper-small_timestamped';
// Whisper gives some quick words no length at all; they get this much rather than being lost.
const MIN_WORD = 0.08;

let asr;

// Returns [{ text, start, end }] for every spoken word.
export async function transcribe(samples, { model = DEFAULT_MODEL, language = 'english' } = {}) {
  asr ??= await pipeline('automatic-speech-recognition', model, { dtype: 'fp32' });
  const result = await asr(samples, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    language,
    task: 'transcribe',
  });
  const duration = samples.length / SAMPLE_RATE;
  const words = [];
  for (const c of result.chunks ?? []) {
    const start = c.timestamp[0] ?? 0;
    const end = Math.min(Math.max(c.timestamp[1] ?? start, start + MIN_WORD), duration);
    const w = { text: c.text.trim(), start, end };
    if (!w.text) continue;
    // Whisper sometimes emits sub-word pieces ("t", "-shirt"); a piece without a leading space continues the last word.
    if (words.length && !/^\s/.test(c.text)) {
      const last = words.at(-1);
      last.text += w.text;
      last.end = Math.max(last.end, w.end);
    } else words.push(w);
  }
  return words.filter((w) => w.end > w.start);
}
