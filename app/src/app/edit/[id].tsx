import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EditorTimeline } from '../../components/EditorTimeline';
import { ExportFlow } from '../../components/ExportFlow';
import { Button } from '../../components/ui';
import { captionLines, clipOffset, duplicateClip, isRestored, locate, removeClip, restoreCut, splitAt } from '../../lib/edit';
import { clipsDuration, cutFile, getSettings, updateCut, useCut, type Clip, type CutRecord } from '../../lib/store';
import { formatTime, theme } from '../../lib/theme';

export default function EditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cut = useCut(id);
  if (!cut?.source || cut.status !== 'ready') {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center', gap: 8 }]}>
        <Text style={styles.meta}>This cut isn’t ready to edit.</Text>
        <Button kind="text" title="Back" onPress={() => router.back()} />
      </View>
    );
  }
  return <Editor cut={cut} />;
}

// expo-video is driven by setting properties on the player object.
const seek = (player: VideoPlayer, t: number) => {
  player.currentTime = t;
};
const setMuted = (player: VideoPlayer, muted: boolean) => {
  player.muted = muted;
};

const TOOLS = [
  { icon: 'scissors', label: 'Split' },
  { icon: 'plus.square.on.square', label: 'Duplicate' },
  { icon: 'trash', label: 'Delete', danger: true },
  { icon: 'captions.bubble', label: 'Captions' },
  { icon: 'arrow.uturn.backward.circle', label: 'Restore' },
  { icon: 'speaker.wave.2', label: 'Volume' },
] as const satisfies readonly { icon: React.ComponentProps<typeof SymbolView>['name']; label: string; danger?: boolean }[];

type History = { past: Clip[][]; present: Clip[]; future: Clip[][] };

function Editor({ cut }: { cut: CutRecord }) {
  const insets = useSafeAreaInsets();
  const sourceUri = cutFile(cut.source!).uri;
  const [history, setHistory] = useState<History>({ past: [], present: cut.clips, future: [] });
  const clips = history.present;
  const [selected, setSelected] = useState(0);
  const [time, setTime] = useState(0); // edited timeline
  const [playing, setPlaying] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [captions, setCaptions] = useState(getSettings().captions);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);

  const player = useVideoPlayer(sourceUri, (p) => {
    p.timeUpdateEventInterval = 0.05;
    p.loop = false;
  });

  // The player plays the untouched source; we jump over everything that isn't in a clip.
  const clipsRef = useRef(clips);
  const clipIndex = useRef(0);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(() => {
    const subs = [
      player.addListener('playingChange', (e) => setPlaying(e.isPlaying)),
      player.addListener('timeUpdate', ({ currentTime }) => {
        const list = clipsRef.current;
        const i = Math.min(clipIndex.current, list.length - 1);
        const clip = list[i];
        if (!clip) return;
        if (currentTime >= clip[1] - 0.03) {
          if (i + 1 < list.length) {
            clipIndex.current = i + 1;
            seek(player, list[i + 1][0]);
            setTime(clipOffset(list, i + 1));
          } else {
            player.pause();
            clipIndex.current = 0;
            seek(player, list[0][0]);
            setTime(0);
          }
          return;
        }
        if (currentTime < clip[0] - 0.3) seek(player, clip[0]);
        setTime(clipOffset(list, i) + Math.max(0, currentTime - clip[0]));
      }),
      player.addListener('statusChange', ({ status }) => {
        if (status === 'readyToPlay' && clipsRef.current[0]) seek(player, clipsRef.current[0][0]);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  function goTo(t: number, list = clips) {
    const [i, source] = locate(list, Math.max(0, Math.min(t, clipsDuration(list) - 0.01)));
    clipIndex.current = i;
    seek(player, source);
    setTime(Math.max(0, Math.min(t, clipsDuration(list))));
  }

  function commit(next: Clip[], select = selected) {
    if (next === clips || !next.length) return;
    setHistory((h) => ({ past: [...h.past, h.present].slice(-50), present: next, future: [] }));
    setSelected(Math.min(select, next.length - 1));
    updateCut(cut.id, { clips: next });
    goTo(Math.min(time, clipsDuration(next) - 0.05), next);
  }

  function undo() {
    const prev = history.past.at(-1);
    if (!prev) return;
    setHistory((h) => ({ past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }));
    updateCut(cut.id, { clips: prev });
    setSelected((s) => Math.min(s, prev.length - 1));
    goTo(Math.min(time, clipsDuration(prev) - 0.05), prev);
  }

  function redo() {
    const next = history.future[0];
    if (!next) return;
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: h.future.slice(1) }));
    updateCut(cut.id, { clips: next });
    setSelected((s) => Math.min(s, next.length - 1));
    goTo(Math.min(time, clipsDuration(next) - 0.05), next);
  }

  function toggle() {
    if (playing) return player.pause();
    if (time >= clipsDuration(clips) - 0.05) goTo(0);
    player.play();
  }

  const lines = useMemo(() => captionLines(cut.words, clips), [cut.words, clips]);
  const [ci, sourceNow] = locate(clips, time);
  const caption = captions ? lines[ci]?.find((l) => sourceNow >= l.start && sourceNow < l.end) : undefined;
  const total = clipsDuration(clips);
  const restoredCount = cut.cuts.filter((c) => isRestored(clips, c)).length;

  type Tool = 'Split' | 'Duplicate' | 'Delete' | 'Captions' | 'Restore' | 'Volume';
  function runTool(tool: Tool) {
    if (tool === 'Split') commit(splitAt(clips, time), ci + 1);
    else if (tool === 'Duplicate') commit(duplicateClip(clips, selected), selected + 1);
    else if (tool === 'Delete') commit(removeClip(clips, selected));
    else if (tool === 'Captions') setCaptions(!captions);
    else if (tool === 'Restore') setRestoring(true);
    else {
      setMuted(player, !muted);
      setMutedState(!muted);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" style={{ width: 70 }}>
          <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
        </Pressable>
        <Text style={styles.brand}>Autocut</Text>
        <Pressable onPress={() => { player.pause(); setExporting(true); }} hitSlop={10} style={styles.exportBtn}>
          <SymbolView name="square.and.arrow.up" tintColor={theme.accent} size={15} />
          <Text style={styles.exportText}>Export</Text>
        </Pressable>
      </View>

      <Pressable style={styles.preview} onPress={toggle}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        {caption && (
          <View style={styles.captionWrap} pointerEvents="none">
            <Text style={styles.caption}>{caption.text}</Text>
          </View>
        )}
      </Pressable>

      <View style={styles.transport}>
        <Text style={styles.meta}>
          {formatTime(time)} / {formatTime(total)}
        </Text>
        <Pressable onPress={toggle} hitSlop={12} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <SymbolView name={playing ? 'pause.fill' : 'play.fill'} tintColor={theme.ink} size={20} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 18, width: 70, justifyContent: 'flex-end' }}>
          <Pressable onPress={undo} disabled={!history.past.length} hitSlop={8} accessibilityLabel="Undo">
            <SymbolView name="arrow.uturn.backward" tintColor={history.past.length ? theme.ink : '#C3CAD5'} size={17} />
          </Pressable>
          <Pressable onPress={redo} disabled={!history.future.length} hitSlop={8} accessibilityLabel="Redo">
            <SymbolView name="arrow.uturn.forward" tintColor={history.future.length ? theme.ink : '#C3CAD5'} size={17} />
          </Pressable>
        </View>
      </View>

      <EditorTimeline
        clips={clips}
        sourceUri={sourceUri}
        selected={selected}
        time={time}
        captions={captions}
        onSelect={(i) => {
          setSelected(i);
          goTo(clipOffset(clips, i));
        }}
        onToggleCaptions={() => setCaptions(!captions)}
      />

      <View style={[styles.toolbar, { paddingBottom: insets.bottom + 6 }]}>
        {TOOLS.map((t) => ({ ...t, icon: t.label === 'Volume' && muted ? ('speaker.slash' as const) : t.icon, disabled: t.label === 'Delete' && clips.length < 2 })).map((t) => (
          <Pressable key={t.label} onPress={() => runTool(t.label)} disabled={t.disabled} style={[styles.tool, t.disabled && { opacity: 0.35 }]} accessibilityLabel={t.label}>
            <SymbolView name={t.icon} tintColor={'danger' in t ? '#D93B3B' : theme.ink} size={20} />
            <Text style={[styles.toolText, 'danger' in t && { color: '#D93B3B' }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={restoring} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRestoring(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>
              {cut.cuts.length} cuts{restoredCount ? ` · ${restoredCount} restored` : ''}
            </Text>
            <Pressable onPress={() => setRestoring(false)} hitSlop={10}>
              <Text style={styles.sheetDone}>Done</Text>
            </Pressable>
          </View>
          <Text style={styles.sheetSub}>Autocut removed these. Tap one to put it back.</Text>
          <FlatList
            data={cut.cuts}
            keyExtractor={(_, i) => String(i)}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => {
              const back = isRestored(clips, item);
              return (
                <Pressable style={styles.cutRow} disabled={back} onPress={() => commit(restoreCut(clips, item))}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.cutReason}>
                      {item.reason.charAt(0).toUpperCase() + item.reason.slice(1)} · {(item.end - item.start).toFixed(1)}s
                    </Text>
                    {!!item.text && <Text style={styles.cutText} numberOfLines={2}>“{item.text}”</Text>}
                  </View>
                  <Text style={[styles.restore, back && { color: theme.faint }]}>{back ? 'Restored' : 'Restore'}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>

      {exporting && <ExportFlow cut={{ ...cut, clips }} captions={captions} onClose={() => setExporting(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 48 },
  brand: { fontSize: 17, fontWeight: '800', color: theme.ink },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 70, justifyContent: 'flex-end' },
  exportText: { fontSize: 15, fontWeight: '600', color: theme.accent },
  preview: { flex: 1, marginHorizontal: 56, marginVertical: 8, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' },
  captionWrap: { position: 'absolute', left: 10, right: 10, top: '62%', alignItems: 'center' },
  caption: { color: '#fff', fontSize: 20, fontWeight: '900', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 4, textShadowOffset: { width: 1, height: 1 } },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 8 },
  meta: { fontSize: 12, color: theme.muted, fontVariant: ['tabular-nums'], width: 70 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: '#fff', paddingTop: 10, marginTop: 10 },
  tool: { alignItems: 'center', gap: 4, minWidth: 50 },
  toolText: { fontSize: 10, color: theme.ink, fontWeight: '500' },
  sheet: { flex: 1, backgroundColor: '#fff' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  sheetSub: { fontSize: 13, color: theme.muted, paddingHorizontal: 20, paddingBottom: 10 },
  sheetDone: { fontSize: 16, fontWeight: '600', color: theme.accent },
  sep: { height: 1, backgroundColor: theme.line, marginHorizontal: 20 },
  cutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  cutReason: { fontSize: 15, fontWeight: '600', color: theme.cut },
  cutText: { fontSize: 14, color: theme.muted },
  restore: { fontSize: 14, fontWeight: '700', color: theme.accent },
});
