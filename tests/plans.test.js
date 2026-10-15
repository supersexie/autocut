import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rulesFor, usageStore } from '../src/plans.js';

test('each plan gets its own edits and features; unknown plans get Starter', () => {
  assert.deepEqual([rulesFor('starter').edits, rulesFor('starter').overlap, rulesFor('starter').schedule], [100, false, false]);
  assert.deepEqual([rulesFor('pro').edits, rulesFor('pro').overlap, rulesFor('pro').schedule], [300, true, true]);
  assert.equal(rulesFor('ultimate').edits, Infinity);
  assert.equal(rulesFor(undefined).name, 'Starter');
  assert.equal(rulesFor('hacker').name, 'Starter');
});

test('edits are counted per account for the month, refunded for failed cuts, and start again next month', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'usage-'));
  const usage = usageStore(dir);
  await Promise.all([usage.add('a'), usage.add('a'), usage.add('a'), usage.add('b')]); // started together: all counted
  assert.equal(await usage.used('a'), 3);
  assert.equal(await usage.used('b'), 1);
  await usage.refund('a');
  assert.equal(await usage.used('a'), 2);
  await usage.refund('b');
  await usage.refund('b'); // never below zero
  assert.equal(await usage.used('b'), 0);
  // Last month's count doesn't carry over.
  await writeFile(path.join(dir, 'c.json'), JSON.stringify({ month: '2000-01', used: 99 }));
  assert.equal(await usage.used('c'), 0);
  await usage.forget('a');
  assert.equal(await usage.used('a'), 0);
});
