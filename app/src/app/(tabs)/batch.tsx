import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../../components/list';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { ReorderRow } from '../../components/ReorderRow';
import { Thumb } from '../../components/Thumb';
import { Button, Wash } from '../../components/ui';
import { addVideo, clearBatch, MAX_CLIPS, MAX_VIDEOS, removeVideo, updateVideo, useBatch, type BatchVideo } from '../../lib/batch';
import { coverSource } from '../../lib/edit';
import { startCut, type Take } from '../../lib/jobs';
import { SCHEDULED } from '../../lib/plans';
import { askToUpgrade, useUsage } from '../../lib/usage';
import { cutFile, cutProgress, cutStatus, useCuts, whenText, type CutRecord } from '../../lib/store';
import { COLUMN, formatTime, theme } from '../../lib/theme';
import { UI_FONT } from '../../lib/fonts';

/** The time now, kept fresh every half minute (so "scheduled" turns into "right away" once it's past). */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30e3);
    return () => clearInterval(t);
  }, []);
  return now;
}

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
  const canSchedule = usage.allows(SCHEDULED);
  const [started, setStarted] = useState<string[]>([]);
  const [scheduling, setScheduling] = useState<string | null>(null); // the video whose time is being picked
  const batch = started.map((id) => cuts.find((c) => c.id === id)).filter((c): c is CutRecord => !!c);
  const ready = batch.filter((c) => c.status === 'ready').length;
  const busy = batch.some((c) => c.status === 'uploading' || c.status === 'processing');
  const clips = videos.reduce((n, v) => n + v.takes.length, 0);
  const now = useNow();
  const later = canSchedule ? videos.filter((v) => v.at && v.at > now).length : 0;

  const upgrade = () => askToUpgrade('Scheduled batch edits are on Pro and Ultimate', `You're on ${usage.plan.name}. Upgrade to pick when each video gets edited.`);

  async function addNext() {
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
    const fits = usage.room(videos.length); // says so if only some fit
    if (!fits) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const go = videos.slice(0, fits);
    setStarted(go.map((v) => startCut(v.takes, 'en', { blend: v.blend, batch: true, at: canSchedule ? v.at : undefined })));
    // Any that didn't fit stay, ready for next month or a bigger plan.
    if (go.length === videos.length) clearBatch();
    else go.forEach((v) => removeVideo(v.key));
  }

  const side = Math.max(18, (width - COLUMN) / 2);
  const building = videos.length > 0;
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: TAB_BAR_HEIGHT + 44 }]}>
      <Wash />
      <Text style={[styles.h1, { marginHorizontal: side }]}>Batch</Text>
      {building ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: side, paddingTop: 16, paddingBottom: 16, gap: 12 }}>
          <Text style={styles.summary}>
            {videos.length} video{videos.length === 1 ? '' : 's'} · {clips} clip{clips === 1 ? '' : 's'}
            {later ? ` · ${later} scheduled` : ''}
            {usage.left === Infinity ? '' : ` · uses ${videos.length} of your ${usage.left} edits left`}
          </Text>
          {videos.map((v, i) => (
            <VideoCard key={v.key} video={v} n={i + 1} now={now} onAdd={() => addClips(v)} onRemove={() => remove(v, i + 1)} onWhen={canSchedule ? () => setScheduling(v.key) : upgrade} locked={!canSchedule} />
          ))}
          {videos.length < MAX_VIDEOS && (
            <Pressable onPress={addNext} style={({ pressed }) => [styles.addVideo, pressed && { opacity: 0.6 }]} accessibilityRole="button">
              <SymbolView name="plus" tintColor={theme.ink} size={16} weight="semibold" />
              <Text style={styles.addVideoText}>Add video {videos.length + 1}</Text>
            </Pressable>
          )}
        </ScrollView>
      ) : batch.length === 0 ? (
        <View style={[styles.center, { marginHorizontal: side }]}>
          <View style={styles.icon}>
            <SymbolView name="square.stack.3d.down.right" tintColor={theme.ink} size={28} />
          </View>
          <Text style={styles.title}>Edit up to <Text style={{ color: theme.blue }}>{MAX_VIDEOS} videos</Text> at once</Text>
          <Text style={styles.body}>Add a video and pick its clips, then the next one. Tap Edit all and Autocut cuts them one after another. They land in Cuts when they’re ready.</Text>
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
        {building ? (
          <Button title={later === videos.length ? `Schedule ${videos.length === 1 ? 'video' : `${videos.length} videos`}` : videos.length === 1 ? 'Edit video' : `Edit all ${videos.length} videos`} onPress={editAll} />
        ) : (
          <Button title={batch.length ? 'Start another batch' : 'Add your first video'} onPress={addNext} />
        )}
      </View>
      {scheduling && (
        <ScheduleSheet
          n={videos.findIndex((v) => v.key === scheduling) + 1}
          now={now}
          at={videos.find((v) => v.key === scheduling)?.at}
          onPick={(at) => {
            updateVideo(scheduling, (v) => ({ ...v, at }));
            setScheduling(null);
          }}
          onClose={() => setScheduling(null)}
        />
      )}
    </View>
  );
}

/** The next whole hour at least half an hour away: a sensible first suggestion. */
const nextSlot = () => {
  const d = new Date(Date.now() + 30 * 60e3);
  d.setMinutes(0, 0, 0);
  return d.getTime() + 3600e3;
};

/** "When should Autocut edit Video 2?": right away, or a date and time up to 30 days ahead. */
function ScheduleSheet({ n, now, at, onPick, onClose }: { n: number; now: number; at?: number; onPick: (at?: number) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(() => new Date(at && at > Date.now() ? at : nextSlot()));
  const soon = now + 5 * 60e3;
  // On the minute picked (the picker keeps the seconds it started with).
  const chosen = Math.max(new Date(value).setSeconds(0, 0), soon);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>When should Autocut edit Video {n}?</Text>
        <Text style={styles.sheetSub}>It uploads now and gets cut at that time, even if your phone is off. It’ll be waiting in Cuts.</Text>
        <DateTimePicker
          value={value}
          mode="datetime"
          display="inline"
          minimumDate={new Date(soon)}
          maximumDate={new Date(now + 30 * 864e5)}
          minuteInterval={5}
          accentColor={theme.ink}
          themeVariant="light"
          onValueChange={(_, d) => setValue(d)}
          style={{ alignSelf: 'center' }}
        />
        <View style={{ gap: 10, marginTop: 8 }}>
          <Button title={`Schedule for ${whenText(chosen)}`} onPress={() => onPick(chosen)} />
          <Button kind="outline" title="Edit right away" onPress={() => onPick(undefined)} />
        </View>
      </View>
    </Modal>
  );
}

const CLIP_W = 58;
const CLIP_H = 100;

/** A video in the batch being put together: its clips in order. Tap to arrange them. */
type CardProps = {
  video: BatchVideo;
  n: number;
  now: number;
  onAdd: () => void;
  onRemove: () => void;
  /** Schedule (or change the time), or offer the upgrade when `locked`. */
  onWhen: () => void;
  /** Scheduling isn't on this plan. */
  locked: boolean;
};

function VideoCard({ video, n, now, onAdd, onRemove, onWhen, locked }: CardProps) {
  const later = !locked && !!video.at && video.at > now;
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
      {/* Hold a clip and drag it to change the order. */}
      <ReorderRow
        items={video.takes}
        keyOf={(t, i) => `${t.uri}-${i}`}
        width={CLIP_W}
        height={CLIP_H}
        gap={8}
        onMove={(from, to) =>
          updateVideo(video.key, (v) => {
            const takes = [...v.takes];
            const [moved] = takes.splice(from, 1);
            takes.splice(to, 0, moved);
            return { ...v, takes };
          })
        }
        tileStyle={styles.clip}
        contentStyle={styles.strip}
        render={(t, i) => (
          <Pressable onPress={arrange} style={StyleSheet.absoluteFill} accessibilityLabel={`Clip ${i + 1}`}>
            <Thumb uri={t.uri} seconds={0.5} style={StyleSheet.absoluteFill} flip={t.flip} />
            <View style={styles.clipNumber}>
              <Text style={styles.clipNumberText}>{i + 1}</Text>
            </View>
          </Pressable>
        )}
        trailing={
          video.takes.length < MAX_CLIPS && (
            <Pressable onPress={onAdd} style={styles.addClip} accessibilityLabel={`Add clips to video ${n}`}>
              <SymbolView name="plus" tintColor={theme.muted} size={20} />
            </Pressable>
          )
        }
      />
      {/* Only Schedule / Change opens the time picker; the rest of the row just says when. */}
      <View style={styles.when}>
        <SymbolView name={later ? 'calendar.badge.clock' : 'bolt.fill'} tintColor={theme.ink} size={15} />
        <Text style={styles.whenText}>{later ? `Edit ${whenText(video.at!).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}` : 'Edit right away'}</Text>
        <Pressable onPress={onWhen} hitSlop={10} style={({ pressed }) => [styles.whenButton, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={later ? `Change when video ${n} is edited` : `Schedule video ${n}`}>
          {locked && (
            <View style={styles.proPill}>
              <SymbolView name="lock.fill" tintColor="#fff" size={9} />
              <Text style={styles.proText}>PRO</Text>
            </View>
          )}
          <Text style={styles.whenChange}>{later ? 'Change' : 'Schedule'}</Text>
          <SymbolView name="chevron.right" tintColor={theme.faint} size={11} weight="semibold" />
        </Pressable>
      </View>
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
        {!ready && !failed && cut.stage !== 'scheduled' && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(3, Math.round(cutProgress(cut) * 100))}%` }]} />
          </View>
        )}
      </View>
      {ready ? (
        <SymbolView name="chevron.right" tintColor={theme.faint} size={12} weight="semibold" />
      ) : failed ? (
        <SymbolView name="exclamationmark.circle.fill" tintColor={theme.danger} size={18} />
      ) : cut.stage === 'scheduled' ? (
        <SymbolView name="calendar.badge.clock" tintColor={theme.muted} size={17} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  h1: { fontSize: 34, ...UI_FONT.extrabold, color: theme.ink, letterSpacing: -0.6, marginTop: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontSize: 22, ...UI_FONT.bold, color: theme.ink, textAlign: 'center', letterSpacing: -0.3 },
  body: { fontSize: 15, ...UI_FONT.semibold, color: theme.muted, textAlign: 'center', lineHeight: 21 },
  summary: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, marginBottom: 10, marginLeft: 4, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  thumb: { width: 40, height: 60, borderRadius: 8 },
  rowTitle: { fontSize: 15, ...UI_FONT.semibold, color: theme.ink },
  rowStatus: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden', marginTop: 3 },
  fill: { height: 3, borderRadius: 2, backgroundColor: theme.ink },
  video: { backgroundColor: '#fff', borderRadius: 20, paddingTop: 14, paddingBottom: 14 },
  videoHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  videoTitle: { fontSize: 17, ...UI_FONT.bold, color: theme.ink, letterSpacing: -0.2 },
  videoSub: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  chip: { backgroundColor: theme.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 13, ...UI_FONT.semibold, color: theme.ink },
  trash: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  strip: { gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  clip: { width: CLIP_W, height: CLIP_H, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.card },
  clipNumber: { position: 'absolute', top: 5, left: 5, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  clipNumberText: { color: '#fff', fontSize: 11, ...UI_FONT.bold },
  addClip: { width: CLIP_W, height: CLIP_H, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  addVideo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: '#C7C7CC' },
  addVideoText: { fontSize: 16, ...UI_FONT.semibold, color: theme.ink },
  when: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  whenText: { flex: 1, fontSize: 15, ...UI_FONT.semibold, color: theme.ink },
  whenChange: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted },
  whenButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  proText: { color: '#fff', fontSize: 10, ...UI_FONT.extrabold, letterSpacing: 0.4 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: theme.line, marginBottom: 14 },
  sheetTitle: { fontSize: 20, ...UI_FONT.bold, color: theme.ink, letterSpacing: -0.3 },
  sheetSub: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted, lineHeight: 20, marginTop: 6, marginBottom: 6 },
});
