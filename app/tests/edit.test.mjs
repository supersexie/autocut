// Runs the editor's pure logic with Node's TypeScript stripping: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeClip, splitAt, removeClip, duplicateClip, moveClip, trimClip, restoreCut, isRestored, locate, clipOffset,
  totalDuration, captionLines, applyCaps, exportBody, DEFAULT_CAPTIONS, framingAt, clampFraming,
  overlayHeight, overlaysAt, splitOverlay, retimeOverlay, splitCaption, deleteCaption, fitToLength,
} from '../src/lib/edit.ts';

const clips = [makeClip(1, 3), makeClip(5, 6), makeClip(8, 10)];
const words = [
  { text: 'Hi', start: 1, end: 1.2 }, { text: 'there,', start: 1.3, end: 1.6 }, { text: 'friend.', start: 1.7, end: 2 },
  { text: 'Cut', start: 4, end: 4.2 }, { text: 'kept', start: 5.1, end: 5.4 },
];

test('locate maps output time to clip and source time, honouring speed', () => {
  assert.deepEqual(locate(clips, 0.5), [0, 1.5]);
  assert.deepEqual(locate(clips, 2.5), [1, 5.5]);
  const fast = [{ ...makeClip(0, 4), speed: 2 }];
  assert.equal(totalDuration(fast), 2);
  assert.deepEqual(locate(fast, 1), [0, 2]);
  assert.equal(clipOffset(clips, 2), 3);
});

test('split, delete, duplicate, move', () => {
  assert.deepEqual(splitAt(clips, 1).map((c) => [c.start, c.end]), [[1, 2], [2, 3], [5, 6], [8, 10]]);
  assert.equal(removeClip(clips, 1).length, 2);
  assert.equal(duplicateClip(clips, 0).length, 4);
  assert.deepEqual(moveClip(clips, 0, 2).map((c) => c.start), [5, 8, 1]);
});

test('trimming stays inside the take and keeps a minimum length', () => {
  assert.deepEqual(trimClip(clips, 0, { start: -5 }, 12)[0], { ...clips[0], start: 0 });
  assert.equal(trimClip(clips, 0, { start: 2.99 }, 12)[0].start <= 2.9, true);
  assert.equal(trimClip(clips, 2, { end: 99 }, 12)[2].end, 12);
});

test('restoring a cut merges with the clips it touches', () => {
  const cut = { start: 3, end: 5, reason: 'dead air', text: '' };
  assert.equal(isRestored(clips, cut), false);
  const next = restoreCut(clips, cut);
  assert.deepEqual(next.map((c) => [c.start, c.end]), [[1, 6], [8, 10]]);
  assert.equal(isRestored(next, cut), true);
});

test('caption lines group, format and stay inside their clip', () => {
  const lines = captionLines(words, clips, DEFAULT_CAPTIONS);
  assert.deepEqual(lines.map((l) => l.text), ['Hi there, friend.', 'kept']);
  const upper = captionLines(words, clips, { ...DEFAULT_CAPTIONS, caps: 'upper', punctuation: false, wordsPerLine: 1 });
  assert.deepEqual(upper.map((l) => l.text), ['HI', 'THERE', 'FRIEND', 'KEPT']);
  assert.equal(applyCaps('make IT pop', 'title'), 'Make It Pop');
});

test('edited caption text replaces the line, spread over its time', () => {
  const key = String(Math.round(1 * 100));
  const lines = captionLines(words, clips, { ...DEFAULT_CAPTIONS, edits: { [key]: 'Hello everyone' } });
  assert.equal(lines[0].text, 'Hello everyone');
  assert.ok(lines[0].words[1].start > lines[0].words[0].start);
});

test('export body mutes clips when audio is muted and omits disabled captions', () => {
  const edit = { clips, muted: true, captions: { ...DEFAULT_CAPTIONS, enabled: false }, texts: [] };
  const body = exportBody(edit, words, { height: 1080 });
  assert.ok(body.clips.every((c) => c.volume === 0));
  assert.equal(body.captions, undefined);
  assert.equal(body.height, 1080);
});

test('export body puts the cover frame first and moves captions, text and music along', () => {
  const edit = {
    clips, muted: false, captions: { ...DEFAULT_CAPTIONS, enabled: true },
    texts: [{ id: 't', text: 'Hey', style: 'classic', start: 1, end: 2, x: 0.5, y: 0.3, scale: 1 }],
    cover: 2.5, // output 2.5 s = source 5.5 s (second clip starts at output 2)
    music: { file: 'm.mp3', name: 'Song', mime: 'audio/mpeg', duration: 30, volume: 0.4 },
  };
  const body = exportBody(edit, words, { height: 1080 }, 'upload-1');
  assert.equal(body.clips.length, clips.length + 1);
  assert.equal(body.clips[0].start, 5.5);
  assert.ok(Math.abs(body.clips[0].end - body.clips[0].start - 0.06) < 1e-9);
  assert.equal(body.clips[0].volume, 0);
  assert.ok(Math.abs(body.texts[0].start - 1.06) < 1e-9);
  const plain = exportBody({ ...edit, cover: undefined }, words, {});
  assert.ok(Math.abs(body.captions.lines[0].start - plain.captions.lines[0].start - 0.06) < 1e-9);
  assert.ok(Math.abs(body.captions.lines[0].words[0].start - plain.captions.lines[0].words[0].start - 0.06) < 1e-9);
  assert.deepEqual(body.music, { upload: 'upload-1', volume: 0.4 });
  assert.equal(plain.music, undefined);
});

test('keyframes hold before the first, ease between and hold after the last', () => {
  const k = [
    { id: 'a', t: 1, scale: 1, x: 0, y: 0 },
    { id: 'b', t: 3, scale: 2, x: 0.2, y: -0.1 },
  ];
  assert.deepEqual(framingAt(k, 0), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(framingAt(k, 5), { scale: 2, x: 0.2, y: -0.1 });
  const mid = framingAt(k, 2); // halfway: the eased curve is exactly halfway too
  assert.ok(Math.abs(mid.scale - 1.5) < 1e-9 && Math.abs(mid.x - 0.1) < 1e-9);
  assert.ok(framingAt(k, 1.5).scale < 1.25, 'eases in: slower than a straight line at the start');
  assert.deepEqual(framingAt(undefined, 2), { scale: 1, x: 0, y: 0 });
});

test('framing never shows the edge of the picture', () => {
  assert.deepEqual(clampFraming({ scale: 0.5, x: 0.3, y: 0 }), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(clampFraming({ scale: 2, x: 0.9, y: -0.9 }), { scale: 2, x: 0.5, y: -0.5 });
  assert.equal(clampFraming({ scale: 9, x: 0, y: 0 }).scale, 4);
});

const photo = { id: 'p', file: 'c-overlay-1.jpg', kind: 'image', mime: 'image/jpeg', w: 1000, h: 500, start: 1, end: 4, from: 0, length: 0, x: 0.5, y: 0.5, width: 0.8, rotation: 0, volume: 1 };
const clipO = { ...photo, id: 'v', file: 'c-overlay-2.mov', kind: 'video', mime: 'video/quicktime', start: 2, end: 5, from: 1, length: 6 };

test('overlay shape and which overlays show', () => {
  // 80% of a 9:16 frame's width, half as tall as wide.
  assert.equal(overlayHeight(photo, 9 / 16).toFixed(4), (0.8 * (9 / 16) * 0.5).toFixed(4));
  assert.deepEqual(overlaysAt([photo, clipO], 1.5).map((o) => o.id), ['p']);
  assert.deepEqual(overlaysAt([photo, clipO], 3).map((o) => o.id), ['p', 'v']);
  assert.deepEqual(overlaysAt([photo, clipO], 5).map((o) => o.id), []);
  assert.deepEqual(overlaysAt(undefined, 1), []);
});

test('splitting an overlay: a video carries on where it was', () => {
  const [a, b] = splitOverlay([clipO], 'v', 3, () => 'v2');
  assert.deepEqual([a.start, a.end, a.from], [2, 3, 1]);
  assert.deepEqual([b.id, b.start, b.end, b.from], ['v2', 3, 5, 2]);
  // Too close to an end: nothing changes.
  const same = [clipO];
  assert.equal(splitOverlay(same, 'v', 2.1, () => 'x'), same);
});

test('retiming an overlay stays on the timeline and inside its video', () => {
  // Sliding keeps its length and stops at the ends.
  assert.deepEqual([retimeOverlay(photo, { start: 8, end: 11 }, 10).start, retimeOverlay(photo, { start: 8, end: 11 }, 10).end], [7, 10]);
  assert.equal(retimeOverlay(photo, { start: -2, end: 1 }, 10).start, 0);
  // A video can't start before its first frame, and moving its start moves where it plays from.
  const early = retimeOverlay(clipO, { start: 0 }, 10);
  assert.deepEqual([early.start, early.from], [1, 0]);
  const late = retimeOverlay(clipO, { start: 3 }, 10);
  assert.deepEqual([late.start, late.from, late.end], [3, 2, 5]);
  // Nor run past its last frame (6s long, starting 1s in: 5s of it from 2s → ends by 7).
  assert.equal(retimeOverlay(clipO, { end: 9 }, 10).end, 7);
  // Never shorter than the minimum.
  assert.ok(retimeOverlay(photo, { end: 1.1 }, 10).end - 1 >= 0.3 - 1e-9);
});

test('export sends uploaded overlays, shifted for the cover, muted as silent', () => {
  const edit = { clips, muted: false, captions: { ...DEFAULT_CAPTIONS, enabled: false }, texts: [], cover: 0.5, overlays: [photo, { ...clipO, muted: true }] };
  const body = exportBody(edit, words, {}, undefined, { p: 'up-p', v: 'up-v' });
  assert.equal(body.overlays.length, 2);
  const [a, b] = body.overlays;
  assert.equal(a.upload, 'up-p');
  assert.equal(a.kind, 'image');
  assert.ok(Math.abs(a.start - (1 + 0.06)) < 1e-9);
  assert.equal(b.volume, 0);
  assert.equal(b.from, 1);
  // One that never uploaded is left out rather than sent broken.
  assert.equal(exportBody(edit, words, {}, undefined, { p: 'up-p' }).overlays.length, 1);
});

test('captions: split a line at the playhead, delete one, and the export carries where they sit', () => {
  const one = [makeClip(1, 2.2)];
  const settings = { ...DEFAULT_CAPTIONS, wordsPerLine: 5 };
  const [line] = captionLines(words, one, settings);
  assert.equal(line.text, 'Hi there, friend.');
  // Playhead on "there,": it starts the second line.
  const split = splitCaption(settings, line, 0.3);
  assert.ok(split);
  assert.deepEqual(captionLines(words, one, split).map((l) => l.text), ['Hi', 'there, friend.']);
  // Nothing to split before the second word, or in a retyped line.
  assert.equal(splitCaption(settings, line, 0), null);
  assert.equal(splitCaption({ ...settings, edits: { [line.key]: 'Hello' } }, line, 0.3), null);
  // Deleting takes the line out.
  const lines = captionLines(words, one, split);
  assert.deepEqual(captionLines(words, one, deleteCaption(split, lines[0])).map((l) => l.text), ['there, friend.']);
  // Position and size go to the export; words go without their keys.
  const body = exportBody({ clips: one, muted: false, captions: { ...split, x: 0.4, y: 0.5, scale: 1.3 }, texts: [] }, words, {});
  assert.deepEqual([body.captions.x, body.captions.y, body.captions.scale], [0.4, 0.5, 1.3]);
  assert.deepEqual(Object.keys(body.captions.lines[0].words[0]).sort(), ['end', 'start', 'text']);
});

test('caption lines never overlap: each ends by the time the next starts', () => {
  const close = [
    { text: 'one', start: 0, end: 0.3 }, { text: 'two', start: 0.3, end: 0.6 }, { text: 'three.', start: 0.6, end: 0.9 },
    { text: 'four', start: 0.92, end: 1.2 }, { text: 'five', start: 1.2, end: 1.5 },
  ];
  const lines = captionLines(close, [makeClip(0, 2)], { ...DEFAULT_CAPTIONS, wordsPerLine: 3 });
  assert.equal(lines.length, 2);
  for (let i = 0; i + 1 < lines.length; i++) assert.ok(lines[i].end <= lines[i + 1].start + 1e-9, `line ${i} runs into the next`);
});

test('texts and overlays past a shortened end slide back inside it', () => {
  const edit = {
    clips: [makeClip(0, 10)], muted: false, captions: DEFAULT_CAPTIONS,
    texts: [{ id: 't', text: 'a', style: 'classic', start: 2, end: 4, x: 0.5, y: 0.5, scale: 1 }, { id: 'u', text: 'b', style: 'classic', start: 9, end: 12, x: 0.5, y: 0.5, scale: 1 }],
    overlays: [{ ...photo, start: 18, end: 21 }],
  };
  const fitted = fitToLength(edit, 8);
  assert.equal(fitted.texts[0], edit.texts[0]); // inside: untouched
  assert.deepEqual([fitted.texts[1].start, fitted.texts[1].end], [5, 8]);
  assert.deepEqual([fitted.overlays[0].start, fitted.overlays[0].end], [5, 8]);
  // Longer than the whole video: fills it.
  assert.deepEqual([fitToLength(edit, 2).overlays[0].start, fitToLength(edit, 2).overlays[0].end], [0, 2]);
  // Nothing past the end: the same edit back.
  assert.equal(fitToLength(edit, 30), edit);
});

test('overlap audio is on unless switched off, and goes to the export', () => {
  const base = { clips, muted: false, captions: { ...DEFAULT_CAPTIONS, enabled: false }, texts: [] };
  assert.equal(exportBody(base, words, {}).overlapAudio, true);
  assert.equal(exportBody({ ...base, overlapAudio: false }, words, {}).overlapAudio, false);
});

test('plans: Starter has neither overlap audio nor scheduled batch edits; Pro and Ultimate have both', async () => {
  const { planAllows, OVERLAP, SCHEDULED } = await import('../src/lib/plans.ts');
  assert.deepEqual([planAllows('starter', OVERLAP), planAllows('starter', SCHEDULED)], [false, false]);
  assert.deepEqual([planAllows('pro', OVERLAP), planAllows('pro', SCHEDULED)], [true, true]);
  assert.deepEqual([planAllows('ultimate', OVERLAP), planAllows('ultimate', SCHEDULED)], [true, true]);
  assert.equal(planAllows(undefined, OVERLAP), false); // no plan yet: Starter
});
