import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PanResponder, Pressable, StyleSheet, Switch, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Thumb } from '../components/Thumb';
import { Button } from '../components/ui';
import { startCut, type Take } from '../lib/jobs';
import { useUsage } from '../lib/usage';
import { updateSettings, useSettings } from '../lib/store';
import { COLUMN, formatTime, theme } from '../lib/theme';

const seek = (p: VideoPlayer, t: number) => {
  p.currentTime = t;
};

/** After recording: watch the take back, scrub it, then Retake or Send — laid out like CutAI. */
export default function Review() {
  const insets = useSafeAreaInsets();
  const usage = useUsage();
  const { width: screenW } = useWindowDimensions();
  const params = useLocalSearchParams<{ takes: string }>();
  const takes = useMemo<Take[]>(() => {
    try {
      return JSON.parse(params.takes ?? '[]');
    } catch {
      return [];
    }
  }, [params.takes]);
  const settings = useSettings();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [time, setTime] = useState(0);
  const [sending, setSending] = useState(false);
  const current = takes[index];

  const player = useVideoPlayer(takes[0]?.uri ?? null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 1 / 30;
    p.play();
  });
  useEffect(() => {
    const subs = [
      player.addListener('timeUpdate', (e) => setTime(e.currentTime)),
      player.addListener('playingChange', (e) => setPlaying(e.isPlaying)),
      player.addListener('statusChange', (e) => e.status === 'readyToPlay' && setLoaded(true)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  // Size the player to the video's real shape (9:16 from the camera), read from a frame.
  const [aspect, setAspect] = useState(9 / 16);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!current) return;
    VideoThumbnails.getThumbnailAsync(current.uri, { time: 100 })
      .then((t) => t.width && t.height && setAspect(t.width / t.height))
      .catch(() => {});
  }, [current]);
  let frameW = box.w;
  let frameH = frameW / aspect;
  if (frameH > box.h) {
    frameH = box.h;
    frameW = frameH * aspect;
  }

  const total = takes.reduce((t, k) => t + k.duration, 0);
  const bytes = takes.reduce((t, k) => t + (new File(k.uri).size ?? 0), 0);
  const length = current?.duration || player.duration || 0;

  function choose(i: number) {
    Haptics.selectionAsync();
    setIndex(i);
    setLoaded(false);
    setTime(0);
    player.replaceAsync(takes[i].uri).then(() => player.play());
  }

  function retake() {
    Alert.alert('Discard this recording?', 'Your takes are deleted and you can record again.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }

  function send() {
    if (!usage.room(1)) return; // this month's edits are used up
    setSending(true);
    player.pause();
    const id = startCut(takes, 'en');
    router.replace({ pathname: '/cut/[id]', params: { id } });
  }

  if (!current) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={styles.meta}>Nothing was recorded.</Text>
        <Button kind="text" title="Back to camera" onPress={() => router.back()} />
      </View>
    );
  }

  const flip = current.flip ? { transform: [{ scaleX: -1 as const }] } : null;
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 10, paddingHorizontal: Math.max(18, (screenW - COLUMN) / 2) }]}>
      <View style={styles.header}>
        <Pressable onPress={retake} hitSlop={12} accessibilityLabel="Back" style={styles.back}>
          <SymbolView name="chevron.left" tintColor={theme.ink} size={17} weight="semibold" />
        </Pressable>
        <View style={styles.info}>
          <Text style={styles.infoText}>
            {formatTime(total)} · {bytes > 0 ? `${Math.max(1, Math.round(bytes / 1e6))} MB` : '—'}
          </Text>
        </View>
      </View>

      <View style={styles.previewArea} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {frameW > 0 && (
          <Pressable style={[styles.preview, { width: frameW, height: frameH }]} onPress={() => (playing ? player.pause() : player.play())}>
            {/* The first frame shows until the video is ready, so there's no black flash. */}
            <Thumb uri={current.uri} seconds={0.05} flip={current.flip} style={StyleSheet.absoluteFill} />
            <VideoView player={player} style={[StyleSheet.absoluteFill, flip, { opacity: loaded ? 1 : 0 }]} contentFit="cover" nativeControls={false} />
            {!playing && loaded && (
              <View style={styles.playOverlay} pointerEvents="none">
                <View style={styles.playCircle}>
                  <SymbolView name="play.fill" tintColor="#fff" size={26} />
                </View>
              </View>
            )}
          </Pressable>
        )}
      </View>

      <View style={styles.transport}>
        <Pressable onPress={() => (playing ? player.pause() : player.play())} hitSlop={12} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <SymbolView name={playing ? 'pause.fill' : 'play.fill'} tintColor={theme.ink} size={16} />
        </Pressable>
        <Text style={styles.meta}>
          {formatTime(time)} / {formatTime(length)}
        </Text>
      </View>

      {takes.length > 1 && (
        <View style={styles.takes}>
          {takes.map((t, i) => (
            <Pressable key={t.uri} onPress={() => choose(i)} style={[styles.takeChip, i === index && styles.takeChipOn]}>
              <Text style={[styles.takeText, i === index && { color: '#fff' }]}>
                Take {i + 1} · {formatTime(t.duration)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Filmstrip
        uri={current.uri}
        flip={current.flip}
        duration={length}
        time={time}
        onScrubStart={() => player.pause()}
        onScrub={(t) => {
          seek(player, t);
          setTime(t);
        }}
      />

      <View style={styles.options}>
        <View style={styles.optionRow}>
          <Text style={styles.optionText}>Captions</Text>
          <Switch value={settings.captions} onValueChange={(captions) => updateSettings({ captions })} trackColor={{ true: theme.ink }} />
        </View>
        <Pressable style={styles.more} onPress={() => router.push('/cut-options')} hitSlop={8}>
          <SymbolView name="ellipsis" tintColor={theme.muted} size={14} />
          <Text style={styles.moreText}>More options</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Button kind="outline" title="Retake" icon={<SymbolView name="arrow.counterclockwise" tintColor={theme.ink} size={15} />} onPress={retake} style={{ flex: 1 }} />
        <Button title="Send" icon={<SymbolView name="paperplane.fill" tintColor="#fff" size={15} />} onPress={send} loading={sending} style={{ flex: 1.6 }} />
      </View>
    </View>
  );
}

const TILES = 9;

/** A strip of frames from the take with a playhead; drag along it to scrub. */
function Filmstrip({ uri, flip, duration, time, onScrubStart, onScrub }: { uri: string; flip?: boolean; duration: number; time: number; onScrubStart: () => void; onScrub: (t: number) => void }) {
  const [width, setWidth] = useState(0);
  const latest = useRef({ width, duration, onScrubStart, onScrub });
  useEffect(() => {
    latest.current = { width, duration, onScrubStart, onScrub };
  });
  // PanResponder handlers read the latest props from a ref when a touch happens, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const at = (x: number) => {
      const { width: w, duration: d } = latest.current;
      return w ? Math.max(0, Math.min(d, (x / w) * d)) : 0;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        latest.current.onScrubStart();
        latest.current.onScrub(at(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => latest.current.onScrub(at(e.nativeEvent.locationX)),
    });
  });
  const x = duration ? (time / duration) * width : 0;
  return (
    <View style={styles.strip} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
      <View style={styles.tiles} pointerEvents="none">
        {Array.from({ length: TILES }, (_, k) => (
          <Thumb key={`${uri}-${k}`} uri={uri} flip={flip} seconds={duration ? ((k + 0.5) / TILES) * duration : 0} style={{ flex: 1, height: '100%' }} />
        ))}
      </View>
      <View style={[styles.playhead, { left: Math.max(0, Math.min(width - 3, x - 1.5)) }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 40 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  info: { backgroundColor: theme.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  infoText: { fontSize: 12, color: theme.muted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  previewArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  preview: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#1C1C1F' },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, height: 30 },
  meta: { fontSize: 13, color: theme.muted, fontVariant: ['tabular-nums'] },
  takes: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  takeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.card },
  takeChipOn: { backgroundColor: theme.ink },
  takeText: { fontSize: 12, fontWeight: '600', color: theme.ink, fontVariant: ['tabular-nums'] },
  strip: { height: 48, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.card },
  tiles: { flex: 1, flexDirection: 'row' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 3, borderRadius: 2, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
  options: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionText: { fontSize: 14, color: theme.ink, fontWeight: '500' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moreText: { fontSize: 14, color: theme.muted, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 10 },
});
