// Runs the editor's pure clip logic with Node's TypeScript stripping: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAt, removeClip, duplicateClip, restoreCut, isRestored, locate, clipOffset, captionLines } from '../src/lib/edit.ts';

const clips = [[1, 3], [5, 6], [8, 10]];

test('locate maps edited time to clip and source time', () => {
  assert.deepEqual(locate(clips, 0.5), [0, 1.5]);
  assert.deepEqual(locate(clips, 2.5), [1, 5.5]);
  assert.equal(clipOffset(clips, 2), 3);
});

test('split cuts the clip under the playhead', () => {
  assert.deepEqual(splitAt(clips, 1), [[1, 2], [2, 3], [5, 6], [8, 10]]);
  assert.deepEqual(splitAt(clips, 0.05), clips, 'too close to the edge does nothing');
});

test('delete and duplicate', () => {
  assert.deepEqual(removeClip(clips, 1), [[1, 3], [8, 10]]);
  assert.deepEqual(duplicateClip(clips, 0), [[1, 3], [1, 3], [5, 6], [8, 10]]);
});

test('restoring a cut merges with the clips it touches', () => {
  const cut = { start: 3, end: 5, reason: 'dead air', text: '' };
  assert.equal(isRestored(clips, cut), false);
  const next = restoreCut(clips, cut);
  assert.deepEqual(next, [[1, 6], [8, 10]]);
  assert.equal(isRestored(next, cut), true);
  assert.deepEqual(restoreCut([[5, 6]], { start: 0, end: 0.5, reason: 'retake', text: '' }), [[0, 0.5], [5, 6]]);
});

test('caption lines stay inside their clip', () => {
  const words = [{ text: 'Hi', start: 1, end: 1.2 }, { text: 'there.', start: 1.3, end: 1.6 }, { text: 'Cut', start: 4, end: 4.2 }];
  const lines = captionLines(words, [[0.9, 2], [5, 6]]);
  assert.equal(lines[0][0].text, 'Hi there.');
  assert.equal(lines[1].length, 0);
});
