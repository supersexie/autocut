import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
  type LayoutChangeEvent, type LayoutRectangle,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moveClip, outDuration, type CaptionLine, type ClipEdit, type TextLook, type TextOverlay } from '../../lib/edit';
import { TEXT_FONTS } from '../../lib/fonts';
import type { SymbolName } from '../ui';
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
      <StyledText preset={textStyle(text.style)} look={text} words={text.text.split(' ')} frameWidth={frameW} scale={text.scale} />
    </View>
  );
}

/** What the text editor hands back: the words, the style, and any font/colour/box/align changes. */
export type TextDraft = { text: string; style: string } & TextLook;

type Tray = 'styles' | 'fonts' | 'colors';
const COLORS = ['#FFFFFF', '#111114', '#F2545B', '#FF9F1C', '#FFE14D', '#2FB463', '#58C4FF', '#7B61FF', '#FF6EF0'];

/**
 * Typing a text overlay, like CutAI: the current frame fills the screen, the text sits in the
 * middle with a cursor, and a row of styles (or fonts / colours) rides on top of the keyboard.
 */
export function TextComposer({ initial, sourceUri, seconds, onDone, onCancel }: { initial: TextDraft; sourceUri: string; seconds: number; onDone: (d: TextDraft) => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<TextDraft>(initial);
  const [tray, setTray] = useState<Tray>('styles');
  const [keyboard, setKeyboard] = useState(0);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const set = (patch: Partial<TextDraft>) => {
    Haptics.selectionAsync();
    setDraft((d) => ({ ...d, ...patch }));
  };
  const cycleAlign = () => set({ align: draft.align === 'left' ? 'right' : draft.align === 'right' ? 'center' : 'left' });
  const preset = textStyle(draft.style);
  const boxOn = draft.box ?? !!preset.box;
  const look: TextLook = { font: draft.font, color: draft.color, box: draft.box, align: draft.align };
  const TRAY_H = 62;
  const top = insets.top + 52;
  const bottom = (keyboard || insets.bottom) + TRAY_H;

  const tools: { icon: SymbolName; label: string; on?: boolean; onPress: () => void }[] = [
    { icon: 'sparkles', label: 'Styles', on: tray === 'styles', onPress: () => setTray('styles') },
    { icon: 'textformat', label: 'Font', on: tray === 'fonts', onPress: () => setTray('fonts') },
    { icon: 'paintpalette.fill', label: 'Colour', on: tray === 'colors', onPress: () => setTray('colors') },
    { icon: boxOn ? 'a.square.fill' : 'a.square', label: 'Background', onPress: () => set({ box: !boxOn }) },
    { icon: draft.align === 'left' ? 'text.alignleft' : draft.align === 'right' ? 'text.alignright' : 'text.aligncenter', label: 'Align', onPress: cycleAlign },
  ];

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.composer]}>
      <Thumb uri={sourceUri} seconds={seconds} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.18)' }]} />

      <View style={[styles.composerTop, { paddingTop: insets.top + 6 }]}>
        {tools.map((t) => (
          <Pressable key={t.label} onPress={t.onPress} hitSlop={8} accessibilityLabel={t.label} style={[styles.topTool, t.on && styles.topToolOn]}>
            <SymbolView name={t.icon} tintColor={t.on ? theme.ink : '#fff'} size={19} />
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => (draft.text.trim() ? onDone({ ...draft, text: draft.text.trim() }) : onCancel())} hitSlop={10}>
          <Text style={styles.composerDone}>Done</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => input.current?.focus()} style={[styles.composerStage, { top, bottom }]}>
        <View style={{ alignSelf: 'stretch', paddingHorizontal: 18, opacity: draft.text ? 1 : 0.55 }}>
          <StyledText preset={preset} look={look} words={(draft.text || 'Type something').split(' ')} frameWidth={width} />
        </View>
        <TextInput ref={input} value={draft.text} onChangeText={(text) => setDraft((d) => ({ ...d, text }))} autoFocus multiline style={styles.hiddenInput} accessibilityLabel="Text" />
      </Pressable>

      <View style={[styles.tray, { bottom: keyboard || insets.bottom, height: TRAY_H }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.chips}>
          {tray === 'styles' &&
            TEXT_STYLES.map((s) => (
              <Pressable key={s.id} onPress={() => set({ style: s.id, box: undefined, color: undefined, font: undefined })} style={[styles.styleChip, draft.style === s.id && styles.styleChipOn]}>
                <Thumb uri={sourceUri} seconds={seconds} style={StyleSheet.absoluteFill} />
                <StyledText preset={s} words={[s.name]} frameWidth={130} scale={0.8} numberOfLines={1} />
              </Pressable>
            ))}
          {tray === 'fonts' &&
            TEXT_FONTS.map((f) => (
              <Pressable key={f} onPress={() => set({ font: f })} style={[styles.fontChip, (draft.font ?? preset.font) === f && styles.fontChipOn]}>
                <Text style={[styles.fontChipText, { fontFamily: f }]}>Aa</Text>
              </Pressable>
            ))}
          {tray === 'colors' &&
            COLORS.map((c) => (
              <Pressable key={c} onPress={() => set({ color: c })} accessibilityLabel={`Colour ${c}`} style={[styles.swatch, { backgroundColor: c }, (draft.color ?? preset.color).toUpperCase() === c && styles.swatchOn]} />
            ))}
        </ScrollView>
      </View>
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
  composer: { backgroundColor: '#000', zIndex: 30 },
  composerTop: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 8, zIndex: 2 },
  topTool: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  topToolOn: { backgroundColor: '#fff' },
  composerDone: { color: '#fff', fontSize: 17, fontWeight: '700', paddingHorizontal: 6 },
  composerStage: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, color: 'transparent', fontSize: 1 },
  tray: { position: 'absolute', left: 0, right: 0, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  chips: { gap: 8, paddingHorizontal: 10, alignItems: 'center' },
  styleChip: { width: 96, height: 46, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: 'transparent' },
  styleChipOn: { borderColor: '#fff' },
  fontChip: { width: 52, height: 46, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: 'transparent' },
  fontChipOn: { borderColor: '#fff' },
  fontChipText: { color: '#fff', fontSize: 20 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  swatchOn: { borderColor: '#fff', borderWidth: 3.5, transform: [{ scale: 1.1 }] },
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
