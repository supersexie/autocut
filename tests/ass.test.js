import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAss, STYLES } from '../src/ass.js';

const line = { start: 0, end: 1.5, words: [{ text: 'make', start: 0, end: 0.4 }, { text: 'it', start: 0.5, end: 0.7 }, { text: 'pop', start: 0.8, end: 1.2 }] };
const dialogues = (ass) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'));

test('every caption and text style uses a bundled font', () => {
  const bundled = ['Inter', 'Inter ExtraBold', 'Inter Black', 'Montserrat ExtraBold', 'Montserrat Black', 'Anton', 'Bangers', 'Lilita One', 'Shrikhand', 'Playfair Display', 'Poppins'];
  for (const s of [...STYLES.captions, ...STYLES.texts]) assert.ok(bundled.includes(s.font), `${s.id} uses ${s.font}`);
});

test('simple styles write one event per line', () => {
  const ass = buildAss({ width: 1080, height: 1920, captions: { style: 'classic', lines: [line] } });
  assert.equal(dialogues(ass).length, 1);
  assert.match(dialogues(ass)[0], /make it pop$/);
});

test('word-by-word styles highlight each word in turn', () => {
  const ass = buildAss({ width: 1080, height: 1920, captions: { style: 'word-box', lines: [line] } });
  const d = dialogues(ass);
  assert.equal(d.length, 3);
  assert.match(d[1], /make \{\\3c&H[0-9A-F]+&\\bord\d+\}it\{\\r\} pop/);
});

test('one-word style shows a single uppercased word', () => {
  const d = dialogues(buildAss({ width: 1080, height: 1920, captions: { style: 'one-word', lines: [line] } }));
  assert.deepEqual(d.map((x) => x.split(',,').at(-1)), ['MAKE', 'IT', 'POP']);
});

test('text overlays are positioned and user markup is neutralised', () => {
  const d = dialogues(buildAss({ width: 1080, height: 1920, texts: [{ text: 'hi {\\b1} there', style: 'loud', start: 0, end: 2, x: 0.5, y: 0.25 }] }));
  assert.match(d[0], /\\pos\(540,480\)/);
  assert.match(d[0], /HI B1 THERE$/);
});

test('a text can switch font, colour, background box and alignment', () => {
  const d = dialogues(buildAss({ width: 1080, height: 1920, texts: [{ text: 'hey', style: 'classic', start: 0, end: 1, x: 0.2, y: 0.5, font: 'Anton', color: '#FF0000', box: true, align: 'left' }] }));
  assert.match(d[0], /\\an4\\pos\(216,960\)/);
  const ass = buildAss({ width: 1080, height: 1920, texts: [{ text: 'hey', style: 'classic', start: 0, end: 1, font: 'Anton', color: '#FF0000', box: true }] });
  assert.match(ass, /Style: Text0,Anton,\d+,&H000000FF,&H000000FF,&H00FFFFFF,/);
  assert.match(ass.split('\n').find((l) => l.startsWith('Style: Text0')), /,3,14,0,5,/);
});
