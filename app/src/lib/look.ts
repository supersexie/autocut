// Caption and text looks: a preset (styles.json) with the user's changes on top. Shared by the
// editor's preview (StyledText.tsx), the phone export (localExport.ts) and, in the same form,
// the server (withLook in src/ass.js).
import type { TextLook } from './edit';

export type StylePreset = {
  id: string;
  name: string;
  group?: string;
  font: string;
  size: number;
  color: string;
  outline?: string;
  outlineWidth?: number;
  box?: string;
  shadow?: number;
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  rotate?: number;
  glow?: number;
  highlight?: { mode: 'box' | 'color' | 'single'; color?: string };
};

const isDark = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
};

/** The black outline added when Outline is picked: as thick as the Classic Outline style's. */
export const OUTLINE = 7;

/** A text's own font/colour/box choices on top of its style (mirrors withLook in src/ass.js). */
export function withLook(p: StylePreset, look?: TextLook): StylePreset {
  if (!look) return p;
  const out = { ...p };
  if (look.font) out.font = look.font;
  if (look.color) out.color = look.color;
  if (look.box === true && !p.box) Object.assign(out, { box: isDark(out.color) ? '#FFFFFF' : '#111114', outlineWidth: 14, shadow: 0, glow: 0 });
  if (look.box === false && p.box) Object.assign(out, { box: undefined, outline: '#000000', outlineWidth: OUTLINE });
  // Outline only applies without a box: false = plain text, true = add a black outline.
  if (!out.box && look.outline === false) Object.assign(out, { outlineWidth: 0, shadow: 0, glow: 0 });
  if (!out.box && look.outline === true && !(out.outlineWidth ?? 0)) Object.assign(out, { outline: '#000000', outlineWidth: OUTLINE });
  return out;
}
