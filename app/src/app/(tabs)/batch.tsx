import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../../components/list';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { Thumb } from '../../components/Thumb';
import { Button } from '../../components/ui';
import { addVideo, clearBatch, MAX_CLIPS, MAX_VIDEOS, removeVideo, updateVideo, useBatch, type BatchVideo } from '../../lib/batch';
import { coverSource } from '../../lib/edit';
import { startCut, type Take } from '../../lib/jobs';
import { BATCH } from '../../lib/plans';
import { askToUpgrade, useUsage } from '../../lib/usage';
import { cutFile, cutProgress, cutStatus, useCuts, type CutRecord } from '../../lib/store';
import { COLUMN, formatTime, theme } from '../../lib/theme';

/** Clips picked from Photos, in the order they were tapped. */
async function pickClips(limit: number): Promise<Take[]> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: true, orderedSelection: true, selectionLimit: limit, quality: 1 });
  if (result.canceled) return [];
  return result.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }));
}

/**
 * Batch: put several videos together, each from one or more clips, then edit them all at once.
 * They're uploaded and cut one after another and land in Cuts.
 */
export default function BatchScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cuts = useCuts();
  const usage = useUsage();
  const videos = useBatch();
  const locked = !usage.allows(BATCH);
  const [started, setStarted] = useState<string[]>([]);
  const batch = started.map((id) => cuts.find((c) => c.id === id)).filter((c): c is CutRecord => !!c);
  const ready = batch.filter((c) => c.status === 'ready').length;
  const busy = batch.some((c) => c.status === 'uploading' || c.status === 'processing');
  const clips = videos.reduce((n, v) => n + v.takes.length, 0);

  const upgrade = () => askToUpgrade('Batch edits are on Pro and Ultimate', `You're on ${usage.plan.name}. Upgrade to edit up to ${MAX_VIDEOS} videos at once.`);

  async function addNext() {
    if (locked) return upgrade();
    if (videos.length >= MAX_VIDEOS) return;
    if (usage.left <= videos.length) return usage.room(videos.length + 1); // says how many are left
    const takes = await pickClips(MAX_CLIPS);
    if (takes.length) addVideo(takes);
  }

  async function addClips(video: BatchVideo) {
    const takes = await pickClips(MAX_CLIPS - video.takes.length);
    if (takes.length) updateVideo(video.key, (v) => ({ ...v, takes: [...v.takes, ...takes] }));
  }

  function remove(video: BatchVideo, n: number) {
    Alert.alert(`Remove video ${n}?`, `Its ${video.takes.length === 1 ? 'clip' : 'clips'} stay in Photos.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeVideo(video.key) },
    ]);
  }

  function editAll() {
    if (locked) return upgrade();
    const fits = usage.room(videos.length); // says so if only some fit
    if (!fits) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const go = videos.slice(0, fits);
    setStarted(go.map((v) => startCut(v.takes, 'en', { blend: v.blend, batch: true })));
    // Any that didn't fit stay, ready for next month or a bigger plan.
    if (go.length === videos.length) clearBatch();
    else go.forEach((v) => removeVideo(v.key));
  }

  const side = Math.max(18, (width - COLUMN) / 2);
  const building = !locked && videos.length > 0;
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: TAB_BAR_HEIGHT + 44 }]}>
      <Text style={[styles.h1, { marginHorizontal: side }]}>Batch</Text>
      {building ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: side, paddingTop: 16, paddingBottom: 16, gap: 12 }}>
          <Text style={styles.summary}>
            {videos.length} video{videos.length === 1 ? '' : 's'} · {clips} clip{clips === 1 ? '' : 's'}
            {usage.left === Infinity ? '' : ` · uses ${videos.length} of your ${usage.left} edits left`}
          </Text>
          {videos.map((v, i) => (
            <VideoCard key={v.key} video={v} n={i + 1} onAdd={() => addClips(v)} onRemove={() => remove(v, i + 1)} />
          ))}
          {videos.length < MAX_VIDEOS && (
            <Pressable onPress={addNext} style={({ pressed }) => [styles.addVideo, pressed && { opacity: 0.6 }]} accessibilityRole="button">
              <SymbolView name="plus" tintColor={theme.ink} size={16} weight="semibold" />
              <Text style={styles.addVideoText}>Add video {videos.length + 1}</Text>
            </Pressable>
          )}
        </ScrollView>
      ) : batch.length === 0 || locked ? (
        <View style={[styles.center, { marginHorizontal: side }]}>
          <View style={styles.icon}>
            <SymbolView name="square.stack.3d.down.right" tintColor={theme.ink} size={28} />
          </View>
          <Text style={styles.title}>Edit up to {MAX_VIDEOS} videos at once</Text>
          <Text style={styles.body}>Add a video and pick its clips, then the next one. Tap Edit all and Autocut cuts them one after another. They land in Cuts when they’re ready.</Text>
          {locked && (
            <View style={styles.lockPill}>
              <SymbolView name="lock.fill" tintColor={theme.ink} size={12} />
              <Text style={styles.lockText}>Pro and Ultimate</Text>
            </View>
          )}
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: side, paddingTop: 16, paddingBottom: 16 }}>
          <Text style={styles.summary}>
            {ready} of {batch.length} ready{busy ? ' · you can leave this screen' : ''}
          </Text>
          <Card>
            {batch.map((c, i) => (
              <BatchRow key={c.id} cut={c} n={i + 1} last={i === batch.length - 1} />
            ))}
          </Card>
        </ScrollView>
      )}
      <View style={{ marginHorizontal: side }}>
        {locked ? (
          <Button title="See plans" onPress={() => router.push('/change-plan')} />
        ) : building ? (
          <Button title={videos.length === 1 ? 'Edit video' : `Edit all ${videos.length} videos`} onPress={editAll} />
        ) : (
          <Button title={batch.length ? 'Start another batch' : 'Add your first video'} onPress={addNext} />
        )}
      </View>
    </View>
  );
}

const CLIP_W = 58;
const CLIP_H = 100;

/** A video in the batch being put together: its clips in order. Tap to arrange them. */
function VideoCard({ video, n, onAdd, onRemove }: { video: BatchVideo; n: number; onAdd: () => void; onRemove: () => void }) {
  const total = video.takes.reduce((t, k) => t + k.duration, 0);
  const arrange = () => router.push({ pathname: '/arrange', params: { video: video.key } });
  return (
    <View style={styles.video}>
      <View style={styles.videoHead}>
        <Pressable onPress={arrange} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`Arrange video ${n}`}>
          <Text style={styles.videoTitle}>Video {n}</Text>
          <Text style={styles.videoSub}>
            {video.takes.length} clip{video.takes.length === 1 ? '' : 's'} · {formatTime(total)}
          </Text>
        </Pressable>
        <Pressable onPress={arrange} hitSlop={6} style={styles.chip}>
          <Text style={styles.chipText}>Arrange</Text>
        </Pressable>
        <Pressable onPress={onRemove} hitSlop={8} style={styles.trash} accessibilityLabel={`Remove video ${n}`}>
          <SymbolView name="trash" tintColor={theme.muted} size={15} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {video.takes.map((t, i) => (
          <Pressable key={`${t.uri}-${i}`} onPress={arrange} style={styles.clip}>
            <Thumb uri={t.uri} seconds={0.5} style={StyleSheet.absoluteFill} flip={t.flip} />
            <View style={styles.clipNumber}>
              <Text style={styles.clipNumberText}>{i + 1}</Text>
            </View>
          </Pressable>
        ))}
        {video.takes.length < MAX_CLIPS && (
          <Pressable onPress={onAdd} style={styles.addClip} accessibilityLabel={`Add clips to video ${n}`}>
            <SymbolView name="plus" tintColor={theme.muted} size={20} />
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function BatchRow({ cut, n, last }: { cut: CutRecord; n: number; last: boolean }) {
  const ready = cut.status === 'ready';
  const failed = cut.status === 'failed';
  const uri = cut.source ? cutFile(cut.source).uri : cut.previewUri;
  return (
    <Pressable
      onPress={() => router.push({ pathname: ready ? '/edit/[id]' : '/cut/[id]', params: { id: cut.id } })}
      style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && { backgroundColor: theme.card }]}
    >
      <Thumb uri={uri} seconds={cut.edit ? coverSource(cut.edit) : (cut.clips[0]?.[0] ?? 0) + 0.3} style={styles.thumb} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {ready ? cut.title : `Video ${n}`}
        </Text>
        <Text style={[styles.rowStatus, failed && { color: theme.danger }]} numberOfLines={1}>
          {cutStatus(cut)}
        </Text>
        {!ready && !failed && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(3, Math.round(cutProgress(cut) * 100))}%` }]} />
          </View>
        )}
      </View>
      {ready ? (
        <SymbolView name="chevron.right" tintColor={theme.faint} size={12} weight="semibold" />
      ) : failed ? (
        <SymbolView name="exclamationmark.circle.fill" tintColor={theme.danger} size={18} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  h1: { fontSize: 34, fontWeight: '800', color: theme.ink, letterSpacing: -0.6, marginTop: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.3 },
  body: { fontSize: 15, color: theme.muted, textAlign: 'center', lineHeight: 21 },
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  lockText: { fontSize: 13, fontWeight: '700', color: theme.ink },
  summary: { fontSize: 13, color: theme.muted, marginBottom: 10, marginLeft: 4, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  thumb: { width: 40, height: 60, borderRadius: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: theme.ink },
  rowStatus: { fontSize: 13, color: theme.muted, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden', marginTop: 3 },
  fill: { height: 3, borderRadius: 2, backgroundColor: theme.ink },
  video: { backgroundColor: '#fff', borderRadius: 20, paddingTop: 14, paddingBottom: 14 },
  videoHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  videoTitle: { fontSize: 17, fontWeight: '700', color: theme.ink, letterSpacing: -0.2 },
  videoSub: { fontSize: 13, color: theme.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  chip: { backgroundColor: theme.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.ink },
  trash: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  strip: { gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  clip: { width: CLIP_W, height: CLIP_H, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.card },
  clipNumber: { position: 'absolute', top: 5, left: 5, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  clipNumberText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  addClip: { width: CLIP_W, height: CLIP_H, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  addVideo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: '#C7C7CC' },
  addVideoText: { fontSize: 16, fontWeight: '600', color: theme.ink },
});
