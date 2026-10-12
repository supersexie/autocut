import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const SAMPLE_RATE = 16000;

function run(args, { collect = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args]);
    const chunks = [];
    let stderr = '';
    if (collect) proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => (stderr += c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
      resolve(collect ? Buffer.concat(chunks) : undefined);
    });
  });
}

// Decode the input's audio to 16 kHz mono float samples (what Whisper expects).
export async function decodeAudio(input) {
  const buf = await run(['-i', input, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { collect: true });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// RMS loudness in dBFS per 10 ms frame, used to tighten cut points onto real silence.
export function loudness(samples, frameMs = 10) {
  const size = Math.round((SAMPLE_RATE * frameMs) / 1000);
  const out = new Float32Array(Math.ceil(samples.length / size));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, end - f * size));
    out[f] = 20 * Math.log10(rms + 1e-9);
  }
  return { db: out, frameSec: frameMs / 1000 };
}

// Render only the kept [start, end] ranges, back to back, with tiny audio fades to avoid clicks.
export async function render(input, output, segments, { subtitles } = {}) {
  const fade = 0.012;
  const parts = [];
  const labels = [];
  segments.forEach(([s, e], i) => {
    const d = (e - s).toFixed(3);
    parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(
      `[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, d - fade).toFixed(3)}:d=${fade}[a${i}]`
    );
    labels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${labels.join('')}concat=n=${segments.length}:v=1:a=1[vc][ac]`);
  let vOut = '[vc]';
  if (subtitles) {
    const style = 'FontName=Helvetica,FontSize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=0,Alignment=2,MarginV=60';
    const escaped = subtitles.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    parts.push(`[vc]subtitles='${escaped}':force_style='${style}'[vs]`);
    vOut = '[vs]';
  }
  await run([
    '-y', '-i', input,
    '-filter_complex', parts.join(';'),
    '-map', vOut, '-map', '[ac]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    output,
  ]);
}
