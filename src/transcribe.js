import { SAMPLE_RATE } from './media.js';

// Turns speech into words with timings. Deepgram (hosted, fast, handles thousands at once) when
// DEEPGRAM_API_KEY is set; otherwise, or if Deepgram is down, Whisper on this machine.

// Whisper gives some quick words no length at all; they get this much rather than being lost.
const MIN_WORD = 0.08;
const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

// Returns [{ text, start, end }] for every spoken word, ums and repeats included (the cutter
// removes them, so it has to see them).
export async function transcribe(samples, { language = 'english', model } = {}) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (key && !model) {
    try {
      return await withSlot(() => withRetries(() => deepgram(samples, language, key)));
    } catch (err) {
      // Whisper on this machine is slow; under heavy load it would only make things worse, so it
      // can be turned off (WHISPER_FALLBACK=0) and the cut fails instead (the edit is refunded).
      if (process.env.WHISPER_FALLBACK === '0') throw err;
      console.error(`Deepgram failed, using Whisper instead: ${err.message}`);
    }
  }
  return whisper(samples, { language, model });
}

// Deepgram allows a limited number of requests at once per account (about 50–100). Each worker
// sends at most DEEPGRAM_MAX at a time; the rest wait their turn here.
const MAX_AT_ONCE = Math.max(1, Number(process.env.DEEPGRAM_MAX ?? 8));
let inFlight = 0;
const waiting = [];
export async function withSlot(fn, max = MAX_AT_ONCE) {
  if (inFlight >= max) await new Promise((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/**
 * Tries again when Deepgram is busy (429), having trouble (5xx) or unreachable, waiting longer
 * each time with some randomness so many workers don't retry together. Gives up after `budgetMs`.
 */
export async function withRetries(fn, { budgetMs = 180_000, baseMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const until = Date.now() + budgetMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.status === 429 || err.status >= 500 || err.name === 'TypeError' || err.name === 'TimeoutError';
      const wait = Math.min(30_000, baseMs * 2 ** attempt) * (0.5 + Math.random());
      if (!retryable || Date.now() + wait > until) throw err;
      await sleep(wait);
    }
  }
}

/** Mono 16 kHz float samples as 16-bit little-endian PCM. */
export function toPcm16(samples) {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  return out;
}

export async function deepgram(samples, language, key, fetchImpl = fetch) {
  const q = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-3',
    language: language === 'spanish' ? 'es' : 'en',
    punctuate: 'true',
    smart_format: 'false', // keep words as spoken ("twenty", not "20") so captions match the audio
    filler_words: 'true', // keep "um" and "uh": the cutter needs to find them
    encoding: 'linear16',
    sample_rate: String(SAMPLE_RATE),
    channels: '1',
    // Opt out of Deepgram's Model Improvement Program, so it doesn't train on our users' audio (the
    // privacy policy says so). Turning this off (DEEPGRAM_MIP_OPT_OUT=0) needs the policy changed too.
    ...(process.env.DEEPGRAM_MIP_OPT_OUT !== '0' && { mip_opt_out: 'true' }),
  });
  const res = await fetchImpl(`${DEEPGRAM_URL}?${q}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/octet-stream' },
    body: toPcm16(samples),
    signal: AbortSignal.timeout(Math.max(60_000, (samples.length / SAMPLE_RATE) * 1000)),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  return deepgramWords(await res.json(), samples.length / SAMPLE_RATE);
}

/** Deepgram's response as our words: the punctuated form, clamped to the audio. */
export function deepgramWords(body, duration) {
  const list = body?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return list
    .map((w) => {
      const start = Math.max(0, Number(w.start) || 0);
      return { text: String(w.punctuated_word ?? w.word ?? '').trim(), start, end: Math.min(duration, Math.max(Number(w.end) || 0, start + MIN_WORD)) };
    })
    .filter((w) => w.text && w.end > w.start);
}

// Word-level timestamps need a Whisper export that keeps cross-attention alignment heads.
// Small, not base: on fast talkers base misheard whole phrases ("call me all the photos" for "copy
// all the photos"); small gets them right and keeps punctuation, for about 2.5× the time.
// Medium and large-v3-turbo were slower and no better (medium repeated phrases; turbo dropped
// punctuation partway through a take).
const DEFAULT_MODEL = 'onnx-community/whisper-small_timestamped';
let asr;

async function whisper(samples, { model = DEFAULT_MODEL, language = 'english' } = {}) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = new URL('../.models', import.meta.url).pathname;
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
