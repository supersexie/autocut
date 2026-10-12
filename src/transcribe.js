import { pipeline, env } from '@huggingface/transformers';
import { SAMPLE_RATE } from './media.js';

env.cacheDir = new URL('../.models', import.meta.url).pathname;

// Word-level timestamps need a Whisper export that keeps cross-attention alignment heads.
const DEFAULT_MODEL = 'onnx-community/whisper-base_timestamped';

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
    const w = { text: c.text.trim(), start: c.timestamp[0] ?? 0, end: Math.min(c.timestamp[1] ?? c.timestamp[0] ?? 0, duration) };
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
