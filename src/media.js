import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

// FFMPEG_PATH: an ffmpeg built with GPU encoding (the GPU worker image); otherwise the bundled one.
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;

// Which H.264 encoder to use: libx264 (CPU, default), h264_nvenc (NVIDIA GPUs: dozens of exports per
// GPU) or h264_videotoolbox (Macs). Same quality targets, encoder-specific flags.
const ENCODER = process.env.VIDEO_ENCODER || 'libx264';

/**
 * Encoder flags for a quality: `crf` (constant quality, lower is better), or a `bitrate` in Mbps.
 * `fast` trades quality for speed (the editor's previews). `gop` sets a keyframe interval.
 */
export function videoArgs({ crf = 18, bitrate, fast = false, gop, encoder = ENCODER } = {}) {
  const keys = gop ? ['-g', String(gop), '-keyint_min', String(gop)] : [];
  if (encoder === 'h264_nvenc') {
    const rate = bitrate ? ['-rc', 'vbr', '-b:v', `${bitrate}M`, '-maxrate', `${bitrate}M`, '-bufsize', `${bitrate * 2}M`] : ['-rc', 'vbr', '-cq', String(crf + 2), '-b:v', '0'];
    return ['-c:v', 'h264_nvenc', '-preset', fast ? 'p1' : 'p5', '-tune', fast ? 'll' : 'hq', ...rate, ...keys];
  }
  if (encoder === 'h264_videotoolbox') {
    const rate = bitrate ? ['-b:v', `${bitrate}M`] : ['-q:v', String(Math.max(1, Math.min(100, 100 - crf * 2)))];
    return ['-c:v', 'h264_videotoolbox', ...rate, ...keys];
  }
  const rate = bitrate ? ['-b:v', `${bitrate}M`, '-maxrate', `${bitrate}M`, '-bufsize', `${bitrate * 2}M`] : ['-crf', String(crf)];
  return ['-c:v', 'libx264', '-preset', fast ? 'ultrafast' : 'veryfast', ...rate, ...keys, ...(fast ? ['-threads', '2'] : [])];
}

export const SAMPLE_RATE = 16000;

// If a tracked run's output doesn't move for this long, ffmpeg is stuck: it's killed and the run fails.
const STALL_MS = Number(process.env.FFMPEG_STALL_MS ?? 90_000);

// `total` (seconds of output) + `onProgress` turn ffmpeg's -progress lines into a 0–1 fraction.
function run(args, { collect = false, total, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const progress = onProgress && total ? ['-progress', 'pipe:2', '-nostats'] : [];
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...progress, ...args]);
    const chunks = [];
    let stderr = '';
    let stuck = false;
    let lastOut = -1;
    let moved = Date.now();
    const watch = progress.length
      ? setInterval(() => {
          if (Date.now() - moved < STALL_MS) return;
          stuck = true;
          proc.kill('SIGKILL'); // a deadlocked ffmpeg ignores a polite stop
        }, 5000)
      : null;
    if (collect) proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => {
      const text = c.toString();
      if (progress.length) {
        const m = /out_time_us=(\d+)/.exec(text);
        if (m) {
          if (Number(m[1]) !== lastOut) [lastOut, moved] = [Number(m[1]), Date.now()];
          onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
        }
        if (!/^(\w+=.*\n?)+$/.test(text)) stderr += text;
      } else stderr += text;
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (watch) clearInterval(watch);
      if (stuck) return reject(new Error(`ffmpeg made no progress for ${Math.round(STALL_MS / 1000)}s and was stopped`));
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
      ...videoArgs({ crf: 18, gop: 15 }),
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
 * `layers` = { list: [{ file, kind, start, end, from, x, y, width, rotation, volume, hasAudio }], width, height }
 * lays photos and videos over the picture for their stretch of the output (centre x, y and width as
 * fractions of the frame, rotation in degrees clockwise), under the captions; a video's sound is mixed in.
 */
/** Overlap audio: how far (seconds) each cut's sound reaches into its neighbour, fading across it. */
export const OVERLAP = 0.08;

export async function render(input, output, clips, { subtitles, ass, fontsDir, height, fps, bitrate, fast, music, motion, layers, overlap, onProgress } = {}) {
  const fade = 0.012;
  const parts = [];
  const labels = [];
  const list = clips.map((c) => (Array.isArray(c) ? { start: c[0], end: c[1] } : c));
  let total = 0;
  // Overlap audio: each piece's sound runs OVERLAP seconds past its cut (and the next starts that
  // early), fading across each other, while the picture still cuts exactly on time.
  const lap = overlap && list.length > 1 ? OVERLAP : 0;
  // Overlapping, the sound is read from its own copy of the source (input 1). Trimmed from the same
  // input as the picture, ffmpeg can stall waiting for audio far ahead of the frame it's on, and the
  // export never finishes (seen with four pieces, two of them very short).
  const sound = lap ? 1 : 0;
  const voices = [];
  list.forEach(({ start: s, end: e, speed = 1, volume = 1 }, i) => {
    const out = (e - s) / speed;
    const at = total; // where this piece starts in the output
    total += out;
    parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[v${i}]`);
    if (lap) {
      // Reach into the source on either side (not before the start or past the end of the edit).
      const before = i > 0 ? Math.min(lap, at) : 0;
      const after = i < list.length - 1 ? lap : 0;
      const from = Math.max(0, s - before * speed);
      const lead = (s - from) / speed; // how early this piece's sound actually starts
      const len = out + lead + after;
      const fadeIn = i > 0 ? lead * 2 || fade : fade;
      const fadeOut = after ? after * 2 : fade;
      parts.push(
        `[${sound}:a]atrim=start=${from.toFixed(3)}:end=${(e + after * speed).toFixed(3)},asetpts=PTS-STARTPTS` +
          (speed !== 1 ? `,${atempo(speed)}` : '') +
          (volume !== 1 ? `,volume=${volume.toFixed(3)}` : '') +
          `,aresample=48000,afade=t=in:d=${Math.min(fadeIn, len / 2).toFixed(3)},afade=t=out:st=${Math.max(0, len - fadeOut).toFixed(3)}:d=${Math.min(fadeOut, len / 2).toFixed(3)}` +
          `,adelay=delays=${Math.round((at - lead) * 1000)}:all=1[a${i}]`
      );
      voices.push(`[a${i}]`);
      labels.push(`[v${i}]`);
      return;
    }
    parts.push(
      `[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS` +
        (speed !== 1 ? `,${atempo(speed)}` : '') +
        (volume !== 1 ? `,volume=${volume.toFixed(3)}` : '') +
        `,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, out - fade).toFixed(3)}:d=${fade}[a${i}]`
    );
    labels.push(`[v${i}][a${i}]`);
  });
  // Sped-up clips crowd frames together (10× a 30 fps take is 300 fps); settle on a normal rate.
  fps ||= list.some((c) => (c.speed ?? 1) > 2) ? 30 : undefined;
  // `height` is the resolution's short side (1080p = 1080×1920 for vertical video), never upscaled.
  const scale = height && `scale=w='if(gt(iw,ih),-2,min(${height},iw))':h='if(gt(iw,ih),min(${height},ih),-2)'`;
  const post = [scale, fps && `fps=${fps}`].filter(Boolean).join(',');
  const moving = motion?.keyframes?.length > 0;
  if (lap) {
    parts.push(`${labels.join('')}concat=n=${list.length}:v=1:a=0[vcat]`);
    // Overlapping pieces add up where they fade across each other; the result is cut to the edit's length.
    parts.push(`${voices.join('')}amix=inputs=${voices.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=0:${total.toFixed(3)}[acat]`);
  } else parts.push(`${labels.join('')}concat=n=${list.length}:v=1:a=1[vcat][acat]`);
  let v = '[vcat]';
  const extra = lap ? ['-i', input] : []; // inputs after the source
  const sounds = []; // audio to mix under the edit's own
  let next = 1 + extra.length / 2;

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
    parts.push(`${v}fps=${rate},scale=${w * 2}:${h * 2}:flags=bicubic,zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${w}x${h}:fps=${rate}[vzoom]`);
    v = '[vzoom]';
  }

  if (music) {
    const k = next++;
    extra.push('-stream_loop', '-1', '-i', music.file);
    const vol = Math.min(1, Math.max(0, music.volume ?? 0.5));
    const tail = Math.min(1.5, total / 4);
    parts.push(`[${k}:a]aresample=48000,volume=${vol.toFixed(3)},atrim=0:${total.toFixed(3)},afade=t=out:st=${Math.max(0, total - tail).toFixed(3)}:d=${tail.toFixed(3)}[song]`);
    sounds.push('[song]');
  }

  // Overlays, bottom to top: each scaled to its width, turned, and shown only for its stretch.
  (layers?.list ?? []).forEach((o, i) => {
    const k = next++;
    const n = (x) => Number(x).toFixed(3);
    const dur = Math.max(0.05, o.end - o.start);
    if (o.kind === 'video') extra.push('-ss', n(o.from), '-t', n(dur), '-i', o.file);
    else extra.push('-i', o.file); // one frame, held for as long as it's shown
    const px = Math.max(2, Math.round((o.width * layers.width) / 2) * 2);
    const rad = ((o.rotation || 0) * Math.PI) / 180;
    const turn = Math.abs(rad) > 0.0001 ? `,rotate=${rad.toFixed(5)}:c=none:ow=rotw(${rad.toFixed(5)}):oh=roth(${rad.toFixed(5)})` : '';
    const when = o.kind === 'video' ? `setpts=PTS-STARTPTS+${n(o.start)}/TB,` : '';
    parts.push(`[${k}:v]${when}scale=${px}:-2,format=rgba${turn}[ol${i}]`);
    const cx = (o.x * layers.width).toFixed(1);
    const cy = (o.y * layers.height).toFixed(1);
    parts.push(
      `${v}[ol${i}]overlay=x='${cx}-overlay_w/2':y='${cy}-overlay_h/2':enable='between(t,${n(o.start)},${n(o.end)})':eof_action=${o.kind === 'video' ? 'pass' : 'repeat'}[lv${i}]`
    );
    v = `[lv${i}]`;
    if (o.kind === 'video' && o.hasAudio && o.volume > 0) {
      const ms = Math.round(o.start * 1000);
      parts.push(`[${k}:a]asetpts=PTS-STARTPTS,aresample=48000,volume=${Math.min(2, o.volume).toFixed(3)},adelay=delays=${ms}:all=1[la${i}]`);
      sounds.push(`[la${i}]`);
    }
  });

  if (sounds.length) {
    // normalize=0 keeps the voice at full volume instead of turning everything down.
    parts.push(`[acat]aresample=48000[voice];[voice]${sounds.join('')}amix=inputs=${sounds.length + 1}:duration=first:dropout_transition=0:normalize=0[ac]`);
  } else parts.push('[acat]anull[ac]');
  parts.push(`${v}${post || 'null'}[vc]`);
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
  const video = fast ? videoArgs({ crf: 28, gop: 15, fast: true }) : videoArgs({ crf: 18, bitrate });
  await run([
    '-y', '-i', input,
    ...extra,
    '-filter_complex', parts.join(';'),
    '-map', vOut, '-map', '[ac]',
    ...video, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', fast ? '96k' : '192k', '-movflags', '+faststart',
    output,
  ], { total, onProgress });
}
