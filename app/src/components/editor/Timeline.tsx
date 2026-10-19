import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { clipOffset, musicSpan, outDuration, retimeMusic, retimeOverlay, retimeSpan, type CaptionLine, type ClipEdit, type Keyframe, type Music, type Overlay, type TextOverlay } from '../../lib/edit';
import { cutFile } from '../../lib/store';
import { theme } from '../../lib/theme';
import Svg, { Path } from 'react-native-svg';
import { Thumb } from '../Thumb';
import { PressableScale, type SymbolName } from '../ui';
import { UI_FONT } from '../../lib/fonts';

export const PPS = 56; // points per second of output, before zooming
const MIN_PPS = 14;
const MAX_PPS = 400;
const CLIP_H = 58;
const ROW_H = 34;
const ROW_GAP = 6;
const KEY = 14; // keyframe diamond
const LEFT = 70;
const TILE = 46;

type Props = {
  clips: ClipEdit[];
  sourceUri: string;
  sourceDuration: number;
  time: number;
  selected: number;
  /** Source time of the cover frame, for the Cover tile. */
  coverSource: number;
  captionsOn: boolean;
  music?: Music;
  keyframes?: Keyframe[];
  onKeyframe: (k: Keyframe) => void;
  /** The source's loudness, drawn along the bottom of each clip. */
  waveform?: { rate: number; peaks: number[] };
  /** The video's own sound is off: its waveform lies flat. */
  muted?: boolean;
  lines: CaptionLine[];
  /** The caption line (by key) that's selected. */
  selectedCaption: string | null;
  texts: TextOverlay[];
  selectedText: string | null;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onScrub: (t: number) => void;
  onSelectClip: (i: number) => void;
  onTrim: (i: number, edges: { start?: number; end?: number }) => void;
  onReorderStart: (i: number) => void;
  onCover: () => void;
  onAudio: () => void;
  onCaptions: (line?: CaptionLine) => void;
  onSelectText: (id: string) => void;
  /** A text's block was dragged: its new start, end, or both (slid). */
  onRetimeText: (id: string, change: { start?: number; end?: number }) => void;
  onAddText: () => void;
  /** The song's panel is open: its block shows handles to move and trim it. */
  musicSelected: boolean;
  /** The song's block was dragged: its new start, end, or both (slid). */
  onRetimeMusic: (change: { start?: number; end?: number }) => void;
  overlays: Overlay[];
  selectedOverlay: string | null;
  onSelectOverlay: (id: string) => void;
  /** An overlay's block was dragged: its new start, end, or both (slid). */
  onRetimeOverlay: (id: string, change: { start?: number; end?: number }) => void;
  onAddOverlay: () => void;
};

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Seconds between ruler labels, so they stay readable at any zoom. */
const tickStep = (pps: number) => [1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 44) ?? 60;
/** Source seconds between filmstrip frames: on a fixed grid, so zooming reuses frames already made. */
const frameStep = (secondsPerTile: number) => [8, 4, 2, 1, 0.5, 0.25].find((g) => g <= secondsPerTile) ?? 0.25;

/** CapCut-style timeline: the playhead stays centred and the strip scrolls under it. Pinch to zoom. */
export function Timeline(p: Props) {
  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);
  const momentum = useRef(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [trim, setTrim] = useState<{ i: number; start: number; end: number } | null>(null);
  const [pps, setPps] = useState(PPS);
  // An overlay block being dragged, shown where it would land.
  const [overlayDraft, setOverlayDraft] = useState<Overlay | null>(null);
  // The same for a text block and the song.
  const [textDraft, setTextDraft] = useState<TextOverlay | null>(null);
  const [musicDraft, setMusicDraft] = useState<Music | null>(null);
  const zoomed = Math.abs(pps - PPS) / PPS > 0.05;
  // A light tick as the playhead crosses into another clip while scrubbing.
  const lastClip = useRef(-1);
  const tickAt = (t: number) => {
    let i = 0;
    for (let acc = 0; i < clips.length - 1 && t >= acc + outDuration(clips[i]); i++) acc += outDuration(clips[i]);
    if (lastClip.current !== -1 && i !== lastClip.current) Haptics.selectionAsync();
    lastClip.current = i;
  };

  const clips = trim ? p.clips.map((c, k) => (k === trim.i ? { ...c, start: trim.start, end: trim.end } : c)) : p.clips;
  const total = clips.reduce((t, c) => t + outDuration(c), 0);
  const x = (t: number) => t * pps;

  // Follow playback, seeks and zooming unless the user is dragging the strip.
  useEffect(() => {
    if (!dragging.current) scroll.current?.scrollTo({ x: p.time * pps, animated: false });
  }, [p.time, pps, width]);

  const endScrub = () => {
    if (!dragging.current) return;
    dragging.current = false;
    p.onScrubEnd();
  };

  // Two fingers zoom the strip in and out around the playhead.
  const latest = useRef({ pps, endScrub });
  useEffect(() => {
    latest.current = { pps, endScrub };
  });
  const zoomFrom = useRef(PPS);
  // The gesture's handlers read the latest values from refs when fingers move, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pinch] = useState(() =>
    Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        zoomFrom.current = latest.current.pps;
        latest.current.endScrub();
        setScrollEnabled(false);
      })
      .onUpdate((e) => {
        const next = Math.max(MIN_PPS, Math.min(MAX_PPS, zoomFrom.current * e.scale));
        if (Math.abs(next - latest.current.pps) / latest.current.pps > 0.02) setPps(next);
      })
      .onFinalize(() => setScrollEnabled(true))
  );

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const step = tickStep(pps);
  const seconds = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        <View style={{ height: 22 }} />
        <Pressable onPress={p.onCover} style={styles.cover} accessibilityLabel="Choose the cover">
          <Thumb uri={p.sourceUri} seconds={p.coverSource} style={StyleSheet.absoluteFill} />
          <View style={styles.coverShade}>
            <SymbolView name="pencil" tintColor="#fff" size={13} weight="semibold" />
            <Text style={styles.coverText}>Cover</Text>
          </View>
        </Pressable>
        <LaneButton icon="captions.bubble" label="Captions" onPress={() => p.onCaptions()} />
        {p.overlays.length > 0 && <LaneButton icon="photo.on.rectangle" label="Add overlay" onPress={p.onAddOverlay} />}
        <LaneButton icon="music.note" label="Audio" onPress={p.onAudio} />
        <LaneButton text="Aa" label="Text" onPress={p.onAddText} />
      </View>

      <GestureDetector gesture={pinch}>
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
              momentum.current = false;
              lastClip.current = -1;
              p.onScrubStart();
            }}
            onScroll={(e) => {
              if (!dragging.current) return;
              const t = Math.max(0, Math.min(total, e.nativeEvent.contentOffset.x / pps));
              tickAt(t);
              p.onScrub(t);
            }}
            onScrollEndDrag={() => {
              // A fling keeps scrubbing until its momentum stops. If no momentum starts, the scrub
              // ends here, so the strip can never be left thinking it's still being dragged.
              setTimeout(() => !momentum.current && endScrub(), 80);
            }}
            onMomentumScrollBegin={() => {
              momentum.current = true;
            }}
            onMomentumScrollEnd={() => {
              momentum.current = false;
              endScrub();
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
                  const tiles = Math.max(1, Math.min(60, Math.ceil(w / TILE)));
                  const perTile = (TILE / pps) * c.speed; // source seconds under one tile
                  const grid = frameStep(perTile);
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
                        {Array.from({ length: tiles }, (_, k) => {
                          const at = Math.min(c.end, c.start + Math.round((perTile * (k + 0.5)) / grid) * grid);
                          return <Thumb key={k} uri={p.sourceUri} seconds={at} style={{ width: TILE, height: '100%' }} />;
                        })}
                      </View>
                      {p.waveform && <Waveform wave={p.waveform} clip={c} width={w} quiet={p.muted || c.volume === 0} />}
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
                            pps={pps}
                            onBegin={() => setScrollEnabled(false)}
                            onMove={(start) => setTrim({ i, start, end: p.clips[i].end })}
                            onEnd={(start) => {
                              setTrim(null);
                              setScrollEnabled(true);
                              p.onTrim(i, { start });
                            }}
                            onCancel={() => {
                              setTrim(null);
                              setScrollEnabled(true);
                            }}
                            sourceDuration={p.sourceDuration}
                          />
                          <TrimHandle
                            side="end"
                            clip={p.clips[i]}
                            pps={pps}
                            onBegin={() => setScrollEnabled(false)}
                            onMove={(end) => setTrim({ i, start: p.clips[i].start, end })}
                            onEnd={(end) => {
                              setTrim(null);
                              setScrollEnabled(true);
                              p.onTrim(i, { end });
                            }}
                            onCancel={() => {
                              setTrim(null);
                              setScrollEnabled(true);
                            }}
                            sourceDuration={p.sourceDuration}
                          />
                        </>
                      )}
                    </Pressable>
                  );
                })}
                {(p.keyframes ?? []).map((k) => (
                  <Pressable
                    key={k.id}
                    onPress={() => p.onKeyframe(k)}
                    hitSlop={10}
                    accessibilityLabel={`Keyframe at ${mmss(k.t)}`}
                    style={[styles.keyframe, { left: x(k.t) - KEY / 2 }]}
                  />
                ))}
              </View>

              {/* Captions, audio and text each run the full length of the video, like the clips. */}
              <Pressable onPress={() => p.onCaptions()} style={styles.lane}>
                {p.captionsOn && p.lines.length ? (
                  p.lines.map((l) => (
                    <Pressable
                      key={`${l.key}-${l.start}`}
                      onPress={() => p.onCaptions(l)}
                      style={[styles.chip, { left: x(l.start), width: Math.max(14, x(l.end - l.start) - 2) }, p.selectedCaption === l.key && styles.chipOn]}
                    >
                      <Text style={styles.chipText} numberOfLines={1}>
                        {l.text}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.laneLabel}>+ Add captions</Text>
                )}
              </Pressable>

              {p.overlays.length > 0 && (
                <View style={styles.lane}>
                  {p.overlays.map((base) => {
                    const o = overlayDraft?.id === base.id ? overlayDraft : base;
                    const on = p.selectedOverlay === o.id;
                    const w = Math.max(16, x(o.end - o.start) - 2);
                    // Dragging an edge (or the whole block) shows it moving; letting go saves it.
                    const drag = (change: (dt: number) => { start?: number; end?: number }) => ({
                      pps,
                      onBegin: () => setScrollEnabled(false),
                      onMove: (dt: number) => setOverlayDraft(retimeOverlay(base, change(dt), total)),
                      onEnd: (dt: number) => {
                        setOverlayDraft(null);
                        setScrollEnabled(true);
                        if (dt !== 0) p.onRetimeOverlay(base.id, change(dt));
                      },
                      onCancel: () => {
                        setOverlayDraft(null);
                        setScrollEnabled(true);
                      },
                    });
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => p.onSelectOverlay(o.id)}
                        accessibilityLabel={o.kind === 'video' ? 'Video overlay' : 'Photo overlay'}
                        style={[styles.overlay, { left: x(o.start), width: w, zIndex: on ? 2 : 1 }, on && styles.overlayOn]}
                      >
                        <OverlayTiles overlay={o} width={w} />
                        {on && (
                          <>
                            <Drag {...drag((dt) => ({ start: base.start + dt, end: base.end + dt }))} style={styles.overlayBody} />
                            <Drag {...drag((dt) => ({ start: base.start + dt }))} style={[styles.overlayHandle, { left: 0 }]} grip />
                            <Drag {...drag((dt) => ({ end: base.end + dt }))} style={[styles.overlayHandle, { right: 0 }]} grip />
                          </>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Pressable onPress={p.onAudio} style={styles.lane}>
                {p.music ? (
                  (() => {
                    const m = musicDraft ?? p.music;
                    const span = musicSpan(m, total);
                    const w = Math.max(16, x(span.end - span.start) - 2);
                    const drag = (change: (dt: number) => { start?: number; end?: number }) => ({
                      pps,
                      onBegin: () => setScrollEnabled(false),
                      onMove: (dt: number) => setMusicDraft(retimeMusic(p.music!, change(dt), total)),
                      onEnd: (dt: number) => {
                        setMusicDraft(null);
                        setScrollEnabled(true);
                        if (dt !== 0) p.onRetimeMusic(change(dt));
                      },
                      onCancel: () => {
                        setMusicDraft(null);
                        setScrollEnabled(true);
                      },
                    });
                    const base = musicSpan(p.music, total);
                    return (
                      <View style={[styles.song, { left: x(span.start), width: w }, p.musicSelected && styles.songOn]}>
                        <SymbolView name="music.note" tintColor="#fff" size={11} style={p.musicSelected ? { marginLeft: 8 } : undefined} />
                        <Text style={styles.songText} numberOfLines={1}>
                          {p.music.name}
                        </Text>
                        {p.musicSelected && (
                          <>
                            <Drag {...drag((dt) => ({ start: base.start + dt, end: base.end + dt }))} style={styles.overlayBody} />
                            <Drag {...drag((dt) => ({ start: base.start + dt }))} style={[styles.overlayHandle, styles.songHandle, { left: 0 }]} grip />
                            <Drag {...drag((dt) => ({ end: base.end + dt }))} style={[styles.overlayHandle, styles.songHandle, { right: 0 }]} grip />
                          </>
                        )}
                      </View>
                    );
                  })()
                ) : (
                  <Text style={styles.laneLabel}>+ Add audio</Text>
                )}
              </Pressable>

              <Pressable onPress={p.onAddText} style={styles.lane}>
                {!p.texts.length && <Text style={styles.laneLabel}>+ Add text</Text>}
                {p.texts.map((base) => {
                  const t = textDraft?.id === base.id ? textDraft : base;
                  const on = p.selectedText === t.id;
                  const drag = (change: (dt: number) => { start?: number; end?: number }) => ({
                    pps,
                    onBegin: () => setScrollEnabled(false),
                    onMove: (dt: number) => setTextDraft(retimeSpan(base, change(dt), total)),
                    onEnd: (dt: number) => {
                      setTextDraft(null);
                      setScrollEnabled(true);
                      if (dt !== 0) p.onRetimeText(base.id, change(dt));
                    },
                    onCancel: () => {
                      setTextDraft(null);
                      setScrollEnabled(true);
                    },
                  });
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => p.onSelectText(t.id)}
                      style={[styles.chip, styles.textChip, { left: x(t.start), width: Math.max(16, x(t.end - t.start) - 2) }, on && styles.textChipOn]}
                    >
                      <Text style={[styles.chipText, { color: theme.ink }, on && { marginHorizontal: 8 }]} numberOfLines={1}>
                        {t.text}
                      </Text>
                      {on && (
                        <>
                          <Drag {...drag((dt) => ({ start: base.start + dt, end: base.end + dt }))} style={styles.overlayBody} />
                          <Drag {...drag((dt) => ({ start: base.start + dt }))} style={[styles.overlayHandle, { left: 0 }]} grip />
                          <Drag {...drag((dt) => ({ end: base.end + dt }))} style={[styles.overlayHandle, { right: 0 }]} grip />
                        </>
                      )}
                    </Pressable>
                  );
                })}
              </Pressable>
            </View>
          </ScrollView>
        )}
        <View style={[styles.playhead, { left: width / 2 - 1 }]} pointerEvents="none" />
        {zoomed && (
          <Pressable onPress={() => setPps(PPS)} hitSlop={8} style={styles.zoom} accessibilityLabel="Reset zoom">
            <Text style={styles.zoomText}>{(pps / PPS).toFixed(1)}×</Text>
            <SymbolView name="arrow.counterclockwise" tintColor={theme.muted} size={10} weight="semibold" />
          </Pressable>
        )}
      </View>
      </GestureDetector>
    </View>
  );
}

type HandleProps = {
  side: 'start' | 'end';
  clip: ClipEdit;
  pps: number;
  onBegin: () => void;
  onMove: (v: number) => void;
  onEnd: (v: number) => void;
  /** The handle went away mid-drag (its clip stopped being selected). */
  onCancel: () => void;
  sourceDuration: number;
};

const WAVE_H = 18;
const BAR_STEP = 3; // a 2-point bar every 3 points

/**
 * A clip's sound as bars along its bottom edge, one path for the whole clip. Each bar is the
 * loudest moment in its slice of the clip's source, so trims and speed changes line up.
 */
function Waveform({ wave, clip, width, quiet }: { wave: { rate: number; peaks: number[] }; clip: ClipEdit; width: number; quiet: boolean }) {
  const bars = Math.max(1, Math.floor(width / BAR_STEP));
  const span = (clip.end - clip.start) / bars;
  let d = '';
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((clip.start + i * span) * wave.rate);
    const to = Math.max(from + 1, Math.floor((clip.start + (i + 1) * span) * wave.rate));
    let v = 0;
    for (let k = from; k < to && k < wave.peaks.length; k++) v = Math.max(v, wave.peaks[k]);
    const h = quiet ? 1.5 : Math.max(1.5, (v / 100) * WAVE_H);
    d += `M${i * BAR_STEP} ${WAVE_H}V${(WAVE_H - h).toFixed(1)}h2V${WAVE_H}Z`;
  }
  return (
    <View style={styles.wave} pointerEvents="none">
      <Svg width={width} height={WAVE_H}>
        <Path d={d} fill={quiet ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.92)'} />
      </Svg>
    </View>
  );
}

const OVERLAY_TILE = ROW_H - 6;

/** An overlay's block on the timeline: its picture (or its video's first frame) repeated along it. */
function OverlayTiles({ overlay: o, width }: { overlay: Overlay; width: number }) {
  const tiles = Math.max(1, Math.min(40, Math.ceil(width / OVERLAY_TILE)));
  const uri = cutFile(o.file).uri;
  return (
    <View style={styles.tiles} pointerEvents="none">
      {Array.from({ length: tiles }, (_, k) =>
        o.kind === 'video' ? (
          <Thumb key={k} uri={uri} seconds={o.from} style={{ width: OVERLAY_TILE, height: '100%' }} />
        ) : (
          <Image key={k} source={{ uri }} style={{ width: OVERLAY_TILE, height: '100%' }} resizeMode="cover" />
        )
      )}
      {o.kind === 'video' && (
        <View style={styles.overlayKind}>
          <SymbolView name={o.muted || o.volume === 0 ? 'speaker.slash.fill' : 'video.fill'} tintColor="#fff" size={9} />
        </View>
      )}
    </View>
  );
}

type DragProps = {
  pps: number;
  grip?: boolean;
  style: StyleProp<ViewStyle>;
  onBegin: () => void;
  /** How far it's been dragged, in seconds. */
  onMove: (dt: number) => void;
  onEnd: (dt: number) => void;
  onCancel: () => void;
};

/** A part of a selected overlay block that drags sideways along the timeline. */
function Drag({ pps, grip, style, onBegin, onMove, onEnd, onCancel }: DragProps) {
  const latest = useRef({ pps, onBegin, onMove, onEnd, onCancel });
  useEffect(() => {
    latest.current = { pps, onBegin, onMove, onEnd, onCancel };
  });
  const active = useRef(false);
  // Removed mid-drag (deselected, undone): let the strip scroll again.
  useEffect(
    () => () => {
      if (active.current) latest.current.onCancel();
    },
    []
  );
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        active.current = true;
        Haptics.selectionAsync();
        latest.current.onBegin();
      },
      onPanResponderMove: (_, g) => latest.current.onMove(g.dx / latest.current.pps),
      onPanResponderRelease: (_, g) => {
        active.current = false;
        latest.current.onEnd(g.dx / latest.current.pps);
      },
      onPanResponderTerminate: () => {
        active.current = false;
        latest.current.onCancel();
      },
    })
  );
  return (
    <View {...responder.panHandlers} hitSlop={grip ? { left: 12, right: 12, top: 6, bottom: 6 } : undefined} style={style}>
      {grip && <View style={styles.overlayGrip} />}
    </View>
  );
}

/** A square at the left of a lane (captions, audio, text) that does the same as tapping the lane. */
function LaneButton({ icon, text, label, onPress }: { icon?: SymbolName; text?: string; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} scaleTo={0.9} style={styles.laneButton}>
      {icon ? <SymbolView name={icon} tintColor={theme.ink} size={16} /> : <Text style={styles.laneButtonText}>{text}</Text>}
    </PressableScale>
  );
}

/** Drag a clip's edge to trim it. Movement is in output points, converted to source seconds. */
function TrimHandle({ side, clip, pps, onBegin, onMove, onEnd, onCancel, sourceDuration }: HandleProps) {
  const latest = useRef({ clip, pps, onBegin, onMove, onEnd, onCancel, sourceDuration });
  useEffect(() => {
    latest.current = { clip, pps, onBegin, onMove, onEnd, onCancel, sourceDuration };
  });
  const value = useRef(0);
  const active = useRef(false);
  // Without this, a handle removed mid-drag would leave the strip unable to scroll.
  useEffect(
    () => () => {
      if (active.current) latest.current.onCancel();
    },
    []
  );
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
        active.current = true;
        Haptics.selectionAsync();
        begin();
      },
      onPanResponderMove: (_, g) => {
        const { clip: c, pps: scale, onMove: move, sourceDuration: max } = latest.current;
        const delta = (g.dx / scale) * c.speed;
        value.current = side === 'start' ? Math.max(0, Math.min(c.end - 0.1, c.start + delta)) : Math.min(max, Math.max(c.start + 0.1, c.end + delta));
        move(value.current);
      },
      onPanResponderRelease: () => {
        active.current = false;
        latest.current.onEnd(value.current);
      },
      onPanResponderTerminate: () => {
        active.current = false;
        latest.current.onEnd(value.current);
      },
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
  cover: { width: LEFT - 14, height: CLIP_H, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.card },
  coverShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center', gap: 3 },
  coverText: { color: '#fff', fontSize: 11, ...UI_FONT.bold },
  laneButton: { width: LEFT - 22, height: ROW_H, marginTop: ROW_GAP, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.75)', alignItems: 'center', justifyContent: 'center' },
  laneButtonText: { fontSize: 15, ...UI_FONT.semibold, color: theme.ink },
  ruler: { height: 22 },
  tick: { position: 'absolute', top: 4 },
  tickText: { fontSize: 10, ...UI_FONT.semibold, color: theme.muted, fontVariant: ['tabular-nums'], marginLeft: -12 },
  clip: { position: 'absolute', top: 0, height: CLIP_H, borderRadius: 10, overflow: 'hidden', backgroundColor: '#E4E4E8', borderWidth: 2, borderColor: 'transparent' },
  clipOn: { borderColor: theme.ink },
  tiles: { flex: 1, flexDirection: 'row' },
  badge: { position: 'absolute', top: 4, left: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 10, ...UI_FONT.bold },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 14, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: '#fff' },
  lane: { height: ROW_H, marginTop: ROW_GAP, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.75)', justifyContent: 'center' },
  laneLabel: { fontSize: 13, ...UI_FONT.semibold, color: theme.ink, marginLeft: 12 },
  song: { position: 'absolute', top: 3, bottom: 3, borderRadius: 7, backgroundColor: '#3A3A40', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  songText: { color: '#fff', fontSize: 11, ...UI_FONT.semibold, flexShrink: 1 },
  chip: { position: 'absolute', top: 3, height: ROW_H - 6, borderRadius: 7, backgroundColor: theme.ink, justifyContent: 'center', paddingHorizontal: 6 },
  chipOn: { borderWidth: 2, borderColor: '#fff', zIndex: 2 },
  chipText: { color: '#fff', fontSize: 11, ...UI_FONT.semibold },
  textChip: { backgroundColor: '#E4E4E8' },
  textChipOn: { borderWidth: 2, borderColor: theme.ink, overflow: 'hidden', zIndex: 2 },
  songOn: { borderWidth: 2, borderColor: theme.blue, overflow: 'hidden' },
  songHandle: { backgroundColor: theme.blue },
  overlay: { position: 'absolute', top: 3, height: ROW_H - 6, borderRadius: 7, overflow: 'hidden', backgroundColor: '#E4E4E8', borderWidth: 2, borderColor: 'transparent' },
  overlayOn: { borderColor: theme.ink },
  overlayBody: { position: 'absolute', top: 0, bottom: 0, left: 12, right: 12 },
  overlayHandle: { position: 'absolute', top: 0, bottom: 0, width: 12, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  overlayGrip: { width: 2, height: 12, borderRadius: 1, backgroundColor: '#fff' },
  overlayKind: { position: 'absolute', top: 2, left: 14, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2 },
  wave: { position: 'absolute', left: 0, right: 0, bottom: 0, height: WAVE_H + 4, paddingTop: 2, backgroundColor: 'rgba(0,0,0,0.28)' },
  keyframe: { position: 'absolute', top: CLIP_H / 2 - KEY / 2, width: KEY, height: KEY, borderRadius: 3, backgroundColor: '#fff', borderWidth: 2, borderColor: theme.ink, transform: [{ rotate: '45deg' }] },
  zoom: { position: 'absolute', top: 0, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.card, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  zoomText: { fontSize: 10, ...UI_FONT.bold, color: theme.ink, fontVariant: ['tabular-nums'] },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, borderRadius: 1, backgroundColor: theme.ink },
});
