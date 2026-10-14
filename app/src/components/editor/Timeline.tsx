import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { clipOffset, outDuration, type CaptionLine, type ClipEdit, type TextOverlay } from '../../lib/edit';
import { theme } from '../../lib/theme';
import { Thumb } from '../Thumb';

export const PPS = 56; // points per second of output
const CLIP_H = 58;
const ROW_H = 30;
const LEFT = 64;
const TILE = 46;

type Props = {
  clips: ClipEdit[];
  sourceUri: string;
  sourceDuration: number;
  time: number;
  selected: number;
  muted: boolean;
  captionsOn: boolean;
  lines: CaptionLine[];
  texts: TextOverlay[];
  selectedText: string | null;
  onScrubStart: () => void;
  onScrub: (t: number) => void;
  onSelectClip: (i: number) => void;
  onTrim: (i: number, edges: { start?: number; end?: number }) => void;
  onReorderStart: (i: number) => void;
  onToggleMute: () => void;
  onCaptions: (line?: CaptionLine) => void;
  onSelectText: (id: string) => void;
  onAddText: () => void;
};

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** CapCut-style timeline: the playhead stays centred and the strip scrolls under it. */
export function Timeline(p: Props) {
  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [trim, setTrim] = useState<{ i: number; start: number; end: number } | null>(null);

  const clips = trim ? p.clips.map((c, k) => (k === trim.i ? { ...c, start: trim.start, end: trim.end } : c)) : p.clips;
  const total = clips.reduce((t, c) => t + outDuration(c), 0);
  const x = (t: number) => t * PPS;

  // Follow playback (and programmatic seeks) unless the user is dragging the strip.
  useEffect(() => {
    if (!dragging.current) scroll.current?.scrollTo({ x: x(p.time), animated: false });
  }, [p.time]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const seconds = Array.from({ length: Math.floor(total) + 1 }, (_, i) => i);

  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        <View style={{ height: 22 }} />
        <Pressable onPress={p.onToggleMute} style={[styles.leftRow, { height: CLIP_H }]} accessibilityLabel={p.muted ? 'Unmute clip audio' : 'Mute clip audio'}>
          <SymbolView name={p.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} tintColor={theme.ink} size={16} />
          <Text style={styles.leftLabel}>{p.muted ? 'Unmute' : 'Mute clip\naudio'}</Text>
        </Pressable>
        <View style={[styles.leftRow, { height: ROW_H }]}>
          <SymbolView name="captions.bubble" tintColor={theme.muted} size={15} />
        </View>
        <View style={[styles.leftRow, { height: ROW_H }]}>
          <SymbolView name="textformat" tintColor={theme.muted} size={15} />
        </View>
      </View>

      <View style={{ flex: 1 }} onLayout={onLayout}>
        {width > 0 && (
          <ScrollView
            ref={scroll}
            horizontal
            scrollEnabled={scrollEnabled}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: width / 2 }}
            onScrollBeginDrag={() => {
              dragging.current = true;
              p.onScrubStart();
            }}
            onScroll={(e) => dragging.current && p.onScrub(Math.max(0, Math.min(total, e.nativeEvent.contentOffset.x / PPS)))}
            onScrollEndDrag={(e) => {
              if (!e.nativeEvent.velocity?.x) dragging.current = false;
            }}
            onMomentumScrollEnd={() => {
              dragging.current = false;
            }}
          >
            <View style={{ width: x(total) }}>
              <View style={styles.ruler}>
                {seconds.map((s) => (
                  <View key={s} style={[styles.tick, { left: x(s) }]}>
                    <Text style={styles.tickText}>{mmss(s)}</Text>
                  </View>
                ))}
              </View>

              <View style={{ height: CLIP_H }}>
                {clips.map((c, i) => {
                  const left = x(clipOffset(clips, i));
                  const w = Math.max(8, x(outDuration(c)) - 2);
                  const tiles = Math.max(1, Math.min(8, Math.ceil(w / TILE)));
                  const on = i === p.selected;
                  return (
                    <Pressable
                      key={`${i}-${c.start}`}
                      onPress={() => p.onSelectClip(i)}
                      onLongPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        p.onReorderStart(i);
                      }}
                      delayLongPress={350}
                      style={[styles.clip, { left, width: w }, on && styles.clipOn]}
                    >
                      <View style={styles.tiles}>
                        {Array.from({ length: tiles }, (_, k) => (
                          <Thumb key={k} uri={p.sourceUri} seconds={c.start + ((c.end - c.start) * (k + 0.5)) / tiles} style={{ flex: 1, height: '100%' }} />
                        ))}
                      </View>
                      {c.speed !== 1 && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{c.speed}x</Text>
                        </View>
                      )}
                      {on && (
                        <>
                          <TrimHandle
                            side="start"
                            clip={p.clips[i]}
                            onBegin={() => setScrollEnabled(false)}
                            onMove={(start) => setTrim({ i, start, end: p.clips[i].end })}
                            onEnd={(start) => {
                              setTrim(null);
                              setScrollEnabled(true);
                              p.onTrim(i, { start });
                            }}
                            sourceDuration={p.sourceDuration}
                          />
                          <TrimHandle
                            side="end"
                            clip={p.clips[i]}
                            onBegin={() => setScrollEnabled(false)}
                            onMove={(end) => setTrim({ i, start: p.clips[i].start, end })}
                            onEnd={(end) => {
                              setTrim(null);
                              setScrollEnabled(true);
                              p.onTrim(i, { end });
                            }}
                            sourceDuration={p.sourceDuration}
                          />
                        </>
                      )}
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.row}>
                {p.captionsOn ? (
                  p.lines.map((l) => (
                    <Pressable key={`${l.key}-${l.start}`} onPress={() => p.onCaptions(l)} style={[styles.chip, { left: x(l.start), width: Math.max(14, x(l.end - l.start) - 2) }]}>
                      <Text style={styles.chipText} numberOfLines={1}>
                        {l.text}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Pressable onPress={() => p.onCaptions()} style={[styles.add, { left: x(p.time) }]}>
                    <Text style={styles.addText}>+ Add captions</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.row}>
                {p.texts.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => p.onSelectText(t.id)}
                    style={[styles.chip, styles.textChip, { left: x(t.start), width: Math.max(14, x(t.end - t.start) - 2) }, p.selectedText === t.id && styles.textChipOn]}
                  >
                    <Text style={[styles.chipText, { color: theme.ink }]} numberOfLines={1}>
                      {t.text}
                    </Text>
                  </Pressable>
                ))}
                {!p.texts.some((t) => p.time >= t.start && p.time < t.end) && (
                  <Pressable onPress={p.onAddText} style={[styles.add, { left: x(p.time) }]}>
                    <Text style={styles.addText}>+ Add text</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </ScrollView>
        )}
        <View style={[styles.playhead, { left: width / 2 - 1 }]} pointerEvents="none" />
      </View>
    </View>
  );
}

/** Drag a clip's edge to trim it. Movement is in output points, converted to source seconds. */
function TrimHandle({ side, clip, onBegin, onMove, onEnd, sourceDuration }: { side: 'start' | 'end'; clip: ClipEdit; onBegin: () => void; onMove: (v: number) => void; onEnd: (v: number) => void; sourceDuration: number }) {
  const latest = useRef({ clip, onBegin, onMove, onEnd, sourceDuration });
  useEffect(() => {
    latest.current = { clip, onBegin, onMove, onEnd, sourceDuration };
  });
  const value = useRef(0);
  // PanResponder handlers read the latest props from a ref when a touch happens, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const { clip: c, onBegin: begin } = latest.current;
        value.current = side === 'start' ? c.start : c.end;
        Haptics.selectionAsync();
        begin();
      },
      onPanResponderMove: (_, g) => {
        const { clip: c, onMove: move, sourceDuration: max } = latest.current;
        const delta = (g.dx / PPS) * c.speed;
        value.current = side === 'start' ? Math.max(0, Math.min(c.end - 0.1, c.start + delta)) : Math.min(max, Math.max(c.start + 0.1, c.end + delta));
        move(value.current);
      },
      onPanResponderRelease: () => latest.current.onEnd(value.current),
      onPanResponderTerminate: () => latest.current.onEnd(value.current),
    })
  );
  return (
    <View {...responder.panHandlers} hitSlop={{ left: 12, right: 12, top: 6, bottom: 6 }} style={[styles.handle, side === 'start' ? { left: 0 } : { right: 0 }]}>
      <View style={styles.grip} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', paddingVertical: 6 },
  left: { width: LEFT, alignItems: 'center' },
  leftRow: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  leftLabel: { fontSize: 9, color: theme.muted, textAlign: 'center', lineHeight: 11 },
  ruler: { height: 22 },
  tick: { position: 'absolute', top: 4 },
  tickText: { fontSize: 9, color: theme.faint, fontVariant: ['tabular-nums'], marginLeft: -12 },
  clip: { position: 'absolute', top: 0, height: CLIP_H, borderRadius: 10, overflow: 'hidden', backgroundColor: '#E4E4E8', borderWidth: 2, borderColor: 'transparent' },
  clipOn: { borderColor: theme.ink },
  tiles: { flex: 1, flexDirection: 'row' },
  badge: { position: 'absolute', top: 4, left: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 14, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: '#fff' },
  row: { height: ROW_H, marginTop: 6 },
  chip: { position: 'absolute', top: 2, height: ROW_H - 4, borderRadius: 7, backgroundColor: theme.ink, justifyContent: 'center', paddingHorizontal: 6 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  textChip: { backgroundColor: '#E4E4E8' },
  textChipOn: { borderWidth: 2, borderColor: theme.ink },
  add: { position: 'absolute', top: 2, height: ROW_H - 4, borderRadius: 7, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C7C7CC', justifyContent: 'center', paddingHorizontal: 10 },
  addText: { fontSize: 11, fontWeight: '600', color: theme.muted },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, borderRadius: 1, backgroundColor: theme.ink },
});
