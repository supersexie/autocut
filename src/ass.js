// Builds an ASS subtitle file (rendered by libass in ffmpeg) for captions and text overlays.
// Style presets live in app/src/lib/styles.json so the app preview and the export match.
import { readFileSync } from 'node:fs';

const STYLES = JSON.parse(readFileSync(new URL('../app/src/lib/styles.json', import.meta.url), 'utf8'));
export const FONTS_DIR = new URL('../fonts', import.meta.url).pathname;

const BASE_WIDTH = 1080; // PlayResX; libass scales everything to the real video size
const FONT_SCALE = 0.085; // font size as a share of the width, for size 1

/** '#RRGGBB' → ASS '&HAABBGGRR' (alpha 00 = opaque). */
function assColor(hex = '#FFFFFF', alpha = 0) {
  const h = hex.replace('#', '');
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
}

/** '#RRGGBB' → '&HBBGGRR&', the colour form used inside {\\…} override tags. */
function tagColor(hex) {
  const h = hex.replace('#', '');
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

const time = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// Braces and backslashes are ASS markup; keep user text literal.
const clean = (text) => String(text).replace(/[{}\\]/g, '').replace(/\n/g, '\\N');

function styleLine(name, s, playResY, alignment, marginV) {
  const size = Math.round(BASE_WIDTH * FONT_SCALE * (s.size ?? 1));
  const boxed = !!s.box;
  // In BorderStyle 3 (opaque box) libass fills the box with the outline colour.
  return [
    `Style: ${name}`, s.font, size,
    assColor(s.color), assColor(s.color),
    boxed ? assColor(s.box) : assColor(s.outline ?? '#000000'),
    assColor('#000000', 0x80),
    s.bold ? -1 : 0, s.italic ? -1 : 0, 0, 0, 100, 100, 0, s.rotate ?? 0,
    boxed ? 3 : 1, s.outlineWidth ?? 0, s.shadow ?? 0,
    alignment, 60, 60, marginV, 1,
  ].join(',');
}

const upper = (s, text) => (s.uppercase ? text.toUpperCase() : text);

/**
 * captions: { style, lines: [{ start, end, words: [{ text, start, end }] }] } on the output timeline.
 * texts: [{ text, style, start, end, x, y, scale }] with x/y as 0–1 of the frame (centre of the text).
 */
export function buildAss({ width, height, captions, texts = [] }) {
  const playResY = Math.round((BASE_WIDTH * height) / width);
  const styles = [];
  const events = [];

  if (captions?.lines?.length) {
    const s = STYLES.captions.find((c) => c.id === captions.style) ?? STYLES.captions[0];
    styles.push(styleLine('Caption', s, playResY, 2, Math.round(playResY * 0.24)));
    const glow = s.glow ? `{\\blur${s.glow}}` : '';
    for (const line of captions.lines) {
      const words = line.words.filter((w) => w.text);
      const mode = s.highlight?.mode;
      if (!mode || !words.length) {
        events.push(`Dialogue: 0,${time(line.start)},${time(line.end)},Caption,,0,0,0,,${glow}${clean(upper(s, words.map((w) => w.text).join(' ') || line.text || ''))}`);
        continue;
      }
      // Word by word: one event per word, from that word until the next one starts.
      words.forEach((w, i) => {
        const start = i === 0 ? line.start : w.start;
        const end = i + 1 < words.length ? words[i + 1].start : line.end;
        if (end <= start) return;
        let text;
        if (mode === 'single') text = clean(upper(s, w.text));
        else {
          const hl = mode === 'box'
            ? `{\\3c${tagColor(s.highlight.color)}\\bord${Math.round((s.outlineWidth ?? 4) * 3.4)}}`
            : `{\\1c${tagColor(s.highlight.color)}}`;
          text = words.map((x, j) => (j === i ? `${hl}${clean(upper(s, x.text))}{\\r}` : clean(upper(s, x.text)))).join(' ');
        }
        events.push(`Dialogue: 0,${time(start)},${time(end)},Caption,,0,0,0,,${glow}${text}`);
      });
    }
  }

  texts.forEach((t, i) => {
    const s = STYLES.texts.find((x) => x.id === t.style) ?? STYLES.texts[0];
    const name = `Text${i}`;
    styles.push(styleLine(name, { ...s, size: (s.size ?? 1) * (t.scale ?? 1) }, playResY, 5, 0));
    const x = Math.round((t.x ?? 0.5) * BASE_WIDTH);
    const y = Math.round((t.y ?? 0.5) * playResY);
    const glow = s.glow ? `\\blur${s.glow}` : '';
    events.push(`Dialogue: 1,${time(t.start)},${time(t.end)},${name},,0,0,0,,{\\an5\\pos(${x},${y})${glow}}${clean(upper(s, t.text))}`);
  });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${BASE_WIDTH}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

export { STYLES };
