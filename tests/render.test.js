import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { render } from '../src/media.js';

const probe = (file) => {
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', file]);
  } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr));
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
  }
};

test('an overlap-audio export of several pieces, some very short, finishes', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'render-'));
  const src = path.join(dir, 'take.mp4');
  // Like a phone take: 720×1280 H.264 High with 48 kHz stereo. With the sound trimmed from the same
  // input as the picture, this export used to stall forever.
  execFileSync(ffmpegPath, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=44.4', '-f', 'lavfi', '-i', 'sine=f=220:d=44.4:sample_rate=48000',
    '-ac', '2', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-b:v', '5M', '-c:a', 'aac', '-b:a', '192k', src]);
  const out = path.join(dir, 'out.mp4');
  const clips = [{ start: 2.57, end: 2.92 }, { start: 3.56, end: 14.98 }, { start: 17.47, end: 17.82 }, { start: 18.46, end: 44.395 }];
  await render(src, out, clips, { overlap: true, height: 720 });
  const want = clips.reduce((t, c) => t + c.end - c.start, 0);
  assert.ok(Math.abs(probe(out) - want) < 0.15, `length ${probe(out)} vs ${want}`);
});
