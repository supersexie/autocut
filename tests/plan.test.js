import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCuts, retakeScore } from '../src/plan.js';

import { remapWords, toSrt } from '../src/captions.js';

// Fake loudness: loud (-20 dB) inside the given [start, end] ranges, silent (-50 dB) elsewhere.
const level = (seconds, loudRanges) => {
  const frameSec = 0.01;
  const db = Float32Array.from({ length: Math.round(seconds / frameSec) }, (_, f) =>
    loudRanges.some(([a, b]) => f * frameSec >= a && f * frameSec < b) ? -20 : -50);
  return { db, frameSec, floor: -38 };
};

// Build words from "text@start" pairs, each word lasting 0.3s.
const W = (...items) => items.map((s) => {
  const [text, t] = s.split('@');
  return { text, start: +t, end: +t + 0.3 };
});
const keptText = (plan) => plan.segments.flatMap((s) => s.words.map((w) => w.text)).join(' ');

test('keeps the last delivery of a retaken line', () => {
  const words = W('These@0', 'are@0.3', 'so.@0.6', 'These@2', 'are@2.3', 'so@2.6', 'comfy.@2.9', 'Buy@3.3', 'them.@3.6');
  const plan = planCuts(words);
  assert.equal(keptText(plan), 'These are so comfy. Buy them.');
  assert.equal(plan.cuts[0].reason, 'retake');
});

test('cuts dead air between sentences', () => {
  const words = W('Hello.@0', 'Bye.@3');
  const plan = planCuts(words);
  assert.equal(plan.segments.length, 2);
  assert.ok(plan.cuts.some((c) => c.reason === 'dead air' && c.start > 0.3 && c.end < 3));
});

test('removes fillers and stutters but keeps the sentence', () => {
  const words = W('I@0', 'I@0.3', 'love@0.6', 'um@0.9', 'this@1.2', 'shirt.@1.5');
  assert.equal(keptText(planCuts(words)), 'I love this shirt.');
  assert.equal(keptText(planCuts(words, { removeFillers: false })), 'I love um this shirt.');
});

test('different lines are not mistaken for retakes', () => {
  assert.ok(retakeScore(['it', 'fits', 'great'], ['the', 'color', 'is', 'nice']) < 0.6);
  assert.equal(retakeScore(['they', 'dry'], ['they', 'dry', 'super', 'quick']), 1);
});

test('captions are remapped onto the output timeline', () => {
  const plan = planCuts(W('Hello.@0', 'Bye.@3'));
  const words = remapWords(plan.segments);
  assert.ok(words[1].start < 1.5);
  assert.match(toSrt(words), /^1\n00:00:00,/);
});

test('cuts a silence that Whisper hid inside a stretched word', () => {
  // "and" is timed 1.0–4.0 s, but the audio is only loud 1.0–1.3 s, then again from 3.8 s.
  const words = [
    { text: 'Hi', start: 0.5, end: 0.8 },
    { text: 'and', start: 1.0, end: 4.0 },
    { text: 'bye.', start: 4.0, end: 4.4 },
  ];
  const plan = planCuts(words, {}, level(5, [[0.5, 1.3], [3.8, 4.4]]));
  assert.equal(plan.segments.length, 2);
  assert.ok(plan.segments[0].end < 1.6, `first piece ends at ${plan.segments[0].end}`);
  assert.ok(plan.segments[1].start > 3.5, `second piece starts at ${plan.segments[1].start}`);
  assert.ok(plan.cuts.some((c) => c.reason === 'dead air' && c.end - c.start > 2));
  assert.ok(plan.words[1].end <= plan.segments[0].end, 'the stretched word is clamped to its piece');
});

test('keeps short natural pauses inside a sentence', () => {
  const words = [{ text: 'so', start: 0, end: 0.3 }, { text: 'good.', start: 0.5, end: 0.9 }];
  const plan = planCuts(words, {}, level(1.2, [[0, 0.3], [0.5, 0.9]]));
  assert.equal(plan.segments.length, 1);
});
