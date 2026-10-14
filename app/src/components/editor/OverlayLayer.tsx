import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';
import { Image, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import type { Overlay } from '../../lib/edit';
import { cutFile } from '../../lib/store';
import { theme } from '../../lib/theme';

type Touch = { identifier: string; pageX: number; pageY: number };
type Patch = Partial<Pick<Overlay, 'x' | 'y' | 'width' | 'rotation'>>;
/** What to show over the frame while an overlay is being moved: centre lines, and its angle while turning. */
export type OverlayGuide = { x: boolean; y: boolean; turn?: number };

const SNAP_CENTRE = 0.012; // of the frame
const SNAP_TURN = 4; // degrees either side of straight
const HANDLE = 18;

const touchesOf = (e: GestureResponderEvent) => e.nativeEvent.touches as unknown as Touch[];
const id = (t: Touch) => String(t.identifier);

/** Rotation snapped to the nearest quarter turn when it's within a few degrees of it. */
function snapTurn(raw: number) {
  // Kept between -180° and 180°, so a twist past half a turn reads -6°, not 354°.
  const deg = ((((raw + 180) % 360) + 360) % 360) - 180;
  const straight = Math.round(deg / 90) * 90;
  return Math.abs(deg - straight) < SNAP_TURN ? straight : deg;
}

type Props = {
  overlay: Overlay;
  frameW: number;
  frameH: number;
  selected: boolean;
  time: number;
  playing: boolean;
  /** Told when a finger lands on and leaves an overlay, so the picture's own pinch-zoom stays out of it. */
  onBusy: (busy: boolean) => void;
  onGuide: (guide: OverlayGuide | null) => void;
  onSelect: () => void;
  onChange: (patch: Patch) => void;
  onEnd: () => void;
};

/**
 * A photo or video over the picture. One finger moves it, two fingers resize and turn it, and the
 * corner handles resize it. It snaps to the middle and to straight, with guides while you move it.
 */
export function OverlayItem({ overlay: o, frameW, frameH, selected, time, playing, onBusy, onGuide, onSelect, onChange, onEnd }: Props) {
  const pw = o.width * frameW;
  const ph = (pw * o.h) / o.w;
  const latest = useRef({ o, frameW, frameH, pw, ph, onChange, onEnd, onSelect, onBusy, onGuide });
  useEffect(() => {
    latest.current = { o, frameW, frameH, pw, ph, onChange, onEnd, onSelect, onBusy, onGuide };
  });

  // The gesture in progress: which fingers, where they started, and the overlay as it was then.
  const g = useRef<
    | { mode: 'move'; ids: [string]; start: Touch; base: Overlay }
    | { mode: 'twist'; ids: [string, string]; distance: number; angle: number; mid: { x: number; y: number }; base: Overlay }
    | null
  >(null);

  const snapped = useRef('');
  const begin = (touches: Touch[]) => {
    const base = latest.current.o;
    // Where it already sits counts as snapped, so it doesn't tick the moment it's touched.
    snapped.current = `${Math.abs(base.x - 0.5) < SNAP_CENTRE}${Math.abs(base.y - 0.5) < SNAP_CENTRE}${touches.length >= 2 && base.rotation % 90 === 0}`;
    if (touches.length >= 2) {
      const [a, b] = touches;
      g.current = {
        mode: 'twist',
        ids: [id(a), id(b)],
        distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
        angle: Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX),
        mid: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 },
        base,
      };
    } else if (touches.length === 1) g.current = { mode: 'move', ids: [id(touches[0])], start: touches[0], base };
    else g.current = null;
  };

  const place = (x: number, y: number, extra: Patch = {}, turn?: number) => {
    const sx = Math.abs(x - 0.5) < SNAP_CENTRE;
    const sy = Math.abs(y - 0.5) < SNAP_CENTRE;
    // A tick each time it clicks into the middle or straight.
    const snap = `${sx}${sy}${turn !== undefined && turn % 90 === 0}`;
    if (snap !== snapped.current && (sx || sy || (turn !== undefined && turn % 90 === 0))) Haptics.selectionAsync();
    snapped.current = snap;
    latest.current.onGuide({ x: sx, y: sy, turn });
    latest.current.onChange({ x: sx ? 0.5 : x, y: sy ? 0.5 : y, ...extra });
  };

  const move = (touches: Touch[]) => {
    const now = g.current;
    if (!now) return;
    const { frameW: w, frameH: h } = latest.current;
    if (now.mode === 'move') {
      const t = touches.find((x) => id(x) === now.ids[0]);
      if (!t) return; // this event didn't carry our finger
      place(now.base.x + (t.pageX - now.start.pageX) / w, now.base.y + (t.pageY - now.start.pageY) / h);
      return;
    }
    const a = touches.find((x) => id(x) === now.ids[0]);
    const b = touches.find((x) => id(x) === now.ids[1]);
    if (!a || !b) return;
    const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
    const angle = Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX);
    const mid = { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
    const rotation = snapTurn(now.base.rotation + ((angle - now.angle) * 180) / Math.PI);
    const width = Math.max(0.05, Math.min(3, now.base.width * (distance / Math.max(1, now.distance))));
    place(now.base.x + (mid.x - now.mid.x) / w, now.base.y + (mid.y - now.mid.y) / h, { width, rotation }, rotation);
  };

  const finish = () => {
    g.current = null;
    latest.current.onBusy(false);
    latest.current.onGuide(null);
    latest.current.onEnd();
  };

  const responder = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      latest.current.onBusy(true);
      latest.current.onSelect();
      begin(touchesOf(e));
    },
    // Another finger joined or one lifted: carry on from where things are now with the fingers left.
    onResponderStart: (e: GestureResponderEvent) => begin(touchesOf(e)),
    onResponderEnd: (e: GestureResponderEvent) => {
      const left = touchesOf(e).filter((t) => !(e.nativeEvent.changedTouches as unknown as Touch[]).some((c) => id(c) === id(t)));
      if (left.length) begin(left);
    },
    onResponderMove: (e: GestureResponderEvent) => move(touchesOf(e)),
    onResponderRelease: finish,
    onResponderTerminate: finish,
  };

  return (
    <View
      {...responder}
      style={[styles.box, { left: o.x * frameW - pw / 2, top: o.y * frameH - ph / 2, width: pw, height: ph, transform: [{ rotate: `${o.rotation}deg` }] }]}
    >
      {o.kind === 'video' ? (
        <OverlayVideo overlay={o} time={time} playing={playing} />
      ) : (
        <Image source={{ uri: cutFile(o.file).uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      {selected && (
        <>
          <View style={styles.outline} pointerEvents="none" />
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <Corner key={c} corner={c} overlay={o} pw={pw} ph={ph} frameW={frameW} onBusy={onBusy} onChange={onChange} onEnd={onEnd} />
          ))}
        </>
      )}
    </View>
  );
}

/** A corner handle: drag it out or in to resize the overlay about its middle. */
function Corner({ corner, overlay, pw, ph, frameW, onBusy, onChange, onEnd }: { corner: 'tl' | 'tr' | 'bl' | 'br'; overlay: Overlay; pw: number; ph: number; frameW: number; onBusy: (busy: boolean) => void; onChange: (p: Patch) => void; onEnd: () => void }) {
  const latest = useRef({ overlay, pw, ph, frameW, onChange, onEnd, onBusy });
  useEffect(() => {
    latest.current = { overlay, pw, ph, frameW, onChange, onEnd, onBusy };
  });
  const start = useRef<{ touch: Touch; base: Overlay; dir: { x: number; y: number }; reach: number } | null>(null);
  const sx = corner.endsWith('r') ? 1 : -1;
  const sy = corner.startsWith('b') ? 1 : -1;
  const responder = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      latest.current.onBusy(true);
      Haptics.selectionAsync();
      const { overlay: o, pw: w, ph: h } = latest.current;
      // Which way this corner points from the middle, on screen (the box may be turned).
      const r = (o.rotation * Math.PI) / 180;
      const ox = (sx * w) / 2;
      const oy = (sy * h) / 2;
      const vx = ox * Math.cos(r) - oy * Math.sin(r);
      const vy = ox * Math.sin(r) + oy * Math.cos(r);
      const reach = Math.hypot(vx, vy);
      start.current = { touch: touchesOf(e)[0], base: o, dir: { x: vx / reach, y: vy / reach }, reach };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const s = start.current;
      const t = touchesOf(e).find((x) => id(x) === id(s?.touch ?? ({} as Touch)));
      if (!s || !t) return;
      const grow = (t.pageX - s.touch.pageX) * s.dir.x + (t.pageY - s.touch.pageY) * s.dir.y;
      const factor = Math.max(0.1, (s.reach + grow) / s.reach);
      latest.current.onChange({ width: Math.max(0.05, Math.min(3, s.base.width * factor)) });
    },
    onResponderRelease: () => {
      start.current = null;
      latest.current.onBusy(false);
      latest.current.onEnd();
    },
    onResponderTerminate: () => {
      start.current = null;
      latest.current.onBusy(false);
      latest.current.onEnd();
    },
  };
  return (
    <View
      {...responder}
      hitSlop={14}
      style={[styles.handle, { left: sx < 0 ? -HANDLE / 2 : undefined, right: sx > 0 ? -HANDLE / 2 : undefined, top: sy < 0 ? -HANDLE / 2 : undefined, bottom: sy > 0 ? -HANDLE / 2 : undefined }]}
    />
  );
}

// expo-video is driven by setting properties on the player.
const seekTo = (p: VideoPlayer, t: number) => {
  p.currentTime = t;
};
const setSound = (p: VideoPlayer, volume: number) => {
  p.volume = Math.min(1, volume);
};

/** A video overlay, kept in step with the editor: playing, pausing and seeking along with it. */
function OverlayVideo({ overlay: o, time, playing }: { overlay: Overlay; time: number; playing: boolean }) {
  const player = useVideoPlayer(cutFile(o.file).uri, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0;
  });
  const at = Math.max(0, o.from + (time - o.start));
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  });
  useEffect(() => setSound(player, o.muted ? 0 : o.volume), [player, o.muted, o.volume]);
  // A seek before the video has loaded can be dropped: go to the right frame once it's ready.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && Math.abs(player.currentTime - atRef.current) > 0.04) seekTo(player, atRef.current);
    });
    return () => sub.remove();
  }, [player]);
  useEffect(() => {
    if (playing) {
      seekTo(player, atRef.current);
      player.play();
    } else player.pause();
  }, [player, playing]);
  // Paused: show the right frame as the playhead moves. Playing: only correct a real drift.
  useEffect(() => {
    const drift = Math.abs(player.currentTime - at);
    if (playing ? drift > 0.3 : drift > 0.04) seekTo(player, at);
  }, [player, at, playing]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

const styles = StyleSheet.create({
  box: { position: 'absolute', overflow: 'visible' },
  outline: { ...StyleSheet.absoluteFill, borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: theme.ink },
});
