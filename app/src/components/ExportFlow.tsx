import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as StoreReview from 'expo-store-review';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, SlideInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { download, getJob, startRender } from '../lib/api';
import { exportBody, totalDuration, type Edit } from '../lib/edit';
import { cutFile, getCut, getCuts, getSettings, updateCut, updateSettings, type CutRecord } from '../lib/store';
import { formatTime, sleep, theme } from '../lib/theme';
import { ProgressCard } from './ProgressCard';
import { Thumb } from './Thumb';
import { Button, Logo } from './ui';

const RESOLUTIONS = [720, 1080, 1440, 2160];
const FRAME_RATES = [24, 30, 60];
const BITRATES = [8, 12, 20, 30, 60];

type Phase = { kind: 'sheet' } | { kind: 'exporting'; progress: number } | { kind: 'done'; file: string; saved: boolean } | { kind: 'failed'; error: string };

const stamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `Autocut ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
};

function pick<T extends number>(title: string, options: T[], label: (v: T) => string, onPick: (v: T) => void) {
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...options.map(label), 'Cancel'], cancelButtonIndex: options.length },
    (i) => i < options.length && onPick(options[i])
  );
}

/** Export sheet → "Exporting your cut… 79%" → "Your cut is ready" (saved to Photos). */
export function ExportFlow({ cut, edit, onClose }: { cut: CutRecord; edit: Edit; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'sheet' });
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [bitrate, setBitrate] = useState(12);
  const [note, setNote] = useState(true);
  const length = totalDuration(edit.clips);
  const sizeMb = Math.max(1, (length * bitrate) / 8);
  const preview = cut.source ? cutFile(cut.source).uri : undefined;
  const firstSeconds = (edit.clips[0]?.start ?? 0) + 0.3;

  async function run() {
    setPhase({ kind: 'exporting', progress: 0 });
    try {
      if (!cut.serverId) throw new Error('This cut was made on another server.');
      const renderId = await startRender(cut.serverId, exportBody(edit, cut.words, { height, fps, bitrate }));
      while (true) {
        const r = (await getJob(cut.serverId)).render;
        if (!r || r.id !== renderId) throw new Error('The export was replaced by another one.');
        if (r.stage === 'failed') throw new Error(r.error ?? 'The export failed.');
        if (r.stage === 'ready') break;
        setPhase({ kind: 'exporting', progress: 0.88 * (r.progress ?? 0) });
        await sleep(500);
      }
      const file = await download(`/cuts/${cut.serverId}/video`, `${cut.id}-export.mp4`, (f) => setPhase({ kind: 'exporting', progress: 0.88 + 0.12 * f }));
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      let saved = false;
      if (permission.granted) {
        await MediaLibrary.Asset.create(cutFile(file).uri);
        saved = true;
      }
      updateCut(cut.id, { exports: (getCut(cut.id)?.exports ?? 0) + 1 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase({ kind: 'done', file, saved });
    } catch (e) {
      setPhase({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (phase.kind === 'sheet') {
    const rows: { label: string; value: string; onPress?: () => void }[] = [
      { label: 'Resolution', value: `${height}p`, onPress: () => pick('Resolution', RESOLUTIONS, (v) => `${v}p`, setHeight) },
      { label: 'Frame rate', value: `${fps} fps`, onPress: () => pick('Frame rate', FRAME_RATES, (v) => `${v} fps`, setFps) },
      { label: 'Bitrate', value: `${bitrate} Mbps`, onPress: () => pick('Bitrate', BITRATES, (v) => `${v} Mbps`, setBitrate) },
      { label: 'Length', value: formatTime(length) },
      { label: 'Size', value: `~${sizeMb.toFixed(1)} MB` },
    ];
    return (
      <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <Thumb uri={preview} seconds={firstSeconds} style={styles.sheetThumb} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{stamp(cut.createdAt)}</Text>
              <Text style={styles.sheetMeta}>{formatTime(length)} · 9:16</Text>
              <Text style={styles.sheetMeta}>From your original</Text>
            </View>
          </View>
          {note && (
            <View style={styles.note}>
              <SymbolView name="sparkles" tintColor={theme.ink} size={14} />
              <Text style={styles.noteText}>These settings already match your video. Tap Export and your cut saves to Photos.</Text>
              <Pressable onPress={() => setNote(false)} hitSlop={8} accessibilityLabel="Dismiss">
                <SymbolView name="xmark" tintColor={theme.faint} size={12} />
              </Pressable>
            </View>
          )}
          <View style={styles.rows}>
            {rows.map((r, i) => (
              <Pressable key={r.label} onPress={r.onPress} disabled={!r.onPress} style={[styles.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.rowValue}>{r.value}</Text>
                  {r.onPress && <SymbolView name="chevron.down" tintColor={theme.faint} size={11} />}
                </View>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 'auto', gap: 4 }}>
            <Button title="Export" onPress={run} />
            <Button kind="text" title="Cancel" onPress={onClose} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => phase.kind !== 'exporting' && onClose()}>
      {phase.kind === 'done' ? (
        <Done file={phase.file} saved={phase.saved} onClose={onClose} />
      ) : (
        <Exporting phase={phase} preview={preview} seconds={firstSeconds} onRetry={run} onClose={onClose} />
      )}
    </Modal>
  );
}

function Exporting({ phase, preview, seconds, onRetry, onClose }: { phase: Phase; preview?: string; seconds: number; onRetry: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const failed = phase.kind === 'failed';
  return (
    <View style={[styles.full, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <Pressable onPress={onClose} disabled={!failed} hitSlop={10} style={{ alignSelf: 'flex-start', opacity: failed ? 1 : 0.25 }} accessibilityLabel="Close">
        <SymbolView name="xmark" tintColor={theme.ink} size={17} weight="semibold" />
      </Pressable>
      <View style={{ alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Text style={styles.bigTitle}>{failed ? 'The export didn’t finish' : 'Exporting your cut…'}</Text>
        <Text style={styles.sub}>{phase.kind === 'failed' ? phase.error : 'Keep Autocut open while it finishes'}</Text>
      </View>
      <View style={{ marginTop: 28 }}>
        <ProgressCard uri={preview} seconds={seconds} progress={phase.kind === 'exporting' ? phase.progress : 0} label={phase.kind === 'exporting' ? `${Math.round(phase.progress * 100)}%` : undefined} />
      </View>
      {failed && (
        <View style={{ marginTop: 'auto', gap: 6 }}>
          <Button title="Try again" onPress={onRetry} />
          <Button kind="text" title="Back to the editor" onPress={onClose} />
        </View>
      )}
    </View>
  );
}

function Done({ file, saved, onClose }: { file: string; saved: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const uri = cutFile(file).uri;
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  // Ask how it's going once, after the first export.
  const [rating, setRating] = useState(() => !getSettings().ratingAsked && getCuts().reduce((t, c) => t + c.exports, 0) >= 1);
  const [stars, setStars] = useState(0);
  useEffect(() => {
    if (rating) updateSettings({ ratingAsked: true });
  }, [rating]);

  async function rate(n: number) {
    setStars(n);
    Haptics.selectionAsync();
    await sleep(350);
    if (n >= 4 && (await StoreReview.hasAction())) await StoreReview.requestReview();
    setRating(false);
  }

  return (
    <View style={[styles.done, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.doneHead}>
        <View style={{ width: 50 }} />
        <Text style={styles.doneTitle}>Your cut is ready</Text>
        <Pressable onPress={onClose} hitSlop={10} style={{ width: 50, alignItems: 'flex-end' }}>
          <Text style={styles.doneLink}>Done</Text>
        </Pressable>
      </View>
      <Animated.View entering={ZoomIn.springify().damping(18)} style={styles.donePlayer}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      </Animated.View>

      {rating ? (
        <Animated.View entering={SlideInDown.springify().damping(20)} style={styles.rateCard}>
          <Logo size={52} />
          <Text style={styles.ratePill}>✂ Cut #{getCuts().reduce((t, c) => t + c.exports, 0)} is out</Text>
          <Text style={styles.rateTitle}>How’s Autocut working for you?</Text>
          <Text style={styles.sub}>Rate your experience so far.</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => rate(n)} hitSlop={6} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
                <SymbolView name={n <= stars ? 'star.fill' : 'star'} tintColor={theme.ink} size={30} />
              </Pressable>
            ))}
          </View>
          <Button kind="text" title="Not now" onPress={() => setRating(false)} />
        </Animated.View>
      ) : (
        <Animated.View entering={FadeInDown.duration(220)} style={{ alignSelf: 'stretch', gap: 10 }}>
          <View style={styles.savedRow}>
            <SymbolView name={saved ? 'checkmark.circle.fill' : 'exclamationmark.circle'} tintColor={saved ? theme.ok : theme.muted} size={15} />
            <Text style={styles.sub}>{saved ? 'Saved to Photos' : 'Allow Photos access in Settings to save it there.'}</Text>
          </View>
          <Button title="Share" icon={<SymbolView name="square.and.arrow.up" tintColor="#fff" size={16} />} onPress={() => Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' })} />
          <Button
            kind="outline"
            title="Make another"
            icon={<SymbolView name="camera" tintColor={theme.ink} size={16} />}
            onPress={() => {
              onClose();
              router.dismissTo('/');
            }}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 10, gap: 14 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#DCDCE0', marginBottom: 6 },
  sheetHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  sheetThumb: { width: 48, height: 72, borderRadius: 8 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: theme.ink },
  sheetMeta: { fontSize: 12, color: theme.muted, fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 13, color: theme.ink, lineHeight: 18 },
  rows: { borderRadius: 14, borderWidth: 1, borderColor: theme.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.line },
  rowLabel: { fontSize: 15, color: theme.ink },
  rowValue: { fontSize: 15, color: theme.muted, fontVariant: ['tabular-nums'] },
  full: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 20 },
  bigTitle: { fontSize: 18, fontWeight: '600', color: theme.ink, textAlign: 'center' },
  sub: { fontSize: 13, color: theme.muted, textAlign: 'center', lineHeight: 18 },
  done: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 20, gap: 14, alignItems: 'center' },
  doneHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  doneTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  doneLink: { fontSize: 16, fontWeight: '600', color: theme.ink },
  donePlayer: { flex: 1, alignSelf: 'stretch', marginHorizontal: 30, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  rateCard: { alignSelf: 'stretch', backgroundColor: '#fff', borderRadius: 24, padding: 20, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: -4 } },
  ratePill: { fontSize: 11, fontWeight: '700', color: '#fff', backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  rateTitle: { fontSize: 17, fontWeight: '700', color: theme.ink, marginTop: 4 },
  stars: { flexDirection: 'row', gap: 14, marginVertical: 6 },
});
