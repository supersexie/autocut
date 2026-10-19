import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAss, STYLES } from '../src/ass.js';

const line = { start: 0, end: 1.5, words: [{ text: 'make', start: 0, end: 0.4 }, { text: 'it', start: 0.5, end: 0.7 }, { text: 'pop', start: 0.8, end: 1.2 }] };
const dialogues = (ass) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'));

test('every caption and text style uses a bundled font', () => {
  const bundled = ['TikTok Sans Bold', 'Inter', 'Inter ExtraBold', 'Inter Black', 'Montserrat ExtraBold', 'Montserrat Black', 'Anton', 'Bangers', 'Lilita One', 'Shrikhand', 'Playfair Display', 'Poppins', 'Roboto Condensed Bold', 'Luckiest Guy', 'Fredoka SemiBold', 'Abel', 'Zilla Slab Bold Italic', 'Playfair Display Regular'];
  for (const s of [...STYLES.captions, ...STYLES.texts]) assert.ok(bundled.includes(s.font), `${s.id} uses ${s.font}`);
});

test('the default look is white TikTok Sans with no outline, and an outline can still be added', () => {
  const style = (ass, name) => ass.split('\n').find((l) => l.startsWith(`Style: ${name}`)).split(',');
  const plain = style(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', lines: [line] } }), 'Caption');
  assert.equal(plain[1], 'TikTok Sans Bold');
  assert.equal(plain[3], '&H00FFFFFF');
  assert.deepEqual([plain[16], plain[17]], ['0', '0']); // outline, shadow
  const outlined = style(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', outline: true, lines: [line] } }), 'Caption');
  assert.equal(outlined[16], '7'); // as thick as Classic Outline
  const text = style(buildAss({ width: 1080, height: 1920, texts: [{ text: 'x', style: 'classic', start: 0, end: 1 }] }), 'Text0');
  assert.deepEqual([text[1], text[16]], ['TikTok Sans Bold', '0']);
});

test('moved and resized captions are pinned where the user put them', () => {
  const ass = buildAss({ width: 1080, height: 1920, captions: { style: 'classic', x: 0.25, y: 0.5, scale: 1.5, lines: [line] } });
  assert.match(dialogues(ass)[0], /\{\\an2\\pos\(270,960\)\}make it pop$/);
  // Fontsize is the font's whole line height in libass: TikTok Sans's is 1.3 em, so the text's em
  // comes out at 8.5% of the width × 1.5, as in the editor.
  assert.equal(ass.split('\n').find((l) => l.startsWith('Style: Caption')).split(',')[2], String(Math.round(1080 * 0.085 * 1.5 * 1.3)));
  // Word-by-word styles too, on every event.
  const words = dialogues(buildAss({ width: 1080, height: 1920, captions: { style: 'word-box', y: 0.6, lines: [line] } }));
  assert.ok(words.every((d) => d.includes('\\an2\\pos(540,1152)')));
  // Not moved: the style's own spot, no position tag.
  assert.doesNotMatch(dialogues(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', lines: [line] } }))[0], /pos/);
});

test('overlapping caption lines are trimmed so two never show at once', () => {
  const a = { start: 0, end: 1.2, words: [{ text: 'one', start: 0, end: 1 }] };
  const b = { start: 1, end: 2, words: [{ text: 'two', start: 1, end: 1.8 }] };
  const d = dialogues(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', y: 0.5, lines: [a, b] } }));
  assert.match(d[0], /^Dialogue: 0,0:00:00\.00,0:00:01\.00,/);
  assert.match(d[1], /^Dialogue: 0,0:00:01\.00,0:00:02\.00,/);
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
  assert.match(outlined.split('\n').find((l) => l.startsWith('Style: Text0')), /,1,7,0,5,/);
});

test('a caption colour the user picked is used in the export', () => {
  const style = (ass) => ass.split('\n').find((l) => l.startsWith('Style: Caption')).split(',');
  const plain = style(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', lines: [line] } }));
  const red = style(buildAss({ width: 1080, height: 1920, captions: { style: 'classic', color: '#F2545B', lines: [line] } }));
  assert.equal(plain[3], '&H00FFFFFF'); // the style's white
  assert.equal(red[3], '&H005B54F2'); // ASS colours are &HAABBGGRR
});
