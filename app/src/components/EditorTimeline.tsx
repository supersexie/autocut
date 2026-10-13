import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { clipOffset } from '../lib/edit';
import type { Clip } from '../lib/store';
import { formatTime, theme } from '../lib/theme';
import { Thumb } from './Thumb';

const PX_PER_SEC = 56;
const MIN_WIDTH = 28;
const TILE = 44;

type Props = {
  clips: Clip[];
  sourceUri: string;
  selected: number;
  time: number; // edited-timeline playhead
  captions: boolean;
  onSelect: (i: number) => void;
  onToggleCaptions: () => void;
};

/** The edit as a strip of clips with filmstrip thumbnails, a playhead, and a captions track. */
export function EditorTimeline({ clips, sourceUri, selected, time, captions, onSelect, onToggleCaptions }: Props) {
  const scroll = useRef<ScrollView>(null);
  const widths = clips.map(([s, e]) => Math.max(MIN_WIDTH, (e - s) * PX_PER_SEC));
  const lefts = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b + 3, 0));
  const total = (lefts.at(-1) ?? 0) + (widths.at(-1) ?? 0);

  // Playhead x: inside the current clip, scaled to that clip's drawn width.
  let playheadX = 0;
  for (let i = 0; i < clips.length; i++) {
    const start = clipOffset(clips, i);
    const d = clips[i][1] - clips[i][0];
    if (time < start + d || i === clips.length - 1) {
      playheadX = lefts[i] + (Math.min(d, Math.max(0, time - start)) / Math.max(d, 0.001)) * widths[i];
      break;
    }
  }

  useEffect(() => {
    scroll.current?.scrollTo({ x: Math.max(0, playheadX - 140), animated: false });
  }, [playheadX]);

  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
      <View style={{ width: total + 24, gap: 8 }}>
        <View style={styles.ruler}>
          {clips.map((c, i) => (
            <Text key={`t${i}`} style={[styles.rulerText, { left: lefts[i] }]}>
              {formatTime(clipOffset(clips, i))}
            </Text>
          ))}
        </View>

        <View style={{ height: 56 }}>
          {clips.map(([s, e], i) => {
            const tiles = Math.min(4, Math.max(1, Math.ceil(widths[i] / TILE)));
            return (
              <Pressable
                key={`${i}-${s}`}
                onPress={() => onSelect(i)}
                accessibilityLabel={`Clip ${i + 1}, ${(e - s).toFixed(1)} seconds`}
                style={[styles.clip, { left: lefts[i], width: widths[i] }, i === selected && styles.clipOn]}
              >
                {Array.from({ length: tiles }, (_, k) => (
                  <Thumb key={k} uri={sourceUri} seconds={s + ((e - s) * (k + 0.5)) / tiles} style={{ flex: 1, height: '100%' }} />
                ))}
              </Pressable>
            );
          })}
          <View style={[styles.playhead, { left: playheadX - 1 }]} pointerEvents="none" />
        </View>

        <Pressable onPress={onToggleCaptions} style={[styles.track, captions ? styles.trackOn : null, { width: total }]} accessibilityRole="switch" accessibilityState={{ checked: captions }}>
          <Text style={[styles.trackText, captions && { color: theme.accent }]}>{captions ? 'Captions on · tap to remove' : '+ Add captions'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ruler: { height: 14 },
  rulerText: { position: 'absolute', fontSize: 10, color: theme.faint, fontVariant: ['tabular-nums'] },
  clip: { position: 'absolute', top: 0, height: 56, borderRadius: 8, overflow: 'hidden', flexDirection: 'row', borderWidth: 2, borderColor: 'transparent', backgroundColor: '#E4E4E8' },
  clipOn: { borderColor: theme.accent },
  playhead: { position: 'absolute', top: -6, width: 2, height: 68, borderRadius: 1, backgroundColor: theme.ink },
  track: { height: 30, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C3CAD5', justifyContent: 'center', paddingHorizontal: 10 },
  trackOn: { borderStyle: 'solid', borderColor: theme.accent, backgroundColor: theme.tint },
  trackText: { fontSize: 12, fontWeight: '600', color: theme.muted },
});
