import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCuts, retakeScore, findRestarts, noiseFloor } from '../src/plan.js';

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

// Words spoken back to back, 0.3 s each, no punctuation unless given: how Whisper often
// transcribes a restart with no pause.
const stream = (text) => text.split(' ').map((t, i) => ({ text: t, start: i * 0.35, end: i * 0.35 + 0.3 }));
const said = (words, dropped) => words.filter((_, i) => !dropped.includes(i)).map((w) => w.text).join(' ');

test('restart in one run-on line keeps only the redo', () => {
  const w = stream("it's perfectly stretchy they dry super it's perfectly stretchy they dry super quick.");
  assert.equal(said(w, findRestarts(w)), "it's perfectly stretchy they dry super quick.");
});

test('a line said three times keeps the last one', () => {
  const w = stream('these are so these are so soft these are so soft and comfy.');
  assert.equal(said(w, findRestarts(w)), 'these are so soft and comfy.');
});

test('exact repeated sentence keeps one copy', () => {
  const w = stream('This is the best shirt. This is the best shirt I own.');
  assert.equal(said(w, findRestarts(w)), 'This is the best shirt I own.');
});

test('a flubbed word before the redo is dropped with it', () => {
  const w = stream('they dry super fasht they dry super fast.');
  assert.equal(said(w, findRestarts(w)), 'they dry super fast.');
});

test('different sentences that share a phrase are left alone', () => {
  const w = stream("Check them out. They're nice and soft. Check them out below.");
  assert.deepEqual(findRestarts(w), []);
});

test('restarts are removed in the full plan', () => {
  const w = stream('so these joggers so these joggers are actually so soft.');
  const plan = planCuts(w);
  assert.equal(plan.segments.flatMap((s) => s.words.map((x) => x.text)).join(' '), 'so these joggers are actually so soft.');
  assert.ok(plan.cuts.some((c) => c.reason === 'retake'));
});

// Loudness from [start, end, dB] spans over a background level, 10 ms frames.
const levels = (seconds, background, spans) => {
  const frameSec = 0.01;
  const db = Float32Array.from({ length: Math.round(seconds / frameSec) }, (_, f) => {
    const span = spans.find(([a, b]) => f * frameSec >= a && f * frameSec < b);
    return span ? span[2] : background;
  });
  return { db, frameSec };
};

test('silence floor sits between the room and the voice, even in a noisy room', () => {
  const words = W('There@0.5', 'is@0.8', 'no@1.1', 'such@1.4', 'thing@1.7', 'as@2.0', 'cold.@2.3');
  // Speech peaking at -20 dB, soft syllables at -29, over a -31 dB room: barely any real silence.
  const spans = words.flatMap((w) => [[w.start, w.start + 0.2, -20], [w.start + 0.2, w.end, -29]]);
  const noisy = levels(4, -31, spans);
  const floor = noiseFloor(noisy.db, words, noisy.frameSec);
  // The old floor (quietest tenth + 12 dB) would be -19: above the speech itself.
  assert.ok(floor > -31 && floor < -24, `floor ${floor} should be just over the room, well under the speech`);
  // A clean take: speech at -24 over a -49 dB room keeps a floor well above the room.
  const clean = levels(4, -49, words.map((w) => [w.start, w.end, -24]));
  const cleanFloor = noiseFloor(clean.db, words, clean.frameSec);
  assert.ok(cleanFloor > -45 && cleanFloor < -30, `clean floor ${cleanFloor}`);
});

test('soft syllables in a noisy take are never cut as silence', () => {
  const words = W('There@0.5', 'is@0.8', 'no@1.1', 'such@1.4', 'thing@1.7', 'as@2.0', 'cold.@2.3');
  // Every word dips below the room level on its second half (a quiet consonant).
  const lv = levels(3, -30, words.map((w) => [w.start, w.start + 0.15, -20]));
  lv.floor = -26; // as high as a noisy room pushes it
  const plan = planCuts(words, {}, lv);
  assert.equal(keptText(plan), 'There is no such thing as cold.');
  assert.equal(plan.segments.length, 1);
  assert.ok(plan.segments[0].start <= 0.5 && plan.segments[0].end >= 2.45);
});

test('the silent tail Whisper adds to a last word is still trimmed', () => {
  // "AutoCut." is said 2.7-2.95 s but Whisper stretches it to 3.6 s.
  const words = [...W('This@2.1', 'is@2.4'), { text: 'AutoCut.', start: 2.7, end: 3.6 }, ...W('Next@5')];
  const lv = level(6, [[2.1, 2.95], [5, 5.3]]);
  const plan = planCuts(words, {}, lv);
  assert.ok(plan.segments[0].end < 3.25, `first clip ends at ${plan.segments[0].end}`);
});

test('export keyframes follow the same eased curve as the editor', async () => {
  const { keyframeExpr } = await import('../src/media.js');
  const { framingAt } = await import('../app/src/lib/edit.ts');
  const k = [
    { id: 'a', t: 0.5, scale: 1, x: 0, y: 0 },
    { id: 'b', t: 2, scale: 2.2, x: 0.3, y: -0.2 },
    { id: 'c', t: 4, scale: 1.4, x: -0.1, y: 0.1 },
  ];
  // Evaluate ffmpeg's expression language (if, lt, pow) in JS.
  const run = (expr, it) => new Function('it', 'iff', 'lt', 'pow', `return ${expr.replace(/\bif\(/g, 'iff(')};`)(it, (c, a, b) => (c ? a : b), (a, b) => (a < b ? 1 : 0), Math.pow);
  for (let t = 0; t <= 5; t += 0.125) {
    const want = framingAt(k, t);
    for (const key of ['scale', 'x', 'y']) assert.ok(Math.abs(run(keyframeExpr(k, key), t) - want[key]) < 1e-3, `${key} at ${t}`);
  }
});
