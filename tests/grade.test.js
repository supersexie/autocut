import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoGrade, cleanGrade, cube, frameStats, isNeutral, lut, matchGrade, pixelFn } from '../app/src/lib/grade.mjs';
import { parseClips, previewKey } from '../src/edits.js';
import { gradeFilters } from '../src/media.js';

test('a neutral grade changes nothing, and is dropped', () => {
  const f = pixelFn(undefined);
  for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8]]) assert.deepEqual(f(...c).map((v) => +v.toFixed(5)), c);
  assert.equal(cleanGrade({ adjust: { contrast: 0 }, hsl: { red: { h: 0 } }, curve: [[0, 0], [1, 1]] }), undefined);
  assert.ok(isNeutral({ wheel: { angle: 90, amount: 0, brightness: 0 } }));
});

test('grades are checked: unknown keys and filters dropped, values kept in range', () => {
  const g = cleanGrade({ adjust: { contrast: 500, bogus: 3, fade: -20 }, filter: { id: 'nope', strength: 50 }, hsl: { blue: { s: -40 } } });
  assert.deepEqual(g, { adjust: { contrast: 100 }, hsl: { blue: { s: -40 } } });
});

test('the LUT is size³ entries with red changing fastest, and the .cube file matches it', () => {
  const g = { adjust: { warmth: 40 } };
  const data = lut(g, 5);
  assert.equal(data.length, 5 ** 3 * 4);
  // Entry 1 is (r = 1/4, g = 0, b = 0): warmth makes red stronger than the input.
  assert.ok(data[4] > 0.25);
  const lines = cube(g, 5).trim().split('\n');
  assert.equal(lines[0], 'LUT_3D_SIZE 5');
  assert.equal(lines.length, 5 ** 3 + 1);
  assert.equal(lines[2].split(' ')[0], data[4].toFixed(5));
});

test('mono takes the colour out; warmth warms', () => {
  const [r, g, b] = pixelFn({ filter: { id: 'mono', strength: 100 } })(0.9, 0.2, 0.2);
  assert.ok(Math.abs(r - g) < 0.01 && Math.abs(g - b) < 0.01);
  const [wr, , wb] = pixelFn({ adjust: { warmth: 60 } })(0.5, 0.5, 0.5);
  assert.ok(wr > 0.5 && wb < 0.5);
});

test('auto brightens a dark, warm frame and cools it; match pulls one frame towards another', () => {
  const px = [];
  for (let i = 0; i < 400; i++) px.push(90 + (i % 30), 60 + (i % 20), 40, 255);
  const dark = frameStats(px, 1);
  const auto = autoGrade(dark);
  assert.ok(auto.exposure > 0 && auto.warmth < 0);
  const bright = { ...dark, mid: dark.mid * 2, mean: dark.mean * 2 };
  assert.ok(matchGrade(dark, bright).exposure > 0);
});

test('clips keep their grade through parsing, and it changes the preview key', () => {
  const [c] = parseClips([{ start: 0, end: 2, grade: { adjust: { exposure: 20, nope: 1 } } }], 10);
  assert.deepEqual(c.grade, { adjust: { exposure: 20 } });
  const [plain] = parseClips([{ start: 0, end: 2 }], 10);
  assert.equal(plain.grade, undefined);
  assert.notEqual(previewKey([c]), previewKey([plain]));
});

test('a graded clip gets its LUT and effects in the render; an ungraded one gets nothing', () => {
  assert.equal(gradeFilters(undefined, '/tmp/out.mp4'), '');
  const luts = [];
  const f = gradeFilters({ adjust: { vignette: 50, grain: 30 } }, '/tmp/autocut-test/out.mp4', luts);
  assert.match(f, /^,lut3d=file=\/tmp\/autocut-test\/grade-[a-z0-9]+\.cube:interp=tetrahedral,vignette=angle=[\d.]+,noise=alls=6:allf=t$/);
});

test('a song plays only between its start and end', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = (await import('node:os')).default;
  const path = (await import('node:path')).default;
  const ffmpeg = (await import('ffmpeg-static')).default;
  const { render } = await import('../src/media.js');
  const run = promisify(execFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autocut-song-'));
  try {
    const song = path.join(dir, 'song.m4a');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', song]);
    const out = path.join(dir, 'out.mp4');
    const source = new URL('../samples/demo.mp4', import.meta.url).pathname;
    await render(source, out, [{ start: 0, end: 4, speed: 1, volume: 0 }], { height: 240, fast: true, music: { file: song, volume: 1, start: 1, end: 3, from: 0.5 } });
    const loudness = async (ss, t) => {
      const { stderr } = await run(ffmpeg, ['-ss', String(ss), '-t', String(t), '-i', out, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
      return Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1] ?? -Infinity);
    };
    assert.ok((await loudness(0.1, 0.7)) < -50, 'silent before the song starts');
    assert.ok((await loudness(1.3, 1)) > -20, 'the song plays in its stretch');
    assert.ok((await loudness(3.3, 0.6)) < -50, 'silent after it ends');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the song's timing comes through the export request", async () => {
  const { parseRender } = await import('../src/edits.js');
  const out = parseRender({ clips: [{ start: 0, end: 5 }], music: { upload: 'x', volume: 0.5, start: 1, end: 4, from: 2 } }, { duration: 10, overlapAllowed: false });
  assert.deepEqual(out.music, { upload: 'x', volume: 0.5, start: 1, end: 4, from: 2 });
  const plain = parseRender({ clips: [{ start: 0, end: 5 }], music: { upload: 'x', volume: 0.5 } }, { duration: 10, overlapAllowed: false });
  assert.deepEqual(plain.music, { upload: 'x', volume: 0.5 });
});
