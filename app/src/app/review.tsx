import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Thumb } from '../components/Thumb';
import { Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { startCut, type Take } from '../lib/jobs';
import { updateSettings, useSettings } from '../lib/store';
import { formatTime, theme } from '../lib/theme';

export default function Review() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ takes: string }>();
  const takes = useMemo<Take[]>(() => {
    try {
      return JSON.parse(params.takes ?? '[]');
    } catch {
      return [];
    }
  }, [params.takes]);
  const { account } = useAuth();
  const settings = useSettings();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [sending, setSending] = useState(false);

  const player = useVideoPlayer(takes[0]?.uri ?? null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });
  useEffect(() => {
    const subs = [
      player.addListener('timeUpdate', (e) => setTime(e.currentTime)),
      player.addListener('playingChange', (e) => setPlaying(e.isPlaying)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  // Size the player to the video's real shape (e.g. 9:16), read from a frame.
  const [aspect, setAspect] = useState(9 / 16);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!takes[index]) return;
    VideoThumbnails.getThumbnailAsync(takes[index].uri, { time: 100 })
      .then((t) => t.width && t.height && setAspect(t.width / t.height))
      .catch(() => {});
  }, [takes, index]);
  let frameW = box.w;
  let frameH = frameW / aspect;
  if (frameH > box.h) {
    frameH = box.h;
    frameW = frameH * aspect;
  }

  const total = takes.reduce((t, k) => t + k.duration, 0);
  const bytes = takes.reduce((t, k) => t + (new File(k.uri).size ?? 0), 0);
  const current = takes[index];

  function choose(i: number) {
    setIndex(i);
    player.replaceAsync(takes[i].uri).then(() => player.play());
  }

  function retake() {
    Alert.alert('Discard this recording?', 'Your takes are deleted and you can record again.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }

  function send() {
    setSending(true);
    player.pause();
    const id = startCut(takes, account?.profile.language ?? 'en');
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={retake} hitSlop={12} accessibilityLabel="Back" style={styles.back}>
          <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
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
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
            {!playing && (
              <View style={styles.playOverlay} pointerEvents="none">
                <SymbolView name="play.fill" tintColor="rgba(255,255,255,0.9)" size={44} />
              </View>
            )}
          </Pressable>
        )}
      </View>

      <View style={styles.transport}>
        <Pressable onPress={() => (playing ? player.pause() : player.play())} hitSlop={10} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <SymbolView name={playing ? 'pause.fill' : 'play.fill'} tintColor={theme.ink} size={16} />
        </Pressable>
        <Text style={styles.meta}>
          {formatTime(time)} / {formatTime(current.duration)}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {takes.map((t, i) => (
          <Pressable key={t.uri} onPress={() => choose(i)} accessibilityLabel={`Take ${i + 1}`}>
            <Thumb uri={t.uri} seconds={Math.min(0.5, t.duration / 2)} style={[styles.take, i === index && styles.takeOn]}>
              <Text style={styles.takeLabel}>
                {takes.length > 1 ? `Take ${i + 1} · ` : ''}
                {formatTime(t.duration)}
              </Text>
            </Thumb>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.options}>
        <View style={styles.optionRow}>
          <Text style={styles.optionText}>Captions</Text>
          <Switch value={settings.captions} onValueChange={(captions) => updateSettings({ captions })} />
        </View>
        <Pressable style={styles.more} onPress={() => router.push('/settings')} hitSlop={8}>
          <SymbolView name="ellipsis" tintColor={theme.muted} size={14} />
          <Text style={styles.moreText}>More options</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Button
          kind="outline"
          title="Retake"
          icon={<SymbolView name="arrow.counterclockwise" tintColor={theme.ink} size={15} />}
          onPress={retake}
          style={{ flex: 1 }}
        />
        <Button
          title="Send"
          icon={<SymbolView name="paperplane.fill" tintColor="#fff" size={15} />}
          onPress={send}
          loading={sending}
          style={{ flex: 2 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 18, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 40 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  info: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  infoText: { fontSize: 12, color: theme.muted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  previewArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#000' },
  playOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  meta: { fontSize: 13, color: theme.muted, fontVariant: ['tabular-nums'] },
  strip: { gap: 8, paddingHorizontal: 2 },
  take: { width: 64, height: 64, borderRadius: 10, justifyContent: 'flex-end', borderWidth: 2, borderColor: 'transparent' },
  takeOn: { borderColor: theme.accent },
  takeLabel: { color: '#fff', fontSize: 10, fontWeight: '700', padding: 4, textShadowColor: '#000', textShadowRadius: 3 },
  options: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionText: { fontSize: 14, color: theme.ink, fontWeight: '500' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moreText: { fontSize: 14, color: theme.muted, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 10 },
});
