import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCuts, retakeScore } from '../src/plan.js';
import { remapWords, toSrt } from '../src/captions.js';

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
