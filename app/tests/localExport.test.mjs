// The phone export's job (src/lib/localExport.ts): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captionEvents, exportSpec } from '../src/lib/localExport.ts';
import { exportBody, makeClip, DEFAULT_CAPTIONS } from '../src/lib/edit.ts';

const presets = JSON.parse(readFileSync(new URL('../src/lib/styles.json', import.meta.url), 'utf8'));
const style = (id) => presets.captions.find((c) => c.id === id);
const lines = [
  { start: 0, end: 1.5, words: [{ text: 'Hi', start: 0.1, end: 0.4 }, { text: 'there', start: 0.5, end: 0.9 }] },
  { start: 1.2, end: 2, words: [{ text: 'friend.', start: 1.2, end: 1.8 }] },
];

test('captions: one per line, never two at once (as the server draws them)', () => {
  const ev = captionEvents(lines, style('classic'));
  assert.deepEqual(ev, [{ start: 0, end: 1.2, words: ['Hi', 'there'], active: -1 }, { start: 1.2, end: 2, words: ['friend.'], active: -1 }]);
});

test('word-by-word captions: one per word, the spoken word picked out', () => {
  const ev = captionEvents(lines, style('light-up'));
  assert.deepEqual(ev.slice(0, 2), [{ start: 0, end: 0.5, words: ['Hi', 'there'], active: 0 }, { start: 0.5, end: 1.2, words: ['Hi', 'there'], active: 1 }]);
  // One Word: just the word, in capitals.
  assert.deepEqual(captionEvents(lines, style('one-word'))[1], { start: 0.5, end: 1.2, words: ['THERE'], active: -1 });
});

test("the job: local files, looks resolved with the user's changes, overlays and music by file", () => {
  const words = [{ text: 'Hello', start: 1.1, end: 1.5 }, { text: 'world.', start: 1.6, end: 2 }];
  const edit = {
    clips: [makeClip(1, 3), { ...makeClip(5, 7), speed: 2 }],
    captions: { ...DEFAULT_CAPTIONS, enabled: true, style: 'classic', box: true, scale: 1.5 },
    texts: [{ id: 't', text: 'hey', style: 'comic', start: 0, end: 1, x: 0.4, y: 0.2, scale: 2, align: 'left' }],
    keyframes: [{ id: 'k', t: 1, scale: 1.2, x: 0, y: 0 }],
    overlays: [{ id: 'o', file: 'o.png', kind: 'image', mime: 'image/png', w: 10, h: 10, start: 0, end: 1, x: 0.5, y: 0.5, width: 0.3, rotation: 0 }],
    music: { file: 'song.m4a', name: 'Song', mime: 'audio/mp4', duration: 3, volume: 0.4 },
    overlapAudio: true,
  };
  const body = exportBody(edit, words, { height: 720, fps: 24, bitrate: 8 }, 'music', { o: 'o' });
  const spec = exportSpec(body, presets, { source: 'file:///src.mp4', output: 'file:///out.mp4', music: 'file:///song.m4a', overlays: { o: 'file:///o.png' }, fonts: { 'Luckiest Guy': 'file:///b.ttf' } });
  assert.equal(spec.height, 720);
  assert.equal(spec.fps, 24);
  assert.equal(spec.clips[1].speed, 2);
  assert.equal(spec.overlap, true);
  assert.deepEqual(spec.music, { file: 'file:///song.m4a', volume: 0.4 });
  assert.equal(spec.overlays[0].file, 'file:///o.png');
  assert.equal(spec.overlays[0].upload, undefined);
  // Box turned on: a dark box behind the white text; size includes the user's scale.
  assert.equal(spec.captions.style.box, '#111114');
  assert.equal(spec.captions.style.size, 1.5);
  assert.deepEqual([spec.captions.x, spec.captions.y], [0.5, 0.76]);
  assert.deepEqual(spec.captions.events.map((e) => e.words.join(' ')), ['Hello world.']);
  // Comic text: capitals, its own font, doubled.
  assert.deepEqual([spec.texts[0].text, spec.texts[0].style.font, spec.texts[0].style.size, spec.texts[0].align], ['HEY', 'Luckiest Guy', 2.5, 'left']);
});
