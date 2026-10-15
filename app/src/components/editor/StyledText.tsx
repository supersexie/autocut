import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { TextLook } from '../../lib/edit';
import presets from '../../lib/styles.json';

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

export const CAPTION_STYLES = presets.captions as StylePreset[];
export const TEXT_STYLES = presets.texts as StylePreset[];
export const captionStyle = (id: string) => CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];
export const textStyle = (id: string) => TEXT_STYLES.find((s) => s.id === id) ?? TEXT_STYLES[0];

const isDark = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
};

/** The black outline added when Outline is picked: as thick as the Classic Outline style's. */
const OUTLINE = 7;

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

/** The colours offered for captions and text. */
export const COLORS = ['#FFFFFF', '#111114', '#F2545B', '#FF9F1C', '#FFE14D', '#2FB463', '#58C4FF', '#7B61FF', '#FF6EF0'];

export type Frame = 'outline' | 'box' | 'plain';

/** Which of Outline / Box / Plain a style currently shows, after the user's changes. */
export function frameOf(p: StylePreset, look?: Pick<TextLook, 'box' | 'outline'>): Frame {
  const s = withLook(p, look);
  return s.box ? 'box' : (s.outlineWidth ?? 0) > 0 ? 'outline' : 'plain';
}

/** The look fields that give a style the chosen Outline / Box / Plain frame. */
export const lookFor = (frame: Frame): Pick<TextLook, 'box' | 'outline'> =>
  frame === 'box' ? { box: true, outline: undefined } : frame === 'outline' ? { box: false, outline: true } : { box: false, outline: false };

// Same scale as the server (src/ass.js): font size is 8.5% of the video width for size 1,
// and outline/shadow widths are in that same 1080-wide space.
const FONT_SCALE = 0.085;
const ASS_FONT = 1080 * FONT_SCALE;
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

type Props = {
  preset: StylePreset;
  words: string[];
  /** Index of the word being spoken, for word-by-word styles. */
  active?: number;
  /** Width of the video frame the text sits on, in points. */
  frameWidth: number;
  scale?: number;
  style?: StyleProp<ViewStyle>;
  numberOfLines?: number;
  look?: TextLook;
};

/** Renders text the way the export will: outline, box, glow, tilt and word highlights. */
export function StyledText({ preset, words, active = -1, frameWidth, scale = 1, style, numberOfLines, look }: Props) {
  const p = withLook(preset, look);
  const align = look?.align ?? 'center';
  const fontSize = frameWidth * FONT_SCALE * p.size * scale;
  const unit = fontSize / (ASS_FONT * p.size); // one ASS pixel, in points
  const outline = (p.outlineWidth ?? 0) * unit;
  const mode = p.highlight?.mode;
  const shown = mode === 'single' ? (active >= 0 && words[active] ? [words[active]] : words.slice(0, 1)) : words;
  const text = (w: string) => (p.uppercase ? w.toUpperCase() : w);

  // Display fonts (Bangers, Shrikhand, Playfair italic…) lean and overhang their own box, so
  // leave room on every side or the edges get clipped.
  const base: TextStyle = {
    fontFamily: p.font,
    fontSize,
    lineHeight: fontSize * 1.32,
    paddingHorizontal: fontSize * 0.14,
    paddingTop: fontSize * 0.04,
    textAlign: align,
    color: p.color,
  };

  const line = (copy: 'fill' | 'outline') => (
    <Text style={[base, copy === 'outline' && { color: p.outline ?? '#000' }]} numberOfLines={numberOfLines}>
      {shown.map((w, i) => {
        const on = mode !== 'single' && i === active;
        const hl: TextStyle | undefined =
          on && mode === 'color' && copy === 'fill'
            ? { color: p.highlight?.color }
            : on && mode === 'box'
              ? { backgroundColor: p.highlight?.color, color: copy === 'fill' ? p.color : 'transparent' }
              : undefined;
        return (
          <Text key={i} style={hl}>
            {text(w)}
            {i < shown.length - 1 ? ' ' : ''}
          </Text>
        );
      })}
    </Text>
  );

  const glow: TextStyle | undefined = p.glow ? { textShadowColor: p.outline, textShadowRadius: p.glow * unit * 3, textShadowOffset: { width: 0, height: 0 } } : undefined;
  const shadow: TextStyle | undefined =
    !p.glow && p.shadow ? { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 0, textShadowOffset: { width: p.shadow * unit, height: p.shadow * unit } } : undefined;

  return (
    <View
      style={[
        { alignSelf: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', maxWidth: frameWidth * 0.88 },
        p.rotate ? { transform: [{ rotate: `${-p.rotate}deg` }] } : null,
        p.box ? { backgroundColor: p.box, paddingHorizontal: outline, paddingVertical: outline * 0.35, borderRadius: outline * 0.6 } : null,
        style,
      ]}
    >
      {!p.box && outline > 0 &&
        AROUND.map(([dx, dy]) => (
          <View key={`${dx}${dy}`} style={[StyleSheet.absoluteFill, { transform: [{ translateX: dx * outline * 0.75 }, { translateY: dy * outline * 0.75 }] }]} pointerEvents="none">
            {line('outline')}
          </View>
        ))}
      {/* Shadows and glows set on an outer Text carry through to the nested words. */}
      {glow || shadow ? <Text style={[base, glow ?? shadow]}>{line('fill')}</Text> : line('fill')}
    </View>
  );
}
