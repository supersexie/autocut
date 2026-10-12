import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { Cut, Segment } from '../lib/store';
import { theme } from '../lib/theme';

type Props = {
  duration: number;
  cuts: Cut[];
  /** When given, kept speech is drawn in blue over a dim track (finished cut). */
  segments?: Segment[];
  playhead?: number;
};

/** The raw take's timeline: cuts in red, kept speech in blue, white playhead. */
export function Timeline({ duration, cuts, segments, playhead }: Props) {
  const pct = (t: number) => `${(Math.max(0, Math.min(t, duration)) / Math.max(duration, 0.001)) * 100}%` as const;
  return (
    <View style={styles.wrap}>
      <View style={[styles.track, { backgroundColor: segments ? 'rgba(255,255,255,0.22)' : 'rgba(61,133,245,0.85)' }]}>
        {segments?.map((s, i) => (
          <View key={`s${i}`} style={[styles.seg, { left: pct(s.start), width: pct(s.end - s.start) }]} />
        ))}
        {cuts.map((c, i) => (
          <CutMark key={`c${i}`} left={pct(c.start)} width={pct(c.end - c.start)} faded={!!segments} animate={!segments} />
        ))}
      </View>
      {playhead != null && <View style={[styles.playhead, { left: pct(playhead) }]} />}
    </View>
  );
}

function CutMark({ left, width, faded, animate }: { left: `${number}%`; width: `${number}%`; faded: boolean; animate: boolean }) {
  const [scale] = useState(() => new Animated.Value(animate ? 0.1 : 1));
  useEffect(() => {
    if (animate) Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 12 }).start();
  }, [animate, scale]);
  return (
    <Animated.View
      style={[styles.cut, { left, width, opacity: faded ? 0.5 : 0.9, transform: [{ scaleX: scale }] }]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { height: 20, justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  seg: { position: 'absolute', top: 0, bottom: 0, backgroundColor: theme.accent, borderRadius: 3 },
  cut: { position: 'absolute', top: 0, bottom: 0, minWidth: 2, backgroundColor: theme.cut },
  playhead: {
    position: 'absolute', top: 1, width: 3, height: 18, marginLeft: -1.5, borderRadius: 2, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 2, shadowOffset: { width: 0, height: 0 },
  },
});
