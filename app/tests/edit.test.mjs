// Runs the editor's pure logic with Node's TypeScript stripping: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeClip, splitAt, removeClip, duplicateClip, moveClip, trimClip, restoreCut, isRestored, locate, clipOffset,
  totalDuration, captionLines, applyCaps, exportBody, DEFAULT_CAPTIONS,
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
