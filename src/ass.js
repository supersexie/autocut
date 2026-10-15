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

const isDark = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
};

/** The black outline added when Outline is picked (same as the app's OUTLINE in StyledText.tsx). */
const OUTLINE = 7;

/** A text's own font/colour/box choices on top of its style (mirrors StyledText in the app). */
export function withLook(s, t = {}) {
  const out = { ...s };
  if (t.font) out.font = t.font;
  if (t.color) out.color = t.color;
  if (t.box === true && !s.box) {
    out.box = isDark(out.color) ? '#FFFFFF' : '#111114';
    out.outlineWidth = 14;
    out.shadow = 0;
    out.glow = 0;
  }
  if (t.box === false && s.box) {
    out.box = undefined;
    out.outline = '#000000';
    out.outlineWidth = OUTLINE;
  }
  // Outline only applies without a box: false = plain text, true = add a black outline.
  if (!out.box && t.outline === false) {
    out.outlineWidth = 0;
    out.shadow = 0;
    out.glow = 0;
  }
  if (!out.box && t.outline === true && !(out.outlineWidth > 0)) {
    out.outline = '#000000';
    out.outlineWidth = OUTLINE;
  }
  return out;
}

/**
 * captions: { style, lines: [{ start, end, words: [{ text, start, end }] }] } on the output timeline.
 * texts: [{ text, style, start, end, x, y, scale }] with x/y as 0–1 of the frame (centre of the text).
 */
export function buildAss({ width, height, captions, texts = [] }) {
  const playResY = Math.round((BASE_WIDTH * height) / width);
  const styles = [];
  const events = [];

  if (captions?.lines?.length) {
    const s = withLook(STYLES.captions.find((c) => c.id === captions.style) ?? STYLES.captions[0], { box: captions.box, outline: captions.outline, color: captions.color });
    styles.push(styleLine('Caption', { ...s, size: (s.size ?? 1) * (captions.scale ?? 1) }, playResY, 2, Math.round(playResY * 0.24)));
    // Moved by the user: pinned by the middle of its bottom edge. Otherwise the style's own spot.
    const moved = captions.x !== undefined || captions.y !== undefined;
    const pos = moved ? `\\an2\\pos(${Math.round((captions.x ?? 0.5) * BASE_WIDTH)},${Math.round((captions.y ?? 0.76) * playResY)})` : '';
    const lead = s.glow || pos ? `{${pos}${s.glow ? `\\blur${s.glow}` : ''}}` : ''; // tags at the start of every caption event
    // Never two caption lines at once (older apps let one linger into the next): one ends where the next begins.
    const ordered = [...captions.lines].sort((a, b) => a.start - b.start);
    const lines = ordered.map((l, i) => (i + 1 < ordered.length && ordered[i + 1].start < l.end ? { ...l, end: Math.max(l.start + 0.05, ordered[i + 1].start) } : l));
    for (const line of lines) {
      const words = line.words.filter((w) => w.text);
      const mode = s.highlight?.mode;
      if (!mode || !words.length) {
        events.push(`Dialogue: 0,${time(line.start)},${time(line.end)},Caption,,0,0,0,,${lead}${clean(upper(s, words.map((w) => w.text).join(' ') || line.text || ''))}`);
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
        events.push(`Dialogue: 0,${time(start)},${time(end)},Caption,,0,0,0,,${lead}${text}`);
      });
    }
  }

  texts.forEach((t, i) => {
    const s = withLook(STYLES.texts.find((x) => x.id === t.style) ?? STYLES.texts[0], t);
    const name = `Text${i}`;
    const an = t.align === 'left' ? 4 : t.align === 'right' ? 6 : 5;
    styles.push(styleLine(name, { ...s, size: (s.size ?? 1) * (t.scale ?? 1) }, playResY, an, 0));
    const x = Math.round((t.x ?? 0.5) * BASE_WIDTH);
    const y = Math.round((t.y ?? 0.5) * playResY);
    const glow = s.glow ? `\\blur${s.glow}` : '';
    events.push(`Dialogue: 1,${time(t.start)},${time(t.end)},${name},,0,0,0,,{\\an${an}\\pos(${x},${y})${glow}}${clean(upper(s, t.text))}`);
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
