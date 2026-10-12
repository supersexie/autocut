import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const SAMPLE_RATE = 16000;

// `total` (seconds of output) + `onProgress` turn ffmpeg's -progress lines into a 0–1 fraction.
function run(args, { collect = false, total, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const progress = onProgress && total ? ['-progress', 'pipe:2', '-nostats'] : [];
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...progress, ...args]);
    const chunks = [];
    let stderr = '';
    if (collect) proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => {
      const text = c.toString();
      if (progress.length) {
        const m = /out_time_us=(\d+)/.exec(text);
        if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
        if (!/^(\w+=.*\n?)+$/.test(text)) stderr += text;
      } else stderr += text;
    });
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

// Size and orientation of a video's first stream, as displayed (rotation applied).
export function probe(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', input]);
    let info = '';
    proc.stderr.on('data', (c) => (info += c));
    proc.on('error', reject);
    proc.on('close', () => {
      const video = /Stream #\d+:\d+.*Video:.* (\d{2,5})x(\d{2,5})/.exec(info);
      const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
      if (!video) return reject(new Error('No video stream found.'));
      let [width, height] = [Number(video[1]), Number(video[2])];
      if (/rotation of -?90/.test(info)) [width, height] = [height, width];
      resolve({
        width,
        height,
        duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0,
        hasAudio: /Stream #\d+:\d+.*Audio:/.test(info),
      });
    });
  });
}

// Joins several takes into one video at the first take's size, so they cut as one.
export async function joinTakes(inputs, output, { onProgress } = {}) {
  const infos = await Promise.all(inputs.map(probe));
  const w = infos[0].width - (infos[0].width % 2);
  const h = infos[0].height - (infos[0].height % 2);
  const parts = [];
  const labels = [];
  infos.forEach((info, i) => {
    parts.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
    parts.push(info.hasAudio ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]` : `anullsrc=r=48000:cl=stereo,atrim=0:${info.duration}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${labels.join('')}concat=n=${inputs.length}:v=1:a=1[v][a]`);
  await run(
    [
      '-y', ...inputs.flatMap((f) => ['-i', f]),
      '-filter_complex', parts.join(';'),
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      output,
    ],
    { total: infos.reduce((t, i) => t + i.duration, 0), onProgress }
  );
}

// Render only the kept [start, end] ranges, back to back, with tiny audio fades to avoid clicks.
// `height` scales the output (keeping aspect), `fps` resamples the frame rate.
export async function render(input, output, segments, { subtitles, height, fps, onProgress } = {}) {
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
  const post = [height && `scale=-2:${height}`, fps && `fps=${fps}`].filter(Boolean).join(',');
  parts.push(`${labels.join('')}concat=n=${segments.length}:v=1:a=1[${post ? 'vr' : 'vc'}][ac]`);
  if (post) parts.push(`[vr]${post}[vc]`);
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
  ], { total: segments.reduce((t, [a, b]) => t + b - a, 0), onProgress });
}
