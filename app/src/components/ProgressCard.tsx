import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../lib/theme';
import { Thumb } from './Thumb';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const W = 176;
const H = 312;
const R = 22;
const STROKE = 4;

/** Rounded-rect outline starting at the top centre and running clockwise. */
function outline(w: number, h: number, r: number, inset: number) {
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

/** The take's thumbnail with the percentage in the middle and progress running round the border. */
export function ProgressCard({ uri, seconds = 0.5, progress, label }: { uri?: string; seconds?: number; progress: number; label?: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [progress, p]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: LENGTH * (1 - p.value) }));

  return (
    <View style={styles.wrap}>
      <Thumb uri={uri} seconds={seconds} style={styles.card}>
        <View style={styles.shade} />
        {label !== undefined && <Text style={styles.percent}>{label}</Text>}
      </Thumb>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={PATH} stroke="rgba(255,255,255,0.35)" strokeWidth={STROKE} fill="none" />
        <AnimatedPath d={PATH} stroke={theme.ink} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeDasharray={`${LENGTH} ${LENGTH}`} animatedProps={animatedProps} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: W, height: H, alignSelf: 'center' },
  card: { width: W, height: H, borderRadius: R, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1F' },
  shade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.22)' },
  percent: { color: '#fff', fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
});
