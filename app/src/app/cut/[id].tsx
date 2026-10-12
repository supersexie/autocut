import * as MediaLibrary from 'expo-media-library';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Timeline } from '../../components/Timeline';
import { downloadCut, getJob, serverUrl, uploadTake, type Stage } from '../../lib/api';
import { addCut, cutFile, getSettings, useCuts, type Cut, type CutRecord, type Segment } from '../../lib/store';
import { formatTime, sleep, theme } from '../../lib/theme';

const STAGE_LABEL: Record<Stage | 'uploading', string> = {
  uploading: 'Sending your take',
  queued: 'Waiting for the last cut to finish',
  reading: 'Reading the take',
  listening: 'Listening for every word',
  cutting: 'Finding dead air and retakes',
  rendering: 'Putting your cut together',
  ready: 'Cut ready',
  failed: "Couldn't cut this one",
};

export default function CutScreen() {
  const params = useLocalSearchParams<{ id: string; uri?: string; mime?: string; duration?: string }>();
  const saved = useCuts().find((c) => c.id === params.id);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (saved) return <ResultView record={saved} onClose={close} />;
  if (params.id === 'new' && params.uri) {
    return <NewCut uri={params.uri} mime={params.mime ?? 'video/quicktime'} initialDuration={Number(params.duration) || 0} onClose={close} />;
  }
  return <Failed message="This cut isn't on this phone any more." onClose={close} />;
}

/** Upload → server cuts it (cuts land on the timeline) → download → result. */
function NewCut({ uri, mime, initialDuration, onClose }: { uri: string; mime: string; initialDuration: number; onClose: () => void }) {
  const [stage, setStage] = useState<Stage | 'uploading'>('uploading');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [planCuts, setPlanCuts] = useState<Cut[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [record, setRecord] = useState<CutRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = getSettings();
        const base = serverUrl(settings);
        const jobId = await uploadTake(uri, mime, settings, setProgress);
        let job = await getJob(base, jobId);
        while (!cancelled) {
          setStage(job.stage);
          if (job.duration) setDuration(job.duration);
          if (job.cuts) setPlanCuts(job.cuts);
          if (job.stage === 'ready' || job.stage === 'failed') break;
          await sleep(700);
          job = await getJob(base, jobId);
        }
        if (cancelled) return;
        if (job.stage === 'failed') throw new Error(job.error ?? 'The server could not cut this take.');
        const video = await downloadCut(base, jobId);
        const firstWords = (job.segments ?? []).map((s) => s.text).join(' ').split(' ').slice(0, 7).join(' ');
        const done: CutRecord = {
          id: jobId,
          createdAt: new Date().toISOString(),
          title: firstWords || 'Untitled take',
          duration: job.duration ?? 0,
          keptDuration: job.keptDuration ?? 0,
          cuts: job.cuts ?? [],
          segments: job.segments ?? [],
          video,
        };
        addCut(done);
        setRecord(done);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, mime]);

  // Reveal cuts one at a time so the timeline fills in like a live edit.
  useEffect(() => {
    if (revealed >= planCuts.length) return;
    const t = setTimeout(() => setRevealed((n) => n + 1), Math.min(220, 1800 / planCuts.length));
    return () => clearTimeout(t);
  }, [revealed, planCuts.length]);

  if (record && revealed >= planCuts.length) return <ResultView record={record} onClose={onClose} />;
  return (
    <ProcessingView
      uri={uri}
      stage={error ? 'failed' : record ? 'rendering' : stage}
      progress={progress}
      duration={duration}
      cuts={planCuts.slice(0, revealed)}
      error={error}
      onClose={onClose}
    />
  );
}

function usePlayerTime(player: VideoPlayer) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const sub = player.addListener('timeUpdate', (e) => setTime(e.currentTime));
    return () => sub.remove();
  }, [player]);
  return time;
}

function ProcessingView(props: {
  uri: string; stage: Stage | 'uploading'; progress: number; duration: number; cuts: Cut[]; error: string | null; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(props.uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });
  const time = usePlayerTime(player);
  const failed = props.stage === 'failed';
  const label = props.stage === 'uploading' && props.progress > 0
    ? `${STAGE_LABEL.uploading} ${Math.round(props.progress * 100)}%`
    : STAGE_LABEL[props.stage];

  return (
    <View style={styles.stage}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <View />
        <RoundButton symbol="xmark" onPress={props.onClose} label="Close" />
      </View>
      <View style={[styles.panel, { bottom: insets.bottom + 12 }]}>
        {failed ? (
          <>
            <View style={styles.row}>
              <SymbolView name="exclamationmark.triangle.fill" tintColor="#FFD60A" size={18} />
              <Text style={styles.panelTitle}>{STAGE_LABEL.failed}</Text>
            </View>
            <Text style={styles.panelBody}>{props.error}</Text>
            <Pressable style={[styles.btn, styles.primary]} onPress={props.onClose}>
              <Text style={styles.btnText}>Try another video</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.row}>
              <ActivityIndicator color="#fff" />
              <Text style={[styles.panelTitle, { flex: 1 }]}>{label}</Text>
              {props.cuts.length > 0 && <Text style={styles.meta}>{props.cuts.length} cuts</Text>}
            </View>
            <Timeline duration={Math.max(props.duration, 0.1)} cuts={props.cuts} playhead={time} />
            <View style={styles.metaRow}>
              <Text style={styles.meta}>{props.cuts.at(-1) ? capitalize(props.cuts.at(-1)!.reason) : ' '}</Text>
              <Text style={styles.meta}>{props.duration ? formatTime(props.duration) : ''}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function ResultView({ record, onClose }: { record: CutRecord; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const file = cutFile(record.video);
  const player = useVideoPlayer(file.uri, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });
  const time = usePlayerTime(player);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [showCuts, setShowCuts] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const sub = player.addListener('playingChange', (e) => setPlaying(e.isPlaying));
    return () => sub.remove();
  }, [player]);

  async function save() {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) return toast.show('Allow Photos access in Settings to save');
    try {
      await MediaLibrary.Asset.create(file.uri);
      toast.show('Saved to Photos');
    } catch {
      toast.show("Couldn't save to Photos");
    }
  }

  async function share() {
    if (!(await Sharing.isAvailableAsync())) return toast.show('Sharing is not available here');
    await Sharing.shareAsync(file.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
  }

  if (!file.exists) return <Failed message="The video for this cut is missing." onClose={onClose} />;

  return (
    <View style={styles.stage}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => (playing ? player.pause() : player.play())}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        {!playing && (
          <View style={styles.bigPlay} pointerEvents="none">
            <SymbolView name="play.fill" tintColor="rgba(255,255,255,0.9)" size={56} />
          </View>
        )}
      </Pressable>

      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <RoundButton
          symbol={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'}
          label={muted ? 'Unmute' : 'Mute'}
          onPress={() => {
            setPlayerMuted(player, !muted);
            setMuted(!muted);
          }}
        />
        {toast.node}
        <RoundButton symbol="xmark" onPress={onClose} label="Close" />
      </View>

      <View style={[styles.panel, { bottom: insets.bottom + 12 }]}>
        <View style={styles.row}>
          <SymbolView name="checkmark.circle.fill" tintColor={theme.ok} size={18} />
          <Text style={[styles.panelTitle, { flex: 1 }]}>Cut ready</Text>
          <Pressable onPress={() => setShowCuts(true)} accessibilityLabel="See all cuts" hitSlop={10}>
            <Text style={styles.times}>
              <Text style={styles.before}>{formatTime(record.duration)}</Text>
              {'  →  '}
              <Text style={styles.after}>{formatTime(record.keptDuration)}</Text>
            </Text>
          </Pressable>
        </View>
        <Timeline duration={record.duration} cuts={record.cuts} segments={record.segments} playhead={sourceTime(time, record.segments)} />
        <View style={styles.actions}>
          <Pressable style={({ pressed }) => [styles.btn, styles.primary, styles.flex, pressed && styles.pressed]} onPress={save}>
            <SymbolView name="arrow.down.to.line" tintColor="#fff" size={16} />
            <Text style={styles.btnText}>Save</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.btn, styles.ghost, styles.flex, pressed && styles.pressed]} onPress={share}>
            <SymbolView name="square.and.arrow.up" tintColor="#fff" size={16} />
            <Text style={styles.btnText}>Share</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={showCuts} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCuts(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{record.cuts.length} cuts</Text>
            <Pressable onPress={() => setShowCuts(false)} hitSlop={10}>
              <Text style={styles.sheetDone}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={record.cuts}
            keyExtractor={(_, i) => String(i)}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => (
              <View style={styles.cutRow}>
                <View style={styles.cutHead}>
                  <Text style={styles.cutReason}>{capitalize(item.reason)}</Text>
                  <Text style={styles.cutTime}>
                    {item.start.toFixed(1)}s · {(item.end - item.start).toFixed(1)}s
                  </Text>
                </View>
                {!!item.text && <Text style={styles.cutText}>“{item.text}”</Text>}
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

function Failed({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <View style={[styles.stage, { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }]}>
      <Text style={[styles.panelTitle, { textAlign: 'center' }]}>{message}</Text>
      <Pressable style={[styles.btn, styles.primary, { paddingHorizontal: 24 }]} onPress={onClose}>
        <Text style={styles.btnText}>Close</Text>
      </Pressable>
    </View>
  );
}

function RoundButton({ symbol, onPress, label }: { symbol: React.ComponentProps<typeof SymbolView>['name']; onPress: () => void; label: string }) {
  return (
    <Pressable style={({ pressed }) => [styles.round, pressed && styles.pressed]} onPress={onPress} accessibilityLabel={label} hitSlop={6}>
      <SymbolView name={symbol} tintColor="#fff" size={17} weight="semibold" />
    </Pressable>
  );
}

function useToast() {
  const [text, setText] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = (message: string) => {
    setText(message);
    clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timer.current = setTimeout(() => Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(), 2200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = text ? (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Text style={styles.toastText}>{text}</Text>
    </Animated.View>
  ) : (
    <View />
  );
  return { show, node };
}

/** Maps a time in the edited video back onto the raw take's timeline. */
function sourceTime(t: number, segments: Segment[]) {
  let offset = 0;
  for (const s of segments) {
    const d = s.end - s.start;
    if (t < offset + d) return s.start + (t - offset);
    offset += d;
  }
  return segments.at(-1)?.end ?? 0;
}

// expo-video is driven by setting properties on the player.
function setPlayerMuted(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  panel: { position: 'absolute', left: 14, right: 14, borderRadius: 22, padding: 16, gap: 12, backgroundColor: 'rgba(30,34,42,0.72)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  panelBody: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 20 },
  meta: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  times: { color: '#fff', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  before: { color: 'rgba(255,255,255,0.55)', textDecorationLine: 'line-through' },
  after: { color: '#7FB0FF' },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 14 },
  flex: { flex: 1 },
  primary: { backgroundColor: theme.accent },
  ghost: { backgroundColor: 'rgba(255,255,255,0.16)' },
  pressed: { opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  bigPlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  toast: { backgroundColor: 'rgba(30,30,30,0.7)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  sheet: { flex: 1, backgroundColor: '#fff' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  sheetDone: { fontSize: 16, fontWeight: '600', color: theme.accent },
  sep: { height: 1, backgroundColor: theme.line, marginHorizontal: 20 },
  cutRow: { paddingHorizontal: 20, paddingVertical: 12, gap: 4 },
  cutHead: { flexDirection: 'row', justifyContent: 'space-between' },
  cutReason: { fontSize: 15, fontWeight: '600', color: theme.cut },
  cutTime: { fontSize: 12, color: theme.faint, fontVariant: ['tabular-nums'] },
  cutText: { fontSize: 14, color: theme.muted },
});
