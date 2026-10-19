import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../lib/theme';
import { setGoal, startSmooth, step } from '../lib/smoothProgress';
import { Thumb } from './Thumb';
import { UI_FONT } from '../lib/fonts';

const W = 176;
const H = 312;
const R = 22;
const STROKE = 4;

/** Rounded-rect outline starting at the top centre and running clockwise. */
export function outline(w: number, h: number, r: number, inset: number) {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const rr = r - inset;
  return [
    `M ${w / 2} ${y0}`,
    `L ${x1 - rr} ${y0}`,
    `A ${rr} ${rr} 0 0 1 ${x1} ${y0 + rr}`,
    `L ${x1} ${y1 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x1 - rr} ${y1}`,
    `L ${x0 + rr} ${y1}`,
    `A ${rr} ${rr} 0 0 1 ${x0} ${y1 - rr}`,
    `L ${x0} ${y0 + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x0 + rr} ${y0}`,
    `Z`,
  ].join(' ');
}

const RR = R - STROKE / 2;
const LENGTH = 2 * (W - STROKE - 2 * RR) + 2 * (H - STROKE - 2 * RR) + 2 * Math.PI * RR;
const PATH = outline(W, H, R, STROKE / 2);

/**
 * The take's thumbnail with progress running round the border. `percent` shows the percentage in
 * the middle, counting with the border; `label` shows other text there instead.
 */
export function ProgressCard({ uri, seconds = 0.5, progress, label, percent, flip }: { uri?: string; seconds?: number; progress: number; label?: string; percent?: boolean; flip?: boolean }) {
  const p = useSmooth(Math.max(0, Math.min(1, progress)));
  if (percent) label = `${Math.floor(p * 100)}%`;

  return (
    <View style={styles.wrap}>
      <Thumb uri={uri} seconds={seconds} style={styles.card} flip={flip}>
        <View style={styles.shade} />
        {label !== undefined && <Text style={styles.percent}>{label}</Text>}
      </Thumb>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={PATH} stroke="rgba(255,255,255,0.35)" strokeWidth={STROKE} fill="none" />
        <Path d={PATH} stroke={theme.ink} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeDasharray={`${LENGTH} ${LENGTH}`} strokeDashoffset={LENGTH * (1 - p)} />
      </Svg>
    </View>
  );
}

/**
 * Progress that moves smoothly between updates (see lib/smoothProgress). A card that appears
 * already finished doesn't draw its border again. Driven from JS rather than Reanimated, which
 * doesn't update animated SVG props inside a Modal (the export screen is one).
 */
function useSmooth(target: number) {
  const [value, setValue] = useState(target);
  const state = useRef(startSmooth(target));
  const drawn = useRef(target);
  useEffect(() => {
    state.current = setGoal(state.current, target, Date.now() / 1000);
  }, [target]);
  useEffect(() => {
    let frame = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      state.current = step(state.current, Math.min(0.1, (now - last) / 1000));
      last = now;
      const v = state.current.shown;
      // Redraw only when it's moved enough to see (a fraction of a pixel round the border).
      if (Math.abs(v - drawn.current) > 0.0008 || (v === 1 && drawn.current !== 1) || v < drawn.current) {
        drawn.current = v;
        setValue(v);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return value;
}

const styles = StyleSheet.create({
  wrap: { width: W, height: H, alignSelf: 'center' },
  card: { width: W, height: H, borderRadius: R, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1F' },
  shade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.22)' },
  percent: { color: '#fff', fontSize: 34, ...UI_FONT.semibold, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
});
