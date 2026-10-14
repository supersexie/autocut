import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAss, STYLES } from '../src/ass.js';

const line = { start: 0, end: 1.5, words: [{ text: 'make', start: 0, end: 0.4 }, { text: 'it', start: 0.5, end: 0.7 }, { text: 'pop', start: 0.8, end: 1.2 }] };
const dialogues = (ass) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'));

test('every caption and text style uses a bundled font', () => {
  const bundled = ['TikTok Sans Bold', 'Inter', 'Inter ExtraBold', 'Inter Black', 'Montserrat ExtraBold', 'Montserrat Black', 'Anton', 'Bangers', 'Lilita One', 'Shrikhand', 'Playfair Display', 'Poppins'];
  for (const s of [...STYLES.captions, ...STYLES.texts]) assert.ok(bundled.includes(s.font), `${s.id} uses ${s.font}`);
});

test('the default look is white TikTok Sans with no outline, and an outline can still be added', () => {
  const style = (ass, name) => ass.split('\n').find((l) => l.startsWith(`Style: ${name}`)).split(',');
  const plain = style(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', lines: [line] } }), 'Caption');
  assert.equal(plain[1], 'TikTok Sans Bold');
  assert.equal(plain[3], '&H00FFFFFF');
  assert.deepEqual([plain[16], plain[17]], ['0', '0']); // outline, shadow
  const outlined = style(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', outline: true, lines: [line] } }), 'Caption');
  assert.equal(outlined[16], '3');
  const text = style(buildAss({ width: 1080, height: 1920, texts: [{ text: 'x', style: 'classic', start: 0, end: 1 }] }), 'Text0');
  assert.deepEqual([text[1], text[16]], ['TikTok Sans Bold', '0']);
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

test('outline can be removed or added, for captions and texts', () => {
  const plain = buildAss({ width: 1080, height: 1920, captions: { style: 'classic-outline', outline: false, lines: [line] } });
  assert.match(plain.split('\n').find((l) => l.startsWith('Style: Caption')), /,1,0,0,2,/);
  const outlined = buildAss({ width: 1080, height: 1920, texts: [{ text: 'x', style: 'white-box', box: false, outline: true, start: 0, end: 1 }] });
  assert.match(outlined.split('\n').find((l) => l.startsWith('Style: Text0')), /,1,3,0,5,/);
});
