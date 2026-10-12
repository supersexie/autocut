import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { download, getJob, startRender } from '../lib/api';
import { clipsDuration, cutFile, getCut, updateCut, type CutRecord } from '../lib/store';
import { formatTime, sleep, theme } from '../lib/theme';
import { Thumb } from './Thumb';
import { Backdrop, Button } from './ui';

const RESOLUTIONS = [
  { label: '720p', height: 720, mbps: 6 },
  { label: '1080p', height: 1080, mbps: 12 },
  { label: 'Original', height: undefined, mbps: 16 },
];
const FRAME_RATES = [
  { label: '30 fps', fps: 30 },
  { label: '60 fps', fps: 60 },
  { label: 'Original', fps: undefined },
];

type Phase = { kind: 'sheet' } | { kind: 'exporting'; progress: number } | { kind: 'done'; file: string; saved: boolean } | { kind: 'failed'; error: string };

/** Export sheet → "Exporting your cut… 79%" → "Your cut is ready" (saved to Photos). */
export function ExportFlow({ cut, captions, onClose }: { cut: CutRecord; captions: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'sheet' });
  const [res, setRes] = useState(1);
  const [rate, setRate] = useState(0);
  const [withCaptions, setWithCaptions] = useState(captions);
  const length = clipsDuration(cut.clips);
  const resolution = RESOLUTIONS[res];
  const sizeMb = Math.max(1, Math.round((length * resolution.mbps) / 8));
  const preview = cut.source ? cutFile(cut.source).uri : undefined;

  async function run() {
    setPhase({ kind: 'exporting', progress: 0 });
    try {
      if (!cut.serverId) throw new Error('This cut was made on another server.');
      const renderId = await startRender(cut.serverId, cut.clips, { captions: withCaptions, height: resolution.height, fps: FRAME_RATES[rate].fps });
      while (true) {
        const job = await getJob(cut.serverId);
        const r = job.render;
        if (!r || r.id !== renderId) throw new Error('The export was replaced by another one.');
        if (r.stage === 'failed') throw new Error(r.error ?? 'The export failed.');
        if (r.stage === 'ready') break;
        setPhase({ kind: 'exporting', progress: 0.85 * (r.progress ?? 0) });
        await sleep(600);
      }
      const file = await download(`/cuts/${cut.serverId}/video`, `${cut.id}-export.mp4`, (f) => setPhase({ kind: 'exporting', progress: 0.85 + 0.15 * f }));
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      let saved = false;
      if (permission.granted) {
        await MediaLibrary.Asset.create(cutFile(file).uri);
        saved = true;
      }
      updateCut(cut.id, { exports: (getCut(cut.id)?.exports ?? 0) + 1 });
      setPhase({ kind: 'done', file, saved });
    } catch (e) {
      setPhase({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (phase.kind === 'sheet') {
    return (
      <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Thumb uri={preview} seconds={(cut.clips[0]?.[0] ?? 0) + 0.3} style={styles.sheetThumb} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{cut.title}</Text>
              <Text style={styles.sheetMeta}>{formatTime(length)} · {cut.clips.length} clips</Text>
              <Text style={styles.sheetMeta}>From your original</Text>
            </View>
          </View>
          <View style={styles.note}>
            <SymbolView name="sparkles" tintColor={theme.accent} size={14} />
            <Text style={styles.noteText}>These settings already match your video. Tap Export and your cut saves to Photos.</Text>
          </View>

          <View style={styles.rows}>
            <Row label="Resolution" value={resolution.label} onPress={() => setRes((res + 1) % RESOLUTIONS.length)} />
            <Row label="Frame rate" value={FRAME_RATES[rate].label} onPress={() => setRate((rate + 1) % FRAME_RATES.length)} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Captions</Text>
              <Switch value={withCaptions} onValueChange={setWithCaptions} />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Length</Text>
              <Text style={styles.rowValue}>{formatTime(length)}</Text>
            </View>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Text style={styles.rowLabel}>Size</Text>
              <Text style={styles.rowValue}>~{sizeMb} MB</Text>
            </View>
          </View>

          <View style={{ marginTop: 'auto', gap: 8 }}>
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
        <Backdrop
          footer={phase.kind === 'failed' ? (
            <>
              <Button title="Try again" onPress={run} />
              <Button kind="text" title="Back to the editor" onPress={onClose} />
            </>
          ) : undefined}
        >
          <View style={{ alignItems: 'center', marginTop: 40, gap: 6 }}>
            <Text style={styles.bigTitle}>{phase.kind === 'failed' ? 'The export didn’t finish' : 'Exporting your cut…'}</Text>
            <Text style={styles.sub}>{phase.kind === 'failed' ? phase.error : 'Keep Autocut open while it finishes.'}</Text>
          </View>
          <Thumb uri={preview} seconds={(cut.clips[0]?.[0] ?? 0) + 0.3} style={styles.card}>
            <View style={styles.shade} />
            {phase.kind === 'exporting' && <Text style={styles.percent}>{Math.round(phase.progress * 100)}%</Text>}
          </Thumb>
        </Backdrop>
      )}
    </Modal>
  );
}

function Done({ file, saved, onClose }: { file: string; saved: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const uri = cutFile(file).uri;
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <View style={[styles.done, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.doneHead}>
        <View style={{ width: 50 }} />
        <Text style={styles.doneTitle}>Your cut is ready</Text>
        <Pressable onPress={onClose} hitSlop={10} style={{ width: 50, alignItems: 'flex-end' }}>
          <Text style={styles.doneLink}>Done</Text>
        </Pressable>
      </View>
      <View style={styles.donePlayer}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      </View>
      <Text style={styles.sub}>{saved ? 'Saved to Photos.' : 'Allow Photos access in Settings to save it there, or share it below.'}</Text>
      <Button
        title="Share"
        icon={<SymbolView name="square.and.arrow.up" tintColor="#fff" size={16} />}
        onPress={() => Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' })}
        style={{ alignSelf: 'stretch' }}
      />
    </View>
  );
}

function Row({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityHint="Changes this setting">
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={styles.rowValue}>{value}</Text>
        <SymbolView name="chevron.up.chevron.down" tintColor={theme.faint} size={12} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#fff', padding: 20, gap: 16 },
  sheetHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  sheetThumb: { width: 48, height: 72, borderRadius: 8 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: theme.ink },
  sheetMeta: { fontSize: 12, color: theme.muted, fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: theme.bg, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 13, color: theme.ink, lineHeight: 18 },
  rows: { borderRadius: 14, borderWidth: 1, borderColor: theme.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.line },
  rowLabel: { fontSize: 15, color: theme.ink },
  rowValue: { fontSize: 15, color: theme.muted, fontVariant: ['tabular-nums'] },
  bigTitle: { fontSize: 20, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  sub: { fontSize: 13, color: theme.muted, textAlign: 'center', lineHeight: 18 },
  card: { width: 170, height: 300, borderRadius: 20, alignSelf: 'center', marginTop: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: theme.accent, backgroundColor: '#1E2633' },
  shade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
  percent: { color: '#fff', fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  done: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 20, gap: 14, alignItems: 'center' },
  doneHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  doneTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  doneLink: { fontSize: 16, fontWeight: '600', color: theme.accent },
  donePlayer: { flex: 1, alignSelf: 'stretch', marginHorizontal: 30, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000' },
});
