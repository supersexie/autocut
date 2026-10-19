// The progress border and percentage (src/lib/smoothProgress.ts): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGoal, startSmooth, step } from '../src/lib/smoothProgress.ts';

/** Runs 60 frames a second; `updates` are [seconds, value]. Returns what was shown each frame. */
function run(updates, seconds) {
  let s = startSmooth(0);
  const shown = [];
  for (let f = 0; f <= seconds * 60; f++) {
    const t = f / 60;
    for (const [at, v] of updates) if (Math.abs(at - t) < 1 / 120) s = setGoal(s, v, t);
    s = step(s, 1 / 60);
    shown.push(s.shown);
  }
  return shown;
}

const biggestStep = (xs) => Math.max(...xs.slice(1).map((x, i) => x - xs[i]));
const longestPause = (xs) => {
  let run = 0, most = 0;
  for (let i = 1; i < xs.length; i++) {
    run = xs[i] - xs[i - 1] < 0.0002 ? run + 1 : 0;
    most = Math.max(most, run);
  }
  return most / 60; // seconds
};

test('updates every 2 seconds: moves all the time, never jumps or steps back', () => {
  const ups = Array.from({ length: 10 }, (_, k) => [2 * (k + 1), 0.1 * (k + 1) * 0.9]);
  const xs = run(ups, 20);
  assert.ok(biggestStep(xs) < 0.01, `biggest frame step ${biggestStep(xs)}`);
  assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1]));
  assert.ok(longestPause(xs.slice(150, 1000)) < 0.5, `paused ${longestPause(xs.slice(150, 1000))}s`);
});

test('a big jump (upload done, 2% to 37%) glides over a second or more', () => {
  const xs = run([[0.5, 0.02], [1, 0.37]], 4);
  assert.ok(biggestStep(xs) < 0.006, `biggest frame step ${biggestStep(xs)}`);
  assert.ok(xs[60 * 2] > 0.2 && xs[60 * 4] > 0.33);
});

test('finishing goes all the way to 100%, quickly', () => {
  const xs = run([[0.5, 0.5], [1, 0.8], [1.5, 1]], 3);
  assert.equal(xs.at(-1), 1);
});

test('starting over goes back', () => {
  let s = startSmooth(0);
  s = setGoal(s, 0.6, 0);
  for (let i = 0; i < 300; i++) s = step(s, 1 / 60);
  s = setGoal(s, 0, 5);
  assert.equal(s.shown, 0);
});
