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
// `flips[i]` mirrors take i back (front-camera recordings come out mirrored on iOS).
// One take is just re-encoded (to flip it); several are joined at the first take's size.
/**
 * Joins takes into one video at the first take's size. `blend` fades the sound out and back in
 * over a moment at each join, so it doesn't jump from one clip's room to the next.
 */
export async function joinTakes(inputs, output, { flips = [], blend = false, onProgress } = {}) {
  const infos = await Promise.all(inputs.map(probe));
  const w = infos[0].width - (infos[0].width % 2);
  const h = infos[0].height - (infos[0].height % 2);
  const parts = [];
  const labels = [];
  infos.forEach((info, i) => {
    const flip = flips[i] ? 'hflip,' : '';
    const fps = inputs.length > 1 ? ',fps=30' : '';
    parts.push(`[${i}:v]${flip}scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1${fps},format=yuv420p[v${i}]`);
    const fade = 0.15;
    const fades = blend && inputs.length > 1
      ? [i > 0 && `afade=t=in:d=${fade}`, i < inputs.length - 1 && `afade=t=out:st=${Math.max(0, info.duration - fade).toFixed(3)}:d=${fade}`].filter(Boolean).map((f) => `,${f}`).join('')
      : '';
    parts.push(info.hasAudio ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo${fades}[a${i}]` : `anullsrc=r=48000:cl=stereo,atrim=0:${info.duration}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${labels.join('')}concat=n=${inputs.length}:v=1:a=1[v][a]`);
  await run(
    [
      '-y', ...inputs.flatMap((f) => ['-i', f]),
      '-filter_complex', parts.join(';'),
      '-map', '[v]', '-map', '[a]',
      // A keyframe every 15 frames keeps seeking in the editor instant (the default is ~250).
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '15', '-keyint_min', '15',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      output,
    ],
    { total: infos.reduce((t, i) => t + i.duration, 0), onProgress }
  );
}

/**
 * An ffmpeg expression for a keyframed value at time `t` (seconds): held before the first and
 * after the last keyframe, eased in and out (cubic) between them — the same curve the app plays.
 */
export function keyframeExpr(keyframes, key, t = 'it') {
  const n = (v) => Number(v).toFixed(4);
  if (keyframes.length === 1) return n(keyframes[0][key]);
  let expr = n(keyframes.at(-1)[key]);
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    const u = `((${t}-${n(a.t)})/${n(Math.max(0.001, b.t - a.t))})`;
    const ease = `if(lt(${u},0.5),4*pow(${u},3),1-pow(-2*${u}+2,3)/2)`;
    expr = `if(lt(${t},${n(b.t)}),${n(a[key])}+(${n(b[key] - a[key])})*${ease},${expr})`;
  }
  return `if(lt(${t},${n(keyframes[0].t)}),${n(keyframes[0][key])},${expr})`;
}

// atempo only accepts 0.5–2, so chain it for faster or slower speeds.
function atempo(speed) {
  const parts = [];
  let left = speed;
  while (left > 2) { parts.push('atempo=2'); left /= 2; }
  while (left < 0.5) { parts.push('atempo=0.5'); left /= 0.5; }
  parts.push(`atempo=${left.toFixed(4)}`);
  return parts.join(',');
}

/**
 * Renders the clips back to back. A clip is [start, end] or { start, end, speed, volume }
 * (volume 0 mutes it). Audio gets tiny fades at each join so cuts don't click.
 * `subtitles` burns an SRT; `ass` burns an ASS file using fonts from `fontsDir`.
 * `height` scales (keeping aspect), `fps` resamples, `bitrate` is in Mbps. `fast` trades quality
 * for speed (for the editor's preview): quick to encode, small, and a keyframe every half second.
 * `music` = { file, volume } lays a song under the whole video, looped if it's short, fading out at the end.
 * `motion` = { keyframes: [{ t, scale, x, y }], width, height } zooms and pans the picture over time
 * (scale ≥ 1 about the centre, then moved by x·width, y·height), under the captions.
 */
export async function render(input, output, clips, { subtitles, ass, fontsDir, height, fps, bitrate, fast, music, motion, onProgress } = {}) {
  const fade = 0.012;
  const parts = [];
  const labels = [];
  const list = clips.map((c) => (Array.isArray(c) ? { start: c[0], end: c[1] } : c));
  let total = 0;
  list.forEach(({ start: s, end: e, speed = 1, volume = 1 }, i) => {
    const out = (e - s) / speed;
    total += out;
    parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[v${i}]`);
    parts.push(
      `[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS` +
        (speed !== 1 ? `,${atempo(speed)}` : '') +
        (volume !== 1 ? `,volume=${volume.toFixed(3)}` : '') +
        `,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, out - fade).toFixed(3)}:d=${fade}[a${i}]`
    );
    labels.push(`[v${i}][a${i}]`);
  });
  // `height` is the resolution's short side (1080p = 1080×1920 for vertical video), never upscaled.
  const scale = height && `scale=w='if(gt(iw,ih),-2,min(${height},iw))':h='if(gt(iw,ih),min(${height},ih),-2)'`;
  const post = [scale, fps && `fps=${fps}`].filter(Boolean).join(',');
  const moving = motion?.keyframes?.length > 0;
  parts.push(`${labels.join('')}concat=n=${list.length}:v=1:a=1[${moving ? 'vm' : post ? 'vr' : 'vc'}][${music ? 'voice' : 'ac'}]`);
  if (moving) {
    // zoompan turns each input frame into one output frame (d=1) at a fixed rate, so the rate is
    // fixed first. Working at twice the size keeps slow zooms from shimmering on whole pixels.
    const rate = fps || 30;
    const k = motion.keyframes;
    const z = keyframeExpr(k, 'scale');
    const x = `iw/2-(iw/2+(${keyframeExpr(k, 'x')})*iw)/zoom`;
    const y = `ih/2-(ih/2+(${keyframeExpr(k, 'y')})*ih)/zoom`;
    const w = motion.width - (motion.width % 2);
    const h = motion.height - (motion.height % 2);
    parts.push(`[vm]fps=${rate},scale=${w * 2}:${h * 2}:flags=bicubic,zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${w}x${h}:fps=${rate}[${post ? 'vr' : 'vc'}]`);
  }
  if (music) {
    // normalize=0 keeps the voice at full volume instead of halving both.
    const vol = Math.min(1, Math.max(0, music.volume ?? 0.5));
    const tail = Math.min(1.5, total / 4);
    parts.push(`[1:a]aresample=48000,volume=${vol.toFixed(3)},atrim=0:${total.toFixed(3)},afade=t=out:st=${Math.max(0, total - tail).toFixed(3)}:d=${tail.toFixed(3)}[song]`);
    parts.push(`[voice]aresample=48000[voice48];[voice48][song]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[ac]`);
  }
  if (post) parts.push(`[vr]${post}[vc]`);
  let vOut = '[vc]';
  const esc = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  if (ass) {
    parts.push(`[vc]ass='${esc(ass)}'${fontsDir ? `:fontsdir='${esc(fontsDir)}'` : ''}[vs]`);
    vOut = '[vs]';
  } else if (subtitles) {
    const style = 'FontName=Helvetica,FontSize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=0,Alignment=2,MarginV=60';
    parts.push(`[vc]subtitles='${esc(subtitles)}':force_style='${style}'[vs]`);
    vOut = '[vs]';
  }
  const quality = bitrate ? ['-b:v', `${bitrate}M`, '-maxrate', `${bitrate}M`, '-bufsize', `${bitrate * 2}M`] : ['-crf', '18'];
  const video = fast
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-g', '15', '-threads', '2']
    : ['-c:v', 'libx264', '-preset', 'veryfast', ...quality];
  await run([
    '-y', '-i', input,
    ...(music ? ['-stream_loop', '-1', '-i', music.file] : []),
    '-filter_complex', parts.join(';'),
    '-map', vOut, '-map', '[ac]',
    ...video, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', fast ? '96k' : '192k', '-movflags', '+faststart',
    output,
  ], { total, onProgress });
}
