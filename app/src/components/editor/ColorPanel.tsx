import { Canvas, Circle, RadialGradient, SweepGradient, vec, type SkImage } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import Svg, { Circle as SvgCircle, Line, Path } from 'react-native-svg';
import { cleanGrade, curveFn, FILTERS, HSL_BANDS, ONE_SIDED, type AdjustKey, type Band, type Grade } from '../../lib/grade.mjs';
import { UI_FONT } from '../../lib/fonts';
import type { SavedLook } from '../../lib/store';
import { theme } from '../../lib/theme';
import { Segmented, type SymbolName } from '../ui';
import { GradedFrame } from './GradedFrame';
import { Panel } from './Panels';

export type ColorScope = 'all' | 'clip';
type Tab = 'adjust' | 'filters' | 'hsl' | 'wheels' | 'curves';

const SLIDERS: { group: string; items: { key: AdjustKey | 'auto'; label: string; icon: SymbolName }[] }[] = [
  {
    group: 'Tone',
    items: [
      { key: 'auto', label: 'Auto', icon: 'wand.and.stars' },
      { key: 'exposure', label: 'Exposure', icon: 'plusminus.circle' },
      { key: 'brightness', label: 'Brightness', icon: 'sun.max' },
      { key: 'contrast', label: 'Contrast', icon: 'circle.lefthalf.filled' },
      { key: 'light', label: 'Light', icon: 'sun.horizon' },
      { key: 'highlights', label: 'Highlights', icon: 'sun.max.circle' },
      { key: 'shadows', label: 'Shadows', icon: 'moon' },
      { key: 'whites', label: 'Whites', icon: 'circle' },
      { key: 'blacks', label: 'Blacks', icon: 'circle.fill' },
    ],
  },
  {
    group: 'Colour',
    items: [
      { key: 'brilliance', label: 'Brilliance', icon: 'sparkle' },
      { key: 'saturation', label: 'Saturation', icon: 'drop' },
      { key: 'vibrance', label: 'Vibrance', icon: 'drop.halffull' },
      { key: 'warmth', label: 'Warmth', icon: 'thermometer.medium' },
      { key: 'tint', label: 'Tint', icon: 'eyedropper' },
      { key: 'hue', label: 'Hue', icon: 'paintpalette' },
    ],
  },
  {
    group: 'Effects',
    items: [
      { key: 'fade', label: 'Fade', icon: 'cloud' },
      { key: 'sharpen', label: 'Sharpen', icon: 'triangle' },
      { key: 'clarity', label: 'Clarity', icon: 'diamond' },
      { key: 'vignette', label: 'Vignette', icon: 'circle.dashed' },
      { key: 'grain', label: 'Grain', icon: 'circle.grid.3x3' },
    ],
  },
];

const TABS: { id: Tab; label: string; icon: SymbolName }[] = [
  { id: 'adjust', label: 'Adjust', icon: 'slider.horizontal.3' },
  { id: 'filters', label: 'Filters', icon: 'camera.filters' },
  { id: 'hsl', label: 'HSL', icon: 'swatchpalette' },
  { id: 'wheels', label: 'Wheels', icon: 'circle.circle' },
  { id: 'curves', label: 'Curves', icon: 'point.topleft.down.to.point.bottomright.curvepath' },
];

/** The look copied with Copy, ready for Paste on another clip (kept while the app is open). */
let copied: Grade | undefined;

const COLOUR_NAMES = ['Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Teal', 'Cyan', 'Blue', 'Indigo', 'Purple', 'Magenta', 'Pink'];
const colourName = (angle: number) => COLOUR_NAMES[Math.round((((angle % 360) + 360) % 360) / 30) % 12];

/**
 * The Adjust tool: the clip's colour (or every clip's), in five tabs: sliders, filters, HSL (each
 * colour on its own), a tint wheel and a tone curve. Changes while a slider is dragged come through
 * `onChange(grade, true)`; `onEnd` closes the gesture (one undo step per drag).
 */
export function ColorPanel(p: {
  grade: Grade | undefined;
  scope: ColorScope;
  onScope: (s: ColorScope) => void;
  clipLabel: string;
  onClipStep?: (by: number) => void;
  onChange: (g: Grade | undefined, live?: boolean) => void;
  onEnd: () => void;
  compare: boolean;
  onCompare: () => void;
  onAuto: () => void;
  canMatch: boolean;
  onMatch: () => void;
  looks: SavedLook[];
  onSaveLook: () => void;
  frame: SkImage | null;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<Tab>('adjust');
  const [slider, setSlider] = useState<AdjustKey | 'auto'>('auto');
  const [band, setBand] = useState(HSL_BANDS[0].key);
  const g = p.grade ?? {};
  const set = (next: Grade, live = false) => p.onChange(cleanGrade(next), live);
  const setAdjust = (key: AdjustKey, v: number, live: boolean) => set({ ...g, adjust: { ...g.adjust, [key]: v } }, live);
  const changed = !!cleanGrade(p.grade);

  return (
    <Panel
      title="Adjust"
      onDone={p.onDone}
      value={
        <>
          <Pressable onPress={p.onCompare} hitSlop={8} accessibilityLabel={p.compare ? 'Hide before and after' : 'Show before and after'}>
            <SymbolView name="square.split.2x1" tintColor={p.compare ? theme.blue : theme.ink} size={17} />
          </Pressable>
          <Pressable onPress={() => set({})} disabled={!changed} hitSlop={8}>
            <Text style={[styles.reset, !changed && { color: theme.faint }]}>Reset all</Text>
          </Pressable>
        </>
      }
      footer={
        <View>
          <View style={styles.actions}>
            <Action icon="wand.and.rays" label="Match" disabled={!p.canMatch} onPress={p.onMatch} />
            <Action icon="bookmark" label="Save look" disabled={!changed} onPress={p.onSaveLook} />
            <Action
              icon="doc.on.doc"
              label="Copy"
              disabled={!changed}
              onPress={() => {
                copied = p.grade;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }}
            />
            <Action icon="doc.on.clipboard" label="Paste" disabled={!copied} onPress={() => set(copied ?? {})} />
          </View>
          <View style={styles.tabs}>
            {TABS.map((t) => (
              <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
                <SymbolView name={t.icon} tintColor={tab === t.id ? theme.blue : theme.ink} size={17} />
                <Text style={[styles.tabText, tab === t.id && { color: theme.blue }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      }
    >
      <View style={styles.body}>
        <View style={{ width: 230, alignSelf: 'center' }}>
          <Segmented value={p.scope} onChange={p.onScope} options={[{ value: 'all', label: 'All clips' }, { value: 'clip', label: 'This clip' }]} />
        </View>
        {p.scope === 'clip' && p.onClipStep && (
          <View style={styles.clipStep}>
            <Pressable onPress={() => p.onClipStep?.(-1)} hitSlop={10}>
              <SymbolView name="chevron.left" tintColor={theme.ink} size={12} weight="semibold" />
            </Pressable>
            <Text style={styles.clipLabel}>{p.clipLabel}</Text>
            <Pressable onPress={() => p.onClipStep?.(1)} hitSlop={10}>
              <SymbolView name="chevron.right" tintColor={theme.ink} size={12} weight="semibold" />
            </Pressable>
          </View>
        )}

        {tab === 'adjust' && (
          <View style={{ gap: 8 }}>
            {slider === 'auto' ? (
              <Pressable onPress={p.onAuto} style={styles.autoBtn}>
                <SymbolView name="wand.and.stars" tintColor="#fff" size={15} />
                <Text style={styles.autoText}>Auto adjust</Text>
              </Pressable>
            ) : (
              <Labelled label={SLIDERS.flatMap((s) => s.items).find((i) => i.key === slider)?.label ?? ''} value={g.adjust?.[slider] ?? 0}>
                <CenterSlider value={g.adjust?.[slider] ?? 0} oneSided={ONE_SIDED.includes(slider)} onChange={(v, live) => setAdjust(slider, v, live)} onEnd={p.onEnd} />
              </Labelled>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, paddingHorizontal: 4 }}>
              {SLIDERS.map((grp) => (
                <View key={grp.group}>
                  <Text style={styles.group}>{grp.group}</Text>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {grp.items.map((it) => {
                      const on = slider === it.key;
                      const used = it.key !== 'auto' && !!g.adjust?.[it.key];
                      return (
                        <Pressable key={it.key} onPress={() => setSlider(it.key)} style={[styles.chip, on && styles.chipOn]}>
                          <SymbolView name={it.icon} tintColor={on ? theme.blue : theme.ink} size={17} />
                          <Text style={[styles.chipText, on && { color: theme.blue }]} numberOfLines={1}>
                            {it.label}
                          </Text>
                          <View style={[styles.dot, used && { backgroundColor: theme.blue }]} />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {tab === 'filters' && (
          <View style={{ gap: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
              <FilterTile name="None" frame={p.frame} grade={undefined} on={!g.filter} onPress={() => set({ ...g, filter: undefined })} />
              {p.looks.map((l) => (
                <FilterTile key={l.id} name={l.name} frame={p.frame} grade={l.grade} on={false} onPress={() => set(l.grade)} saved />
              ))}
              {FILTERS.map((f) => (
                <FilterTile
                  key={f.id}
                  name={f.name}
                  frame={p.frame}
                  grade={{ filter: { id: f.id, strength: 100 } }}
                  on={g.filter?.id === f.id}
                  onPress={() => set({ ...g, filter: { id: f.id, strength: g.filter?.id === f.id ? g.filter.strength : 100 } })}
                />
              ))}
            </ScrollView>
            {g.filter && (
              <Labelled label="Strength" value={g.filter.strength}>
                <CenterSlider value={g.filter.strength} oneSided onChange={(v, live) => set({ ...g, filter: { id: g.filter!.id, strength: v } }, live)} onEnd={p.onEnd} />
              </Labelled>
            )}
          </View>
        )}

        {tab === 'hsl' && (
          <View style={{ gap: 2 }}>
            <View style={styles.bands}>
              {HSL_BANDS.map((b) => {
                const used = !!g.hsl?.[b.key];
                return (
                  <Pressable key={b.key} onPress={() => setBand(b.key)} hitSlop={4} accessibilityLabel={b.key}>
                    <View style={[styles.bandDot, { backgroundColor: b.color }, band === b.key && styles.bandOn]} />
                    <View style={[styles.dot, { alignSelf: 'center' }, used && { backgroundColor: theme.blue }]} />
                  </Pressable>
                );
              })}
            </View>
            {(['h', 's', 'l'] as const).map((c) => {
              const v = g.hsl?.[band]?.[c] ?? 0;
              return (
                <View key={c} style={styles.inline}>
                  <Text style={styles.inlineLabel} numberOfLines={1} adjustsFontSizeToFit>
                    {c === 'h' ? 'Hue' : c === 's' ? 'Saturation' : 'Luminance'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <CenterSlider
                      value={v}
                      onChange={(nv, live) => set({ ...g, hsl: { ...g.hsl, [band]: { ...(g.hsl?.[band] as Band), [c]: nv } } }, live)}
                      onEnd={p.onEnd}
                    />
                  </View>
                  <Text style={[styles.value, styles.inlineValue, v !== 0 && { color: theme.blue }]}>{v > 0 ? `+${v}` : v}</Text>
                </View>
              );
            })}
          </View>
        )}

        {tab === 'wheels' && (
          <View style={styles.wheelRow}>
            <ColourWheel
              angle={g.wheel?.angle ?? 0}
              amount={g.wheel?.amount ?? 0}
              onChange={(angle, amount, live) => set({ ...g, wheel: { angle, amount, brightness: g.wheel?.brightness ?? 0 } }, live)}
              onEnd={p.onEnd}
            />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={styles.between}>
                <Text style={styles.label}>Tint</Text>
                <Text style={styles.value}>{g.wheel?.amount ? `${colourName(g.wheel.angle)}, ${g.wheel.amount}` : 'None'}</Text>
              </View>
              <Labelled label="Brightness" value={g.wheel?.brightness ?? 0} compact>
                <CenterSlider
                  value={g.wheel?.brightness ?? 0}
                  onChange={(v, live) => set({ ...g, wheel: { angle: g.wheel?.angle ?? 0, amount: g.wheel?.amount ?? 0, brightness: v } }, live)}
                  onEnd={p.onEnd}
                />
              </Labelled>
              <Pressable onPress={() => set({ ...g, wheel: undefined })} disabled={!g.wheel} hitSlop={6}>
                <Text style={[styles.reset, !g.wheel && { color: theme.faint }]}>Reset wheel</Text>
              </Pressable>
            </View>
          </View>
        )}

        {tab === 'curves' && <CurveEditor points={g.curve} onChange={(curve, live) => set({ ...g, curve }, live)} onEnd={p.onEnd} />}
      </View>
    </Panel>
  );
}

function Action({ icon, label, onPress, disabled }: { icon: SymbolName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.35 }]} hitSlop={4}>
      <SymbolView name={icon} tintColor={theme.ink} size={13} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function Labelled({ label, value, children, compact }: { label: string; value: number; children: React.ReactNode; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? 0 : 2, paddingHorizontal: 4 }}>
      <View style={styles.between}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, value !== 0 && { color: theme.blue }]}>{value > 0 ? `+${value}` : value}</Text>
      </View>
      {children}
    </View>
  );
}

function FilterTile({ name, frame, grade, on, onPress, saved }: { name: string; frame: SkImage | null; grade: Grade | undefined; on: boolean; onPress: () => void; saved?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 4 }}>
      <View style={[styles.tile, on && styles.tileOn]}>
        {frame ? <GradedFrame image={frame} grade={grade} width={52} height={52} lutSize={9} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#E3E6EE' }]} />}
        {saved && (
          <View style={styles.savedBadge}>
            <SymbolView name="bookmark.fill" tintColor="#fff" size={8} />
          </View>
        )}
      </View>
      <Text style={[styles.tileText, on && { color: theme.blue }]} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

const KNOB = 24;

/**
 * A slider for −100…100 that fills from the middle (or 0…100 from the left when one-sided). It
 * snaps to 0 as it passes the middle, with a tick.
 */
function CenterSlider({ value, onChange, onEnd, oneSided }: { value: number; onChange: (v: number, live: boolean) => void; onEnd: () => void; oneSided?: boolean }) {
  const [w, setW] = useState(0);
  const min = oneSided ? 0 : -100;
  const usable = Math.max(1, w - KNOB);
  const toX = (v: number) => ((v - min) / (100 - min)) * usable;
  const fromX = (x: number) => {
    let v = Math.round(min + (Math.max(0, Math.min(usable, x - KNOB / 2)) / usable) * (100 - min));
    if (!oneSided && Math.abs(v) <= 3) v = 0;
    return v;
  };
  const move = (x: number, live: boolean) => {
    const v = fromX(x);
    if (v !== value) {
      if (v === 0 || v === 100 || v === min) Haptics.selectionAsync();
      onChange(v, live);
    }
  };
  const drag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => move(e.x, true))
    .onUpdate((e) => move(e.x, true))
    .onFinalize(() => onEnd());
  // Double-tap puts it back to 0.
  const tap = Gesture.Tap().numberOfTaps(2).runOnJS(true).onEnd(() => {
    onChange(0, false);
    onEnd();
  });
  const zeroX = toX(0);
  const x = toX(value);
  return (
    <GestureDetector gesture={Gesture.Exclusive(tap, drag)}>
      <View style={styles.sliderTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="adjustable" accessibilityValue={{ min, max: 100, now: value }}>
        <View style={[styles.sliderRail, { left: KNOB / 2, right: KNOB / 2 }]} />
        {w > 0 && <View style={[styles.sliderFill, { left: KNOB / 2 + Math.min(zeroX, x), width: Math.abs(x - zeroX) }]} />}
        {w > 0 && !oneSided && <View style={[styles.sliderZero, { left: KNOB / 2 + zeroX - 1 }]} />}
        {w > 0 && <View style={[styles.sliderKnob, { left: x }]} />}
      </View>
    </GestureDetector>
  );
}

const WHEEL = 104;

/** A tint wheel: the direction picks the colour, the distance from the middle how much. */
function ColourWheel({ angle, amount, onChange, onEnd }: { angle: number; amount: number; onChange: (angle: number, amount: number, live: boolean) => void; onEnd: () => void }) {
  const r = WHEEL / 2;
  const move = (x: number, y: number) => {
    const dx = x - r;
    const dy = y - r;
    const dist = Math.min(1, Math.hypot(dx, dy) / (r - 8));
    const a = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0° at the top, clockwise
    onChange(Math.round((a + 360) % 360), Math.round(dist * 100), true);
  };
  const drag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => move(e.x, e.y))
    .onUpdate((e) => move(e.x, e.y))
    .onFinalize(() => onEnd());
  const rad = (angle * Math.PI) / 180;
  const px = r + Math.sin(rad) * (amount / 100) * (r - 8);
  const py = r - Math.cos(rad) * (amount / 100) * (r - 8);
  return (
    <GestureDetector gesture={drag}>
      <View style={{ width: WHEEL, height: WHEEL }}>
        <Canvas style={{ width: WHEEL, height: WHEEL }}>
          <Circle cx={r} cy={r} r={r}>
            <SweepGradient c={vec(r, r)} start={-90} end={270} colors={['#FF3B3B', '#FFB13B', '#F5F53B', '#3BFF5A', '#3BF5F5', '#3B6BFF', '#B03BFF', '#FF3BB0', '#FF3B3B']} />
          </Circle>
          <Circle cx={r} cy={r} r={r}>
            <RadialGradient c={vec(r, r)} r={r} colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0)']} />
          </Circle>
        </Canvas>
        <View pointerEvents="none" style={[styles.puck, { left: px - 9, top: py - 9 }]} />
      </View>
    </GestureDetector>
  );
}

const CURVE_H = 112;

/** A tone curve: drag a point to move it, tap empty space to add one, double-tap a point to remove it. */
function CurveEditor({ points, onChange, onEnd }: { points: [number, number][] | undefined; onChange: (pts: [number, number][], live: boolean) => void; onEnd: () => void }) {
  const [w, setW] = useState(0);
  const [held, setHeld] = useState<number | null>(null);
  // The point being dragged, read inside the gesture (which can outlive a render).
  const drag0 = useSharedValue(-1);
  const pts: [number, number][] = points?.length ? points : [[0, 0], [1, 1]];
  const toXY = ([x, y]: [number, number]) => [x * w, (1 - y) * CURVE_H] as const;
  const fromXY = (x: number, y: number): [number, number] => [Math.max(0, Math.min(1, x / Math.max(1, w))), Math.max(0, Math.min(1, 1 - y / CURVE_H))];
  const nearest = (x: number, y: number) => {
    let best = -1;
    let d = 26;
    pts.forEach((p, i) => {
      const [px, py] = toXY(p);
      const dd = Math.hypot(px - x, py - y);
      if (dd < d) {
        d = dd;
        best = i;
      }
    });
    return best;
  };
  const place = (i: number, x: number, y: number) => {
    const next = pts.map((p) => [...p] as [number, number]);
    let [nx, ny] = fromXY(x, y);
    if (i === 0) nx = 0;
    else if (i === pts.length - 1) nx = 1;
    else nx = Math.max(next[i - 1][0] + 0.03, Math.min(next[i + 1][0] - 0.03, nx));
    next[i] = [nx, ny];
    onChange(next, true);
  };
  const drag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      let i = nearest(e.x, e.y);
      if (i < 0 && pts.length < 10) {
        const [nx] = fromXY(e.x, e.y);
        const next = [...pts, fromXY(e.x, e.y)].sort((a, b) => a[0] - b[0]);
        i = next.findIndex((p) => p[0] === nx);
        onChange(next, true);
        Haptics.selectionAsync();
      }
      drag0.set(i);
      setHeld(i);
    })
    .onUpdate((e) => drag0.get() >= 0 && place(drag0.get(), e.x, e.y))
    .onFinalize(() => {
      drag0.set(-1);
      setHeld(null);
      onEnd();
    });
  const remove = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd((e) => {
      const i = nearest(e.x, e.y);
      if (i > 0 && i < pts.length - 1) {
        onChange(pts.filter((_, k) => k !== i), false);
        onEnd();
      }
    });
  const f = curveFn(pts);
  const path = w
    ? Array.from({ length: 41 }, (_, k) => {
        const x = k / 40;
        return `${k ? 'L' : 'M'}${(x * w).toFixed(1)} ${((1 - Math.max(0, Math.min(1, f(x)))) * CURVE_H).toFixed(1)}`;
      }).join(' ')
    : '';
  return (
    <View style={{ paddingHorizontal: 4 }}>
      <GestureDetector gesture={Gesture.Exclusive(remove, drag)}>
        <View style={styles.curveBox} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w > 0 && (
            <Svg width={w} height={CURVE_H}>
              {[0.25, 0.5, 0.75].map((k) => (
                <Line key={`v${k}`} x1={k * w} x2={k * w} y1={0} y2={CURVE_H} stroke="rgba(17,17,20,0.08)" strokeWidth={1} />
              ))}
              {[0.25, 0.5, 0.75].map((k) => (
                <Line key={`h${k}`} x1={0} x2={w} y1={k * CURVE_H} y2={k * CURVE_H} stroke="rgba(17,17,20,0.08)" strokeWidth={1} />
              ))}
              <Line x1={0} y1={CURVE_H} x2={w} y2={0} stroke="rgba(17,17,20,0.18)" strokeWidth={1} strokeDasharray="4 4" />
              <Path d={path} stroke={theme.ink} strokeWidth={2} fill="none" />
              {pts.map((p, i) => {
                const [x, y] = toXY(p);
                return <SvgCircle key={i} cx={x} cy={y} r={held === i ? 8 : 6} fill={theme.blue} stroke="#fff" strokeWidth={2} />;
              })}
            </Svg>
          )}
        </View>
      </GestureDetector>
      <Text style={styles.curveHint}>Tap to add a point · drag to move · double-tap to remove</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 12, gap: 8, overflow: 'hidden' },
  reset: { fontSize: 13, ...UI_FONT.semibold, color: theme.blue },
  clipStep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  clipLabel: { fontSize: 12, ...UI_FONT.semibold, color: theme.ink },
  autoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, borderRadius: 12, backgroundColor: theme.blue, marginHorizontal: 4 },
  autoText: { fontSize: 14, ...UI_FONT.bold, color: '#fff' },
  group: { fontSize: 10, ...UI_FONT.semibold, color: theme.faint, marginLeft: 6, marginBottom: 2 },
  chip: { width: 58, alignItems: 'center', gap: 3, paddingVertical: 6, borderRadius: 10 },
  chipOn: { backgroundColor: theme.blueTile },
  chipText: { fontSize: 9.5, ...UI_FONT.medium, color: theme.ink },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, ...UI_FONT.semibold, color: theme.ink },
  value: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
  tile: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  tileOn: { borderColor: theme.blue },
  tileText: { fontSize: 10, ...UI_FONT.medium, color: theme.ink, maxWidth: 58 },
  savedBadge: { position: 'absolute', top: 3, right: 3, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.blue, alignItems: 'center', justifyContent: 'center' },
  // One line per slider (name, slider, value), so all three fit above the actions.
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  inlineLabel: { width: 78, fontSize: 13, ...UI_FONT.semibold, color: theme.ink },
  inlineValue: { width: 34, textAlign: 'right' },
  bands: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  bandDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  bandOn: { borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, transform: [{ scale: 1.15 }] },
  wheelRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4 },
  puck: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#fff', backgroundColor: 'rgba(17,17,20,0.25)', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  curveBox: { height: CURVE_H, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.line, overflow: 'hidden' },
  curveHint: { fontSize: 10, ...UI_FONT.medium, color: theme.faint, textAlign: 'center', marginTop: 4 },
  sliderTrack: { height: KNOB + 6, justifyContent: 'center' },
  sliderRail: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: '#E3E6EE' },
  sliderFill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: theme.blue },
  sliderZero: { position: 'absolute', width: 2, height: 10, borderRadius: 1, backgroundColor: 'rgba(17,17,20,0.25)' },
  sliderKnob: {
    position: 'absolute', width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(17,17,20,0.1)',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { fontSize: 12, ...UI_FONT.semibold, color: theme.ink },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 6, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  tab: { alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, minWidth: 58 },
  tabOn: { backgroundColor: theme.blueTile },
  tabText: { fontSize: 10, ...UI_FONT.semibold, color: theme.ink },
});
