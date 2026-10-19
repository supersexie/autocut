import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard, PanResponder, Pressable, type GestureResponderEvent, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
  type LayoutChangeEvent, type LayoutRectangle,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  clampFraming, locate, moveClip, outDuration, totalDuration, type CaptionLine, type ClipEdit, type Framing, type Overlay, type TextLook, type TextOverlay,
} from '../../lib/edit';
import { TEXT_FONTS, JAKARTA } from '../../lib/fonts';
import type { SymbolName } from '../ui';
import { theme } from '../../lib/theme';
import { Thumb } from '../Thumb';
import Slider from '@react-native-community/slider';
import Svg, { Path } from 'react-native-svg';
import { OverlayItem, type OverlayGuide } from './OverlayLayer';
import { Transformable, type Placement } from './Transform';
import { captionStyle, COLORS, frameOf, lookFor, StyledText, TEXT_STYLES, textStyle, type Frame } from './StyledText';

type PreviewProps = {
  /** Two players over the same video: one plays, the other waits at the next clip (see the editor). */
  /** The player's video (see playback.tsx), sized to fill the frame. */
  video: React.ReactNode;
  /** Drawn over the video at the frame's size (the Adjust tool's coloured still), zoomed and moved with it. */
  graded?: (width: number, height: number) => React.ReactNode;
  aspect: number; // width / height of the video
  line?: CaptionLine;
  activeWord: number;
  captionStyleId: string;
  captionLook?: TextLook;
  /** Where captions sit and how big (x: middle, y: bottom edge, as fractions of the frame). */
  captionPlacement: Placement;
  /** Captions are selected: show the box with handles. */
  captionSelected: boolean;
  /** A finger landed on the caption. */
  onCaptionTouch: () => void;
  onCaptionChange: (p: Placement) => void;
  onCaptionEdit: () => void;
  texts: TextOverlay[];
  selectedText: string | null;
  fullscreen: boolean;
  onTap: () => void;
  onTextTouch: (id: string) => void;
  onTextChange: (id: string, p: Placement) => void;
  onTextEdit: (id: string) => void;
  /** A finger came off a caption or text (the end of one undoable change). */
  onPlaceEnd: () => void;
  onCloseFullscreen: () => void;
  /** How the picture is zoomed and moved right now (keyframes). */
  framing: Framing;
  /** Two fingers on the picture: returns the framing to start from (making a keyframe if needed). */
  onFrameStart: () => Framing;
  onFrame: (f: Framing) => void;
  onFrameEnd: () => void;
  /** Photos and videos over the picture at the playhead. */
  overlays: Overlay[];
  selectedOverlay: string | null;
  time: number;
  playing: boolean;
  /** A finger landed on an overlay (the undo point for whatever it does next). */
  onOverlayStart: (id: string) => void;
  onOverlayChange: (id: string, patch: Partial<Overlay>) => void;
  onOverlayEnd: () => void;
};

// Captions wrap inside the export's side margins (60 of 1080 each side, see src/ass.js).
const CAPTION_WIDTH = 1 - 120 / 1080;

const SNAP_ZOOM = 0.04; // within 4% of 100% snaps to 100%
const SNAP_CENTRE = 0.015; // within 1.5% of the middle snaps to it

/**
 * Pinch the picture with two fingers to zoom and move it, like CutAI. One finger still taps to
 * play and drags text. Zoom snaps to 100% and to the centre, with guides that show only while
 * the fingers are down.
 */
function useFramingGesture(width: number, height: number, onStart: () => Framing, onFrame: (f: Framing) => void, onEnd: () => void, blocked: () => boolean) {
  const [shown, setShown] = useState<{ scale: number; centredX: boolean; centredY: boolean } | null>(null);
  const pinch = useRef<{ ids: [string, string]; distance: number; mid: { x: number; y: number }; base: Framing } | null>(null);
  const endedAt = useRef(0);
  const misses = useRef(0);

  // Plain touch events: two fingers start a pinch and it follows those same two fingers (by id).
  // Only a finger actually lifting ends it. Move events can list just the finger that moved, so a
  // short list there means nothing; ending on it restarted the pinch every frame and it never zoomed.
  type T = { identifier: string; pageX: number; pageY: number };
  const measure = (a: T, b: T) => ({ distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), mid: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 } });
  const finish = () => {
    if (!pinch.current) return;
    pinch.current = null;
    misses.current = 0;
    endedAt.current = Date.now();
    setShown(null);
    onEnd();
  };
  const handlers = {
    onTouchMove: (e: GestureResponderEvent) => {
      const touches = e.nativeEvent.touches as unknown as T[];
      if (!pinch.current) {
        // Fingers on an overlay move and size the overlay, not the picture under it.
        if (touches.length < 2 || blocked()) return;
        const [a, b] = touches;
        pinch.current = { ids: [String(a.identifier), String(b.identifier)], ...measure(a, b), base: onStart() };
        return;
      }
      const a = touches.find((t) => String(t.identifier) === pinch.current!.ids[0]);
      const b = touches.find((t) => String(t.identifier) === pinch.current!.ids[1]);
      if (!a || !b) {
        // This event didn't carry both fingers: wait for one that does. If they stop showing up
        // altogether, the lift was missed somewhere; end rather than stay stuck.
        if (!a && !b && ++misses.current > 30) finish();
        return;
      }
      misses.current = 0;
      const now = measure(a, b);
      const { distance, mid, base } = pinch.current;
      let f = clampFraming({
        scale: base.scale * (now.distance / Math.max(1, distance)),
        x: base.x + (now.mid.x - mid.x) / width,
        y: base.y + (now.mid.y - mid.y) / height,
      });
      if (Math.abs(f.scale - 1) < SNAP_ZOOM) f = { scale: 1, x: 0, y: 0 };
      if (Math.abs(f.x) < SNAP_CENTRE) f = { ...f, x: 0 };
      if (Math.abs(f.y) < SNAP_CENTRE) f = { ...f, y: 0 };
      setShown({ scale: f.scale, centredX: f.x === 0, centredY: f.y === 0 });
      onFrame(f);
    },
    // A finger lifted: if it was one of the pinch's two, the pinch is over.
    onTouchEnd: (e: GestureResponderEvent) => {
      const ids = pinch.current?.ids;
      if (!ids) return;
      const lifted = (e.nativeEvent.changedTouches as unknown as T[]).map((t) => String(t.identifier));
      if (lifted.some((id) => ids.includes(id))) finish();
    },
    onTouchCancel: () => finish(),
  };
  // A pinch shouldn't also count as a tap on the picture (which plays or pauses).
  const justFramed = () => !!pinch.current || Date.now() - endedAt.current < 400;
  return { handlers, shown, justFramed };
}

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
  const overlayBusy = useRef(false);
  const [guide, setGuide] = useState<OverlayGuide | null>(null);
  const setBusy = (busy: boolean) => {
    overlayBusy.current = busy;
  };
  const zoom = useFramingGesture(fw, fh, p.onFrameStart, p.onFrame, p.onFrameEnd, () => overlayBusy.current);
  return (
    <View style={p.fullscreen ? [StyleSheet.absoluteFill, styles.full, { paddingTop: insets.top, paddingBottom: insets.bottom }] : styles.previewWrap}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={onLayout}>
        {fw > 0 && (
          <View {...zoom.handlers}>
          <Pressable onPress={() => !zoom.justFramed() && p.onTap()} style={[styles.frame, { width: fw, height: fh, borderRadius: p.fullscreen ? 0 : 16 }]}>
            {/* Only the picture zooms and moves; captions and text stay where they are. */}
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { transform: [{ translateX: p.framing.x * fw }, { translateY: p.framing.y * fh }, { scale: p.framing.scale }] }]}
            >
              {p.video}
              {p.graded?.(fw, fh)}
            </View>
            {p.overlays.map((o) => (
              <OverlayItem
                key={o.id}
                overlay={o}
                frameW={fw}
                frameH={fh}
                selected={p.selectedOverlay === o.id}
                time={p.time}
                playing={p.playing}
                onBusy={setBusy}
                onGuide={setGuide}
                onSelect={() => p.onOverlayStart(o.id)}
                onChange={(patch) => p.onOverlayChange(o.id, patch)}
                onEnd={p.onOverlayEnd}
              />
            ))}
            {p.line && (
              <Transformable
                frameW={fw}
                frameH={fh}
                {...p.captionPlacement}
                bottom
                maxWidth={fw * CAPTION_WIDTH}
                selected={p.captionSelected}
                onSelect={p.onCaptionTouch}
                onChange={p.onCaptionChange}
                onEnd={p.onPlaceEnd}
                onBusy={setBusy}
                onGuide={setGuide}
                onEdit={p.onCaptionEdit}
              >
                <StyledText
                  preset={captionStyle(p.captionStyleId)}
                  look={p.captionLook}
                  words={p.line.words.map((w) => w.text)}
                  active={p.activeWord}
                  frameWidth={fw}
                  scale={p.captionPlacement.scale}
                />
              </Transformable>
            )}
            {p.texts.map((t) => (
              <Transformable
                key={t.id}
                frameW={fw}
                frameH={fh}
                x={t.x}
                y={t.y}
                scale={t.scale}
                maxWidth={fw * 0.94}
                selected={p.selectedText === t.id}
                onSelect={() => p.onTextTouch(t.id)}
                onChange={(placement) => p.onTextChange(t.id, placement)}
                onEnd={p.onPlaceEnd}
                onBusy={setBusy}
                onGuide={setGuide}
                onEdit={() => p.onTextEdit(t.id)}
              >
                <StyledText preset={textStyle(t.style)} look={t} words={t.text.split(' ')} frameWidth={fw} scale={t.scale} />
              </Transformable>
            ))}
            {guide && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {guide.x && <View style={styles.guideV} />}
                {guide.y && <View style={styles.guideH} />}
                {guide.turn !== undefined && (
                  <View style={styles.zoomBadge}>
                    <Text style={styles.zoomText}>{Math.round(guide.turn)}°</Text>
                  </View>
                )}
              </View>
            )}
            {zoom.shown && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={[styles.framing, { borderRadius: p.fullscreen ? 0 : 16 }]} />
                {zoom.shown.centredX && <View style={styles.guideV} />}
                {zoom.shown.centredY && <View style={styles.guideH} />}
                <View style={styles.zoomBadge}>
                  <Text style={styles.zoomText}>{Math.round(zoom.shown.scale * 100)}%</Text>
                </View>
              </View>
            )}
          </Pressable>
          </View>
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

/** What the text editor hands back: the words, the style, and any font/colour/box/align changes. */
export type TextDraft = { text: string; style: string; scale?: number } & TextLook;

type Tray = 'styles' | 'fonts' | 'colors';

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
  const frame = frameOf(preset, draft);
  const look: TextLook = { font: draft.font, color: draft.color, box: draft.box, outline: draft.outline, align: draft.align };
  const [flash, setFlash] = useState<string | null>(null);
  const nextFrame = () => {
    const next: Frame = frame === 'outline' ? 'box' : frame === 'box' ? 'plain' : 'outline';
    set(lookFor(next));
    setFlash(next === 'outline' ? 'Outline' : next === 'box' ? 'Background' : 'No outline');
  };
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);
  const TRAY_H = 62;
  const top = insets.top + 52;
  const bottom = (keyboard || insets.bottom) + TRAY_H;

  const tools: { icon: SymbolName; label: string; on?: boolean; onPress: () => void }[] = [
    { icon: 'sparkles', label: 'Styles', on: tray === 'styles', onPress: () => setTray('styles') },
    { icon: 'textformat', label: 'Font', on: tray === 'fonts', onPress: () => setTray('fonts') },
    { icon: 'paintpalette.fill', label: 'Colour', on: tray === 'colors', onPress: () => setTray('colors') },
    { icon: frame === 'box' ? 'a.square.fill' : frame === 'outline' ? 'a.square' : 'textformat', label: 'Outline, background or plain', onPress: nextFrame },
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
          <StyledText preset={preset} look={look} words={(draft.text || 'Type something').split(' ')} frameWidth={width} scale={draft.scale ?? 1} />
        </View>
        <TextInput ref={input} value={draft.text} onChangeText={(text) => setDraft((d) => ({ ...d, text }))} autoFocus multiline style={styles.hiddenInput} accessibilityLabel="Text" />
      </Pressable>

      <View style={[styles.sizeRail, { top: top + 20, bottom: bottom + 20 }]} pointerEvents="box-none">
        <View style={styles.sizeSlider}>
          <Slider
            style={{ width: 200 }}
            minimumValue={0.5}
            maximumValue={2.5}
            value={draft.scale ?? 1}
            onValueChange={(scale) => setDraft((d) => ({ ...d, scale: Math.round(scale * 100) / 100 }))}
            minimumTrackTintColor="#fff"
            maximumTrackTintColor="rgba(255,255,255,0.35)"
            accessibilityLabel="Text size"
          />
        </View>
      </View>
      {flash && (
        <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(200)} style={[styles.flash, { top: top + 6 }]} pointerEvents="none">
          <Text style={styles.flashText}>{flash}</Text>
        </Animated.View>
      )}

      <View style={[styles.tray, { bottom: keyboard || insets.bottom, height: TRAY_H }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.chips}>
          {tray === 'styles' &&
            TEXT_STYLES.map((s) => (
              <Pressable key={s.id} onPress={() => set({ style: s.id, box: undefined, outline: undefined, color: undefined, font: undefined })} style={[styles.styleChip, draft.style === s.id && styles.styleChipOn]}>
                <Thumb uri={sourceUri} seconds={seconds} style={StyleSheet.absoluteFill} />
                <StyledText preset={s} words={[s.name]} frameWidth={110} scale={0.72} />
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
  const { width: screenW } = useWindowDimensions();
  const TILE_W = Math.max(28, Math.min(64, (screenW - 24) / Math.max(1, clips.length) - 8));
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
            <Thumb uri={sourceUri} seconds={c.start + (c.end - c.start) / 2} style={{ width: TILE_W, height: TILE_W * 1.3, borderRadius: 8 }} />
            <Text style={styles.reorderTime}>{outDuration(c).toFixed(1)}s</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const COVER_TILES = 8;

/**
 * Pick the cover: drag along the strip of frames and the big preview follows. The chosen frame
 * goes first in the export, so it's what TikTok and Instagram show before the video plays.
 */
export function CoverPicker({ clips, sourceUri, value, onDone, onCancel }: { clips: ClipEdit[]; sourceUri: string; value: number; onDone: (t: number) => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const total = totalDuration(clips);
  const [t, setT] = useState(Math.min(value, total));
  const [width, setWidth] = useState(0);
  // Frames on a quarter-second grid, so dragging reuses the ones it has already made.
  const source = (time: number) => Math.round(locate(clips, Math.min(time, total - 0.01))[1] * 4) / 4;
  const latest = useRef({ width, total });
  useEffect(() => {
    latest.current = { width, total };
  });
  // PanResponder handlers read the latest values from a ref when a touch happens, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const at = (x: number) => {
      const { width: w, total: d } = latest.current;
      return w ? Math.max(0, Math.min(d, (x / w) * d)) : 0;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setT(at(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => setT(at(e.nativeEvent.locationX)),
      onPanResponderRelease: () => Haptics.selectionAsync(),
    });
  });
  const handleW = 34;
  const left = width && total ? Math.max(0, Math.min(width - handleW, (t / total) * width - handleW / 2)) : 0;

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.coverScreen, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.coverHead}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={styles.coverCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.coverTitle}>Cover</Text>
        <Pressable onPress={() => onDone(t)} hitSlop={10}>
          <Text style={styles.coverSave}>Save</Text>
        </Pressable>
      </View>
      <View style={styles.coverStage}>
        <Thumb uri={sourceUri} seconds={source(t)} style={styles.coverFrame} />
      </View>
      <Text style={styles.coverHint}>This frame shows first, so it’s the cover on TikTok and Instagram.</Text>
      <View style={styles.coverStrip} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
        <View style={styles.coverTiles} pointerEvents="none">
          {Array.from({ length: COVER_TILES }, (_, k) => (
            <Thumb key={k} uri={sourceUri} seconds={source(((k + 0.5) / COVER_TILES) * total)} style={{ flex: 1, height: '100%' }} />
          ))}
        </View>
        <View style={[styles.coverHandle, { left, width: handleW }]} pointerEvents="none">
          <Thumb uri={sourceUri} seconds={source(t)} style={StyleSheet.absoluteFill} />
        </View>
      </View>
    </Animated.View>
  );
}

/** `round`: the spotlight is a circle (for round buttons) instead of a rounded square. */
/** `accent`: the word (or words) of the title shown in blue. */
export type TourStep = { title: string; accent?: string; body: string; target?: LayoutRectangle; cta: string; round?: boolean };

const roundedRect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

/** First-run coach marks: dims everything except the part being explained. */
export function Tour({ steps, index, onNext, onSkip }: { steps: TourStep[]; index: number; onNext: () => void; onSkip: () => void }) {
  const { width, height } = useWindowDimensions();
  const s = steps[index];
  const r = s.target ?? { x: 0, y: height / 2, width, height: 0 };
  const pad = s.round ? 8 : 6;
  let hole = { x: r.x - pad, y: r.y - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  if (s.round) {
    const d = Math.max(hole.w, hole.h);
    hole = { x: hole.x + (hole.w - d) / 2, y: hole.y + (hole.h - d) / 2, w: d, h: d };
  }
  const radius = s.round ? hole.w / 2 : Math.min(14, hole.h / 2);
  const cardAbove = hole.y > height / 2;
  const dim = 'rgba(0,0,0,0.45)';
  // A phone-width card, as close above or below its target as it fits (centred on it where it can).
  const cardW = Math.min(440, width - 32);
  const cardLeft = Math.max(16, Math.min(width - 16 - cardW, hole.x + hole.w / 2 - cardW / 2));
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
      {/* Everything dimmed but a cut-out the shape of the thing being explained. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path fill={dim} fillRule="evenodd" d={`M0 0H${width}V${height}H0Z ${roundedRect(hole.x, hole.y, hole.w, hole.h, radius)}`} />
      </Svg>
      <View style={[styles.holeRing, { left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: radius }]} pointerEvents="none" />
      <Animated.View key={index} entering={FadeIn.duration(220)} style={[styles.tourCard, { left: cardLeft, width: cardW }, cardAbove ? { bottom: height - hole.y + 12 } : { top: hole.y + hole.h + 12 }]}>
        <View style={styles.between}>
          <Text style={styles.tourTitle}>
            {s.accent && s.title.includes(s.accent) ? (
              <>
                {s.title.slice(0, s.title.indexOf(s.accent))}
                <Text style={{ color: theme.blue }}>{s.accent}</Text>
                {s.title.slice(s.title.indexOf(s.accent) + s.accent.length)}
              </>
            ) : (
              s.title
            )}
          </Text>
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
  composerDone: { color: '#fff', fontSize: 17, fontFamily: JAKARTA.bold, paddingHorizontal: 6 },
  composerStage: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, color: 'transparent', fontSize: 1, fontFamily: JAKARTA.medium },
  sizeRail: { position: 'absolute', left: 0, width: 44, alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  sizeSlider: { width: 200, transform: [{ rotate: '-90deg' }] },
  flash: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, zIndex: 4 },
  flashText: { color: '#fff', fontSize: 13, fontFamily: JAKARTA.semibold },
  tray: { position: 'absolute', left: 0, right: 0, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  chips: { gap: 8, paddingHorizontal: 10, alignItems: 'center' },
  styleChip: { width: 96, height: 46, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: 'transparent' },
  styleChipOn: { borderColor: '#fff' },
  fontChip: { width: 52, height: 46, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: 'transparent' },
  fontChipOn: { borderColor: '#fff' },
  fontChipText: { color: '#fff', fontSize: 20, fontFamily: JAKARTA.medium },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  swatchOn: { borderColor: '#fff', borderWidth: 3.5, transform: [{ scale: 1.1 }] },
  reorder: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10, paddingTop: 6 },
  reorderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, height: 44 },
  reorderTitle: { fontSize: 15, fontFamily: JAKARTA.bold, color: theme.ink },
  reorderRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 14, flexWrap: 'nowrap' },
  reorderTile: { alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  reorderTime: { fontSize: 11, fontFamily: JAKARTA.medium, color: theme.muted, fontVariant: ['tabular-nums'] },
  coverScreen: { backgroundColor: '#fff', zIndex: 30, paddingHorizontal: 20 },
  coverHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 44 },
  coverCancel: { fontSize: 16, fontFamily: JAKARTA.medium, color: theme.muted },
  coverTitle: { fontSize: 17, fontFamily: JAKARTA.bold, color: theme.ink },
  coverSave: { fontSize: 16, fontFamily: JAKARTA.bold, color: theme.ink },
  coverStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  coverFrame: { height: '100%', aspectRatio: 9 / 16, borderRadius: 18 },
  coverHint: { fontSize: 13, fontFamily: JAKARTA.medium, color: theme.muted, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  coverStrip: { height: 64, borderRadius: 12, overflow: 'visible' },
  coverTiles: { flex: 1, flexDirection: 'row', borderRadius: 12, overflow: 'hidden', opacity: 0.55 },
  coverHandle: { position: 'absolute', top: -6, bottom: -6, borderRadius: 9, borderWidth: 3, borderColor: theme.blue, overflow: 'hidden', backgroundColor: theme.card },
  framing: { ...StyleSheet.absoluteFill, borderWidth: 2, borderColor: '#fff' },
  guideV: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, marginLeft: -0.5, backgroundColor: 'rgba(255,255,255,0.85)' },
  guideH: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, marginTop: -0.5, backgroundColor: 'rgba(255,255,255,0.85)' },
  zoomBadge: { position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  zoomText: { color: '#fff', fontSize: 13, fontFamily: JAKARTA.bold, fontVariant: ['tabular-nums'] },
  holeRing: { position: 'absolute', borderRadius: 14, borderWidth: 2, borderColor: '#9DB3FF' },
  tourCard: { position: 'absolute', backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 8, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tourTitle: { fontSize: 16, fontFamily: JAKARTA.bold, color: theme.ink },
  tourCount: { fontSize: 12, fontFamily: JAKARTA.semibold, color: theme.blue },
  tourBody: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted, lineHeight: 20 },
  tourSkip: { fontSize: 14, color: theme.muted, fontFamily: JAKARTA.medium },
  tourBtn: { backgroundColor: theme.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  tourBtnText: { color: '#fff', fontSize: 14, fontFamily: JAKARTA.bold },
});
