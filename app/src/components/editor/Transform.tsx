import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { theme } from '../../lib/theme';

type Touch = { identifier: string; pageX: number; pageY: number };
export type Placement = { x: number; y: number; scale: number };
/** Shown over the frame while something is being moved: a line through the middle when it's on it. */
export type CentreGuide = { x: boolean; y: boolean };

const SNAP = 0.012; // of the frame
const HANDLE = 14;

const touchesOf = (e: GestureResponderEvent) => e.nativeEvent.touches as unknown as Touch[];
const tid = (t: Touch) => String(t.identifier);

type Props = {
  frameW: number;
  frameH: number;
  /** Where it sits, as fractions of the frame: x is its middle; y its middle, or its bottom edge when `bottom`. */
  x: number;
  y: number;
  scale: number;
  bottom?: boolean;
  minScale?: number;
  maxScale?: number;
  /** Widest it may get before wrapping, in points (the content wraps inside this). */
  maxWidth: number;
  selected: boolean;
  /** A finger landed on it. */
  onSelect: () => void;
  onChange: (p: Placement) => void;
  onEnd: () => void;
  onBusy: (busy: boolean) => void;
  onGuide: (g: CentreGuide | null) => void;
  /** Shows a pencil above it while selected. */
  onEdit?: () => void;
  children: ReactNode;
};

/**
 * Captions and text on the picture, like CutAI: drag to move, pinch (or pull a corner) to resize.
 * Snaps to the middle with a guide. While selected it shows a box with corner handles.
 */
export function Transformable(p: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const latest = useRef({ p, size });
  useEffect(() => {
    latest.current = { p, size };
  });
  const clampScale = (s: number) => Math.max(p.minScale ?? 0.4, Math.min(p.maxScale ?? 3, s));

  // The gesture in progress, with where it started.
  const g = useRef<
    | { mode: 'move'; id: string; start: Touch; base: Placement }
    | { mode: 'pinch'; ids: [string, string]; distance: number; mid: { x: number; y: number }; base: Placement }
    | null
  >(null);
  const snapped = useRef('');

  const begin = (touches: Touch[]) => {
    const { x, y, scale, bottom } = latest.current.p;
    const base = { x, y, scale };
    snapped.current = `${Math.abs(x - 0.5) < SNAP}${!bottom && Math.abs(y - 0.5) < SNAP}`;
    if (touches.length >= 2) {
      const [a, b] = touches;
      g.current = {
        mode: 'pinch',
        ids: [tid(a), tid(b)],
        distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
        mid: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 },
        base,
      };
    } else if (touches.length === 1) g.current = { mode: 'move', id: tid(touches[0]), start: touches[0], base };
    else g.current = null;
  };

  const place = (x: number, y: number, scale: number) => {
    const { bottom } = latest.current.p;
    // Keep at least part of it on the frame.
    x = Math.max(0.02, Math.min(0.98, x));
    y = Math.max(0.04, Math.min(bottom ? 1 : 0.96, y));
    const sx = Math.abs(x - 0.5) < SNAP;
    const sy = !bottom && Math.abs(y - 0.5) < SNAP;
    const snap = `${sx}${sy}`;
    if (snap !== snapped.current && (sx || sy)) Haptics.selectionAsync();
    snapped.current = snap;
    latest.current.p.onGuide({ x: sx, y: sy });
    latest.current.p.onChange({ x: sx ? 0.5 : x, y: sy ? 0.5 : y, scale });
  };

  const move = (touches: Touch[]) => {
    const now = g.current;
    if (!now) return;
    const { frameW: w, frameH: h } = latest.current.p;
    if (now.mode === 'move') {
      const t = touches.find((x) => tid(x) === now.id);
      if (t) place(now.base.x + (t.pageX - now.start.pageX) / w, now.base.y + (t.pageY - now.start.pageY) / h, now.base.scale);
      return;
    }
    const a = touches.find((x) => tid(x) === now.ids[0]);
    const b = touches.find((x) => tid(x) === now.ids[1]);
    if (!a || !b) return;
    const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
    const mid = { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
    const scale = clampScale(now.base.scale * (distance / Math.max(1, now.distance)));
    place(now.base.x + (mid.x - now.mid.x) / w, now.base.y + (mid.y - now.mid.y) / h, scale);
  };

  const finish = () => {
    g.current = null;
    latest.current.p.onBusy(false);
    latest.current.p.onGuide(null);
    latest.current.p.onEnd();
  };

  const responder = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      latest.current.p.onBusy(true);
      latest.current.p.onSelect();
      begin(touchesOf(e));
    },
    // A finger joined or lifted: carry on from here with the fingers still down.
    onResponderStart: (e: GestureResponderEvent) => begin(touchesOf(e)),
    onResponderEnd: (e: GestureResponderEvent) => {
      const lifted = (e.nativeEvent.changedTouches as unknown as Touch[]).map(tid);
      const left = touchesOf(e).filter((t) => !lifted.includes(tid(t)));
      if (left.length) begin(left);
    },
    onResponderMove: (e: GestureResponderEvent) => move(touchesOf(e)),
    onResponderRelease: finish,
    onResponderTerminate: finish,
  };

  const left = p.x * p.frameW - size.w / 2;
  const top = p.y * p.frameH - (p.bottom ? size.h : size.h / 2);
  return (
    <View
      {...responder}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
      }}
      style={[styles.box, { left, top, maxWidth: p.maxWidth, opacity: size.w ? 1 : 0 }]}
    >
      {p.children}
      {p.selected && (
        <>
          <View style={styles.outline} pointerEvents="none" />
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <Corner key={c} corner={c} w={size.w} h={size.h} scale={p.scale} clampScale={clampScale} onBusy={p.onBusy} onChange={(scale) => p.onChange({ x: p.x, y: p.y, scale })} onEnd={p.onEnd} />
          ))}
          {p.onEdit && (
            <Pressable onPress={p.onEdit} hitSlop={8} style={styles.edit} accessibilityLabel="Edit">
              <SymbolView name="pencil" tintColor="#fff" size={15} weight="semibold" />
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

/** A corner handle: pull it away from the middle to grow, towards it to shrink. */
function Corner({ corner, w, h, scale, clampScale, onBusy, onChange, onEnd }: {
  corner: 'tl' | 'tr' | 'bl' | 'br'; w: number; h: number; scale: number; clampScale: (s: number) => number;
  onBusy: (b: boolean) => void; onChange: (scale: number) => void; onEnd: () => void;
}) {
  const latest = useRef({ w, h, scale, onBusy, onChange, onEnd, clampScale });
  useEffect(() => {
    latest.current = { w, h, scale, onBusy, onChange, onEnd, clampScale };
  });
  const start = useRef<{ touch: Touch; base: number; dir: { x: number; y: number }; reach: number } | null>(null);
  const sx = corner.endsWith('r') ? 1 : -1;
  const sy = corner.startsWith('b') ? 1 : -1;
  const end = () => {
    start.current = null;
    latest.current.onBusy(false);
    latest.current.onEnd();
  };
  const responder = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      const { w: bw, h: bh, scale: s } = latest.current;
      latest.current.onBusy(true);
      Haptics.selectionAsync();
      const reach = Math.max(1, Math.hypot(bw / 2, bh / 2));
      start.current = { touch: touchesOf(e)[0], base: s, dir: { x: (sx * bw) / 2 / reach, y: (sy * bh) / 2 / reach }, reach };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const s = start.current;
      const t = s && touchesOf(e).find((x) => tid(x) === tid(s.touch));
      if (!s || !t) return;
      const grow = (t.pageX - s.touch.pageX) * s.dir.x + (t.pageY - s.touch.pageY) * s.dir.y;
      latest.current.onChange(latest.current.clampScale(s.base * Math.max(0.1, (s.reach + grow) / s.reach)));
    },
    onResponderRelease: end,
    onResponderTerminate: end,
  };
  return (
    <View
      {...responder}
      hitSlop={14}
      style={[styles.handle, { left: sx < 0 ? -HANDLE / 2 : undefined, right: sx > 0 ? -HANDLE / 2 : undefined, top: sy < 0 ? -HANDLE / 2 : undefined, bottom: sy > 0 ? -HANDLE / 2 : undefined }]}
    />
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', alignItems: 'center' },
  outline: { ...StyleSheet.absoluteFill, borderWidth: 1.5, borderColor: '#fff', borderRadius: 4, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: theme.ink },
  edit: { position: 'absolute', top: -46, alignSelf: 'center', width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
