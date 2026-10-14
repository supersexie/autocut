import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
  type LayoutChangeEvent, type LayoutRectangle,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moveClip, outDuration, type CaptionLine, type ClipEdit, type TextOverlay } from '../../lib/edit';
import { theme } from '../../lib/theme';
import { Thumb } from '../Thumb';
import { captionStyle, StyledText, TEXT_STYLES, textStyle } from './StyledText';

type PreviewProps = {
  player: VideoPlayer;
  aspect: number; // width / height of the video
  line?: CaptionLine;
  activeWord: number;
  captionStyleId: string;
  texts: TextOverlay[];
  selectedText: string | null;
  fullscreen: boolean;
  onTap: () => void;
  onTapText: (id: string) => void;
  onMoveText: (id: string, x: number, y: number) => void;
  onCloseFullscreen: () => void;
};

/** The video with live captions and text overlays, sized to the video's shape. */
export function Preview(p: PreviewProps) {
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  let fw = box.w;
  let fh = fw / p.aspect;
  if (fh > box.h) {
    fh = box.h;
    fw = fh * p.aspect;
  }
  return (
    <View style={p.fullscreen ? [StyleSheet.absoluteFill, styles.full, { paddingTop: insets.top, paddingBottom: insets.bottom }] : styles.previewWrap}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={onLayout}>
        {fw > 0 && (
          <Pressable onPress={p.onTap} style={[styles.frame, { width: fw, height: fh, borderRadius: p.fullscreen ? 0 : 16 }]}>
            <VideoView player={p.player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
            {p.line && (
              <View style={[styles.captionSpot, { bottom: fh * 0.24 }]} pointerEvents="none">
                <StyledText preset={captionStyle(p.captionStyleId)} words={p.line.words.map((w) => w.text)} active={p.activeWord} frameWidth={fw} />
              </View>
            )}
            {p.texts.map((t) => (
              <DraggableText key={t.id} text={t} frameW={fw} frameH={fh} selected={p.selectedText === t.id} onTap={() => p.onTapText(t.id)} onMove={(x, y) => p.onMoveText(t.id, x, y)} />
            ))}
          </Pressable>
        )}
      </View>
      {p.fullscreen && (
        <Pressable onPress={p.onCloseFullscreen} style={[styles.closeFull, { top: insets.top + 8 }]} hitSlop={10} accessibilityLabel="Exit full screen">
          <SymbolView name="xmark" tintColor="#fff" size={15} weight="bold" />
        </Pressable>
      )}
    </View>
  );
}

function DraggableText({ text, frameW, frameH, selected, onTap, onMove }: { text: TextOverlay; frameW: number; frameH: number; selected: boolean; onTap: () => void; onMove: (x: number, y: number) => void }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const latest = useRef({ text, frameW, frameH, onTap, onMove });
  useEffect(() => {
    latest.current = { text, frameW, frameH, onTap, onMove };
  });
  // PanResponder handlers read the latest props from a ref when a touch happens, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => setDrag({ dx: g.dx, dy: g.dy }),
      onPanResponderRelease: (_, g) => {
        const { text: t, frameW: w, frameH: h, onTap: tap, onMove: move } = latest.current;
        setDrag(null);
        if (Math.abs(g.dx) + Math.abs(g.dy) < 4) return tap();
        move(Math.min(0.95, Math.max(0.05, t.x + g.dx / w)), Math.min(0.95, Math.max(0.05, t.y + g.dy / h)));
      },
      onPanResponderTerminate: () => setDrag(null),
    })
  );
  const left = text.x * frameW - size.w / 2 + (drag?.dx ?? 0);
  const top = text.y * frameH - size.h / 2 + (drag?.dy ?? 0);
  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[styles.textItem, { left, top, opacity: size.w ? 1 : 0 }, selected && styles.textSelected, drag && { transform: [{ scale: 1.04 }] }]}
    >
      <StyledText preset={textStyle(text.style)} words={text.text.split(' ')} frameWidth={frameW} scale={text.scale} />
    </View>
  );
}

/** Typing a text overlay: the text sits on the video, styles scroll above the keyboard. */
export function TextComposer({ initial, styleId, onDone, onCancel }: { initial: string; styleId: string; onDone: (text: string, style: string) => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [value, setValue] = useState(initial);
  const [style, setStyle] = useState(styleId);
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.composer]}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, paddingTop: insets.top }}>
        <View style={styles.composerTop}>
          <Pressable onPress={onCancel} hitSlop={10}>
            <Text style={styles.composerCancel}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => (value.trim() ? onDone(value.trim(), style) : onCancel())} hitSlop={10}>
            <Text style={styles.composerDone}>Done</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
          <View>
            <StyledText preset={textStyle(style)} words={(value || 'Type something').split(' ')} frameWidth={width * 0.9} />
            <TextInput value={value} onChangeText={setValue} autoFocus multiline style={styles.hiddenInput} accessibilityLabel="Text" />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.chips}>
          {TEXT_STYLES.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                Haptics.selectionAsync();
                setStyle(s.id);
              }}
              style={[styles.styleChip, style === s.id && styles.styleChipOn]}
            >
              <StyledText preset={s} words={[s.name]} frameWidth={120} scale={0.75} numberOfLines={1} />
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

/** Hold-to-reorder: clips as tiles; drag one along the row and drop it. */
export function ReorderStrip({ clips, from, sourceUri, onDone }: { clips: ClipEdit[]; from: number; sourceUri: string; onDone: (order: ClipEdit[]) => void }) {
  const TILE_W = 64;
  const [order, setOrder] = useState(clips);
  const [active, setActive] = useState(from);
  const [dx, setDx] = useState(0);
  const latest = useRef({ order, active });
  useEffect(() => {
    latest.current = { order, active };
  });
  const startIndex = useRef(0);
  // PanResponder handlers read the latest props from a ref when a touch happens, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const i = Math.max(0, Math.min(latest.current.order.length - 1, Math.floor((e.nativeEvent.locationX - 12) / (TILE_W + 8))));
        startIndex.current = i;
        setActive(i);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      onPanResponderMove: (_, g) => setDx(g.dx),
      onPanResponderRelease: (_, g) => {
        const shift = Math.round(g.dx / (TILE_W + 8));
        const to = Math.max(0, Math.min(latest.current.order.length - 1, startIndex.current + shift));
        if (to !== startIndex.current) Haptics.selectionAsync();
        setOrder((o) => moveClip(o, startIndex.current, to));
        setActive(to);
        setDx(0);
      },
    })
  );
  return (
    <Animated.View entering={FadeInDown.duration(200)} style={styles.reorder}>
      <View style={styles.reorderHead}>
        <Text style={styles.reorderTitle}>Drag clips to reorder</Text>
        <Pressable onPress={() => onDone(order)} hitSlop={10}>
          <Text style={styles.composerDone}>Done</Text>
        </Pressable>
      </View>
      <View {...responder.panHandlers} style={styles.reorderRow}>
        {order.map((c, i) => (
          <View key={`${i}-${c.start}`} style={[styles.reorderTile, i === active && { transform: [{ translateX: dx }, { scale: 1.08 }], zIndex: 2, shadowOpacity: 0.25 }]}>
            <Thumb uri={sourceUri} seconds={c.start + (c.end - c.start) / 2} style={{ width: TILE_W, height: 84, borderRadius: 10 }} />
            <Text style={styles.reorderTime}>{outDuration(c).toFixed(1)}s</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

export type TourStep = { title: string; body: string; target?: LayoutRectangle; cta: string };

/** First-run coach marks: dims everything except the part being explained. */
export function Tour({ steps, index, onNext, onSkip }: { steps: TourStep[]; index: number; onNext: () => void; onSkip: () => void }) {
  const { width, height } = useWindowDimensions();
  const s = steps[index];
  const r = s.target ?? { x: 0, y: height / 2, width, height: 0 };
  const pad = 6;
  const hole = { x: r.x - pad, y: r.y - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  const cardAbove = hole.y > height / 2;
  const dim = 'rgba(0,0,0,0.45)';
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(0, hole.y), backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: hole.y + hole.h, bottom: 0, backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: 0, width: Math.max(0, hole.x), top: hole.y, height: hole.h, backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: hole.x + hole.w, right: 0, top: hole.y, height: hole.h, backgroundColor: dim }} />
      <View style={[styles.holeRing, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]} pointerEvents="none" />
      <Animated.View key={index} entering={ZoomIn.springify().damping(16)} style={[styles.tourCard, cardAbove ? { bottom: height - hole.y + 12 } : { top: hole.y + hole.h + 12 }]}>
        <View style={styles.between}>
          <Text style={styles.tourTitle}>{s.title}</Text>
          <Text style={styles.tourCount}>
            {index + 1}/{steps.length}
          </Text>
        </View>
        <Text style={styles.tourBody}>{s.body}</Text>
        <View style={styles.between}>
          {index < steps.length - 1 ? (
            <Pressable onPress={onSkip} hitSlop={8}>
              <Text style={styles.tourSkip}>Skip tour</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Pressable onPress={onNext} style={styles.tourBtn}>
            <Text style={styles.tourBtnText}>{s.cta}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  previewWrap: { flex: 1, paddingHorizontal: 40, paddingVertical: 6 },
  full: { backgroundColor: '#000', zIndex: 20 },
  frame: { overflow: 'hidden', backgroundColor: '#000' },
  captionSpot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  textItem: { position: 'absolute', padding: 4, borderRadius: 8, borderWidth: 1.5, borderColor: 'transparent' },
  textSelected: { borderColor: '#fff', borderStyle: 'dashed' },
  closeFull: { position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  composer: { backgroundColor: 'rgba(17,17,20,0.92)', zIndex: 30 },
  composerTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  composerCancel: { color: 'rgba(255,255,255,0.75)', fontSize: 16 },
  composerDone: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, color: 'transparent', fontSize: 1 },
  chips: { gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  styleChip: { height: 46, minWidth: 96, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#2A2A2E', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  styleChipOn: { borderColor: '#fff' },
  reorder: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10, paddingTop: 6 },
  reorderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, height: 44 },
  reorderTitle: { fontSize: 15, fontWeight: '700', color: theme.ink },
  reorderRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 14, flexWrap: 'nowrap' },
  reorderTile: { alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  reorderTime: { fontSize: 11, color: theme.muted, fontVariant: ['tabular-nums'] },
  holeRing: { position: 'absolute', borderRadius: 14, borderWidth: 2, borderColor: '#fff' },
  tourCard: { position: 'absolute', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 8, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tourTitle: { fontSize: 16, fontWeight: '700', color: theme.ink },
  tourCount: { fontSize: 12, color: theme.faint },
  tourBody: { fontSize: 14, color: theme.muted, lineHeight: 20 },
  tourSkip: { fontSize: 14, color: theme.muted, fontWeight: '500' },
  tourBtn: { backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  tourBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
