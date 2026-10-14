import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, type LayoutRectangle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportFlow } from '../../components/ExportFlow';
import { CaptionsPanel, FormatPanel, SizePanel, SpeedPanel, StylePicker, VolumePanel } from '../../components/editor/Panels';
import { Preview, ReorderStrip, TextComposer, Tour, type TextDraft, type TourStep } from '../../components/editor/Overlays';
import { Timeline } from '../../components/editor/Timeline';
import { Button, type SymbolName } from '../../components/ui';
import {
  captionLines, clipOffset, duplicateClip, isRestored, locate, outDuration, removeClip, restoreCut, splitAt, totalDuration,
  trimClip, updateClip, type ClipEdit, type Edit, type TextOverlay,
} from '../../lib/edit';
import { cutFile, editOf, getSettings, saveEdit, updateSettings, useCut, type CutRecord } from '../../lib/store';
import { theme } from '../../lib/theme';

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

// expo-video is driven by setting properties on the player.
const seek = (p: VideoPlayer, t: number) => {
  p.currentTime = t;
};
const setPlayback = (p: VideoPlayer, rate: number, volume: number) => {
  p.playbackRate = rate;
  p.preservesPitch = true;
  p.volume = Math.min(1, volume);
};

type PanelId = 'captions' | 'captionStyle' | 'format' | 'volume' | 'speed' | 'textStyle' | 'textSize' | null;
type History = { past: Edit[]; present: Edit; future: Edit[] };
const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const newId = () => Math.random().toString(36).slice(2, 10);

function Editor({ cut }: { cut: CutRecord }) {
  const insets = useSafeAreaInsets();
  const sourceUri = cutFile(cut.source!).uri;
  const [history, setHistory] = useState<History>(() => ({ past: [], present: editOf(cut), future: [] }));
  const edit = history.present;
  const { clips } = edit;
  const total = totalDuration(clips);

  const [time, setTime] = useState(0);
  // Clip tools act on the clip under the playhead (tap a clip to jump into it).
  const [playing, setPlaying] = useState(false);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>(null);
  const [focusLine, setFocusLine] = useState<string | undefined>();
  const [composer, setComposer] = useState<(TextDraft & { id?: string }) | null>(null);
  const [reorderFrom, setReorderFrom] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aspect, setAspect] = useState(9 / 16);

  const player = useVideoPlayer(sourceUri, (p) => {
    p.timeUpdateEventInterval = 1 / 30;
    p.loop = false;
  });

  // Video shape from a frame (already rotated the way it's shown).
  useEffect(() => {
    VideoThumbnails.getThumbnailAsync(sourceUri, { time: 100 })
      .then((t) => t.width && t.height && setAspect(t.width / t.height))
      .catch(() => {});
  }, [sourceUri]);

  // ---- Playback: play the source, jumping between clips and applying each clip's speed/volume.
  const live = useRef({ clips, muted: edit.muted, index: 0, scrubbing: false });
  useEffect(() => {
    live.current.clips = clips;
    live.current.muted = edit.muted;
  }, [clips, edit.muted]);

  const applyClip = (i: number) => {
    const c = live.current.clips[i];
    if (c) setPlayback(player, c.speed, live.current.muted ? 0 : c.volume);
  };

  useEffect(() => {
    const subs = [
      player.addListener('playingChange', (e) => setPlaying(e.isPlaying)),
      player.addListener('timeUpdate', ({ currentTime }) => {
        const { clips: list, index, scrubbing } = live.current;
        if (scrubbing) return;
        const i = Math.min(index, list.length - 1);
        const c = list[i];
        if (!c) return;
        if (currentTime >= c.end - 0.03) {
          if (i + 1 < list.length) {
            live.current.index = i + 1;
            seek(player, list[i + 1].start);
            const n = list[i + 1];
            setPlayback(player, n.speed, live.current.muted ? 0 : n.volume);
            setTime(clipOffset(list, i + 1));
          } else {
            player.pause();
            live.current.index = 0;
            seek(player, list[0].start);
            setTime(0);
          }
          return;
        }
        if (currentTime < c.start - 0.3) seek(player, c.start);
        setTime(clipOffset(list, i) + Math.max(0, currentTime - c.start) / c.speed);
      }),
      player.addListener('statusChange', ({ status }) => {
        const first = live.current.clips[0];
        if (status === 'readyToPlay' && first && player.currentTime < first.start) {
          seek(player, first.start);
          setPlayback(player, first.speed, live.current.muted ? 0 : first.volume);
        }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  function goTo(t: number, list: ClipEdit[] = clips) {
    const clamped = Math.max(0, Math.min(t, totalDuration(list) - 0.01));
    const [i, source] = locate(list, clamped);
    live.current.index = i;
    seek(player, source);
    const c = list[i];
    if (c) setPlayback(player, c.speed, live.current.muted ? 0 : c.volume);
    setTime(clamped);
  }

  function toggle() {
    if (playing) return player.pause();
    live.current.scrubbing = false;
    if (time >= total - 0.05) goTo(0);
    applyClip(live.current.index);
    player.play();
  }

  // ---- History: every change is undoable and saved.
  function commit(next: Edit, opts: { keepTime?: boolean } = {}) {
    setHistory((h) => ({ past: [...h.past, h.present].slice(-60), present: next, future: [] }));
    saveEdit(cut.id, next);
    if (next.clips !== clips) {
      live.current.clips = next.clips;
      if (!opts.keepTime) goTo(Math.min(time, totalDuration(next.clips) - 0.05), next.clips);
    }
  }
  const setClips = (next: ClipEdit[]) => next.length && commit({ ...edit, clips: next });

  function undo() {
    const prev = history.past.at(-1);
    if (!prev) return;
    setHistory((h) => ({ past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }));
    saveEdit(cut.id, prev);
    live.current.clips = prev.clips;
    goTo(Math.min(time, totalDuration(prev.clips) - 0.05), prev.clips);
    Haptics.selectionAsync();
  }
  function redo() {
    const next = history.future[0];
    if (!next) return;
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: h.future.slice(1) }));
    saveEdit(cut.id, next);
    live.current.clips = next.clips;
    goTo(Math.min(time, totalDuration(next.clips) - 0.05), next.clips);
    Haptics.selectionAsync();
  }

  // ---- Captions and texts shown at the playhead.
  const lines = useMemo(() => captionLines(cut.words, clips, edit.captions), [cut.words, clips, edit.captions]);
  const line = edit.captions.enabled ? lines.find((l) => time >= l.start && time < l.end) : undefined;
  const activeWord = line ? Math.max(0, line.words.findLastIndex((w) => w.start <= time)) : -1;
  const visibleTexts = edit.texts.filter((t) => time >= t.start && time < t.end);
  const text = edit.texts.find((t) => t.id === selectedText);
  const updateText = (id: string, patch: Partial<TextOverlay>) => commit({ ...edit, texts: edit.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }, { keepTime: true });

  function addText(d: TextDraft) {
    // Near the end, start early enough that the text is on screen for at least a second.
    const start = Math.max(0, Math.min(time, total - 1));
    const t: TextOverlay = { ...d, id: newId(), start, end: Math.min(total, start + 3), x: 0.5, y: 0.3, scale: d.scale ?? 1 };
    commit({ ...edit, texts: [...edit.texts, t] }, { keepTime: true });
    setSelectedText(t.id);
  }

  // ---- Tour (first time only).
  const [targets, setTargets] = useState<{ timeline?: LayoutRectangle; toolbar?: LayoutRectangle; export?: LayoutRectangle }>({});
  const timelineRef = useRef<View>(null);
  const toolbarRef = useRef<View>(null);
  const exportRef = useRef<View>(null);
  const [tour, setTour] = useState(-1);
  useEffect(() => {
    if (getSettings().tourDone) return;
    const t = setTimeout(() => {
      const measure = (ref: React.RefObject<View | null>) =>
        new Promise<LayoutRectangle | undefined>((resolve) => ref.current?.measureInWindow((x, y, w, h) => resolve({ x, y, width: w, height: h })) ?? resolve(undefined));
      Promise.all([measure(timelineRef), measure(toolbarRef), measure(exportRef)]).then(([timeline, toolbar, exp]) => {
        setTargets({ timeline, toolbar, export: exp });
        setTour(0);
      });
    }, 700);
    return () => clearTimeout(t);
  }, []);
  const tourSteps: TourStep[] = [
    { title: 'Your cut, clip by clip', body: 'Drag to scrub. Tap a clip, then pull its edges to trim. Hold a clip to reorder.', target: targets.timeline, cta: 'Next' },
    { title: 'The toolbox', body: 'Split or delete clips, add text and captions, change volume and speed.', target: targets.toolbar, cta: 'Next' },
    { title: 'When it looks right', body: 'Export renders your cut and saves it to Photos.', target: targets.export, cta: 'Got it' },
  ];
  const endTour = () => {
    setTour(-1);
    updateSettings({ tourDone: true });
  };

  // ---- Toolbar: plain data, with one handler that does the work.
  const selected = locate(clips, Math.min(time, total - 0.01))[0];
  const clip = clips[selected];
  type ToolId = 'split' | 'duplicate' | 'delete' | 'text' | 'captions' | 'volume' | 'speed' | 'restore'
    | 'textEdit' | 'textStyle' | 'textSize' | 'textStart' | 'textEnd' | 'textDuplicate' | 'textDelete';
  type Tool = { id: ToolId; icon: SymbolName; label: string; disabled?: boolean; danger?: boolean };
  const clipTools: Tool[] = [
    { id: 'split', icon: 'square.split.2x1', label: 'Split' },
    { id: 'duplicate', icon: 'plus.square.on.square', label: 'Duplicate' },
    { id: 'delete', icon: 'trash', label: 'Delete', disabled: clips.length < 2, danger: true },
    { id: 'text', icon: 'textformat', label: 'Text' },
    { id: 'captions', icon: 'captions.bubble', label: 'Captions' },
    { id: 'volume', icon: 'speaker.wave.2', label: 'Volume' },
    { id: 'speed', icon: 'gauge.with.dots.needle.67percent', label: 'Speed' },
    { id: 'restore', icon: 'arrow.uturn.backward.circle', label: 'Restore' },
  ];
  const textTools: Tool[] = [
    { id: 'textEdit', icon: 'pencil', label: 'Edit' },
    { id: 'textStyle', icon: 'paintpalette', label: 'Style' },
    { id: 'textSize', icon: 'textformat.size', label: 'Size' },
    { id: 'textStart', icon: 'arrow.right.to.line', label: 'Start here' },
    { id: 'textEnd', icon: 'arrow.left.to.line', label: 'End here' },
    { id: 'textDuplicate', icon: 'plus.square.on.square', label: 'Duplicate' },
    { id: 'textDelete', icon: 'trash', label: 'Delete', danger: true },
  ];
  const tools = text ? textTools : clipTools;

  function runTool(tool: ToolId) {
    Haptics.selectionAsync();
    if (tool === 'split') setClips(splitAt(clips, time));
    else if (tool === 'duplicate') setClips(duplicateClip(clips, selected));
    else if (tool === 'delete') setClips(removeClip(clips, selected));
    else if (tool === 'text') setComposer({ text: '', style: 'classic' });
    else if (tool === 'captions') setPanel('captions');
    else if (tool === 'volume') setPanel('volume');
    else if (tool === 'speed') setPanel('speed');
    else if (tool === 'restore') setRestoring(true);
    else if (!text) return;
    else if (tool === 'textEdit') setComposer({ id: text.id, text: text.text, style: text.style, font: text.font, color: text.color, box: text.box, outline: text.outline, align: text.align, scale: text.scale });
    else if (tool === 'textStyle') setPanel('textStyle');
    else if (tool === 'textSize') setPanel('textSize');
    else if (tool === 'textStart') updateText(text.id, { start: Math.min(time, text.end - 0.2) });
    else if (tool === 'textEnd') updateText(text.id, { end: Math.max(time, text.start + 0.2) });
    else if (tool === 'textDuplicate') commit({ ...edit, texts: [...edit.texts, { ...text, id: newId(), y: Math.min(0.9, text.y + 0.08) }] }, { keepTime: true });
    else if (tool === 'textDelete') {
      commit({ ...edit, texts: edit.texts.filter((t) => t.id !== text.id) }, { keepTime: true });
      setSelectedText(null);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" style={{ width: 80 }}>
          <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
        </Pressable>
        <Text style={styles.brand}>Autocut</Text>
        <Pressable
          ref={exportRef}
          onPress={() => {
            player.pause();
            setExporting(true);
          }}
          hitSlop={10}
          style={styles.exportBtn}
        >
          <SymbolView name="square.and.arrow.up" tintColor={theme.ink} size={15} />
          <Text style={styles.exportText}>Export</Text>
        </Pressable>
      </View>

      <Preview
        player={player}
        aspect={aspect}
        line={line}
        activeWord={activeWord}
        captionStyleId={edit.captions.style}
        captionLook={{ box: edit.captions.box, outline: edit.captions.outline }}
        texts={visibleTexts}
        selectedText={selectedText}
        fullscreen={fullscreen}
        onTap={() => (selectedText ? setSelectedText(null) : toggle())}
        onTapText={(id) => setSelectedText(id)}
        onMoveText={(id, x, y) => updateText(id, { x, y })}
        onCloseFullscreen={() => setFullscreen(false)}
      />

      <View style={styles.transport}>
        <Pressable onPress={() => setFullscreen(true)} hitSlop={10} accessibilityLabel="Full screen" style={{ width: 80 }}>
          <SymbolView name="arrow.up.left.and.arrow.down.right" tintColor={theme.ink} size={16} />
        </Pressable>
        <Pressable onPress={toggle} hitSlop={14} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <SymbolView name={playing ? 'pause.fill' : 'play.fill'} tintColor={theme.ink} size={22} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 20, width: 80, justifyContent: 'flex-end' }}>
          <Pressable onPress={undo} disabled={!history.past.length} hitSlop={8} accessibilityLabel="Undo">
            <SymbolView name="arrow.uturn.backward" tintColor={history.past.length ? theme.ink : '#C7C7CC'} size={17} />
          </Pressable>
          <Pressable onPress={redo} disabled={!history.future.length} hitSlop={8} accessibilityLabel="Redo">
            <SymbolView name="arrow.uturn.forward" tintColor={history.future.length ? theme.ink : '#C7C7CC'} size={17} />
          </Pressable>
        </View>
      </View>

      <View style={styles.bottom}>
        <Text style={styles.clock}>
          {mmss(time)} / {mmss(total)}
        </Text>
        <View ref={timelineRef} collapsable={false}>
          <Timeline
            clips={clips}
            sourceUri={sourceUri}
            sourceDuration={cut.duration}
            time={time}
            selected={selected}
            muted={edit.muted}
            captionsOn={edit.captions.enabled}
            lines={lines}
            texts={edit.texts}
            selectedText={selectedText}
            onScrubStart={() => {
              player.pause();
              live.current.scrubbing = true;
            }}
            onScrub={(t) => {
              live.current.scrubbing = false;
              goTo(t);
              live.current.scrubbing = true;
            }}
            onScrubEnd={() => {
              live.current.scrubbing = false;
            }}
            onSelectClip={(i) => {
              live.current.scrubbing = false;
              setSelectedText(null);
              if (i !== selected) goTo(clipOffset(clips, i) + 0.02);
              Haptics.selectionAsync();
            }}
            onTrim={(i, edges) => {
              live.current.scrubbing = false;
              setClips(trimClip(clips, i, edges, cut.duration));
            }}
            onReorderStart={(i) => setReorderFrom(i)}
            onToggleMute={() => commit({ ...edit, muted: !edit.muted }, { keepTime: true })}
            onCaptions={(l) => {
              live.current.scrubbing = false;
              if (l) goTo(l.start);
              setFocusLine(l?.key);
              setPanel('captions');
            }}
            onSelectText={(tid) => {
              live.current.scrubbing = false;
              setSelectedText(tid);
              const t = edit.texts.find((x) => x.id === tid);
              if (t) goTo(t.start);
            }}
            onAddText={() => setComposer({ text: '', style: 'classic' })}
          />
        </View>

        <View ref={toolbarRef} collapsable={false} style={[styles.toolbar, { paddingBottom: insets.bottom + 4 }]}>
          {text && (
            <Pressable onPress={() => setSelectedText(null)} hitSlop={10} style={styles.toolBack} accessibilityLabel="Back to clips">
              <SymbolView name="chevron.left" tintColor={theme.ink} size={16} weight="semibold" />
            </Pressable>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
            {tools.map((t) => (
              <Pressable
                key={t.label}
                onPress={() => runTool(t.id)}
                disabled={t.disabled}
                style={({ pressed }) => [styles.tool, t.disabled && { opacity: 0.3 }, pressed && { opacity: 0.6 }]}
                accessibilityLabel={t.label}
              >
                <SymbolView name={t.icon} tintColor={t.danger ? theme.danger : theme.ink} size={20} />
                <Text style={[styles.toolText, t.danger && { color: theme.danger }]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {panel === 'captions' && (
          <CaptionsPanel
            settings={edit.captions}
            lines={lines}
            time={time}
            total={total}
            focusKey={focusLine}
            onChange={(captions) => commit({ ...edit, captions }, { keepTime: true })}
            onSeek={(t) => goTo(t)}
            onStyle={() => setPanel('captionStyle')}
            onFormat={() => setPanel('format')}
            onDone={() => setPanel(null)}
          />
        )}
        {panel === 'captionStyle' && (
          <StylePicker kind="captions" value={edit.captions.style} onPick={(style) => commit({ ...edit, captions: { ...edit.captions, style, box: undefined, outline: undefined } }, { keepTime: true })} onClose={() => setPanel('captions')} onDone={() => setPanel('captions')} />
        )}
        {panel === 'format' && (
          <FormatPanel settings={edit.captions} onChange={(captions) => commit({ ...edit, captions }, { keepTime: true })} onClose={() => setPanel('captions')} onDone={() => setPanel('captions')} />
        )}
        {panel === 'textStyle' && text && (
          <StylePicker kind="texts" value={text.style} onPick={(style) => updateText(text.id, { style, box: undefined, outline: undefined, color: undefined, font: undefined })} onClose={() => setPanel(null)} onDone={() => setPanel(null)} />
        )}
        {panel === 'textSize' && text && <SizePanel scale={text.scale} onChange={(scale) => updateText(text.id, { scale })} onDone={() => setPanel(null)} />}
        {panel === 'volume' && clip && (
          <VolumePanel
            volume={clip.volume}
            clipLabel={`Clip ${selected + 1} of ${clips.length}`}
            onChange={(volume) => setClips(updateClip(clips, selected, { volume }))}
            onAll={() => setClips(clips.map((c) => ({ ...c, volume: clip.volume })))}
            onDone={() => setPanel(null)}
          />
        )}
        {panel === 'speed' && clip && (
          <SpeedPanel speed={clip.speed} length={outDuration(clip)} onChange={(speed) => setClips(updateClip(clips, selected, { speed }))} onDone={() => setPanel(null)} />
        )}
        {reorderFrom !== null && (
          <ReorderStrip
            clips={clips}
            from={reorderFrom}
            sourceUri={sourceUri}
            onDone={(order) => {
              setReorderFrom(null);
              if (order.some((c, i) => c !== clips[i])) setClips(order);
            }}
          />
        )}
      </View>

      {composer && (
        <TextComposer
          initial={composer}
          sourceUri={sourceUri}
          seconds={locate(clips, time)[1]}
          onCancel={() => setComposer(null)}
          onDone={(d) => {
            if (composer.id) updateText(composer.id, d);
            else addText(d);
            setComposer(null);
          }}
        />
      )}

      <Modal visible={restoring} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRestoring(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{cut.cuts.length} cuts</Text>
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
                <Pressable style={styles.cutRow} disabled={back} onPress={() => setClips(restoreCut(clips, item))}>
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

      {exporting && <ExportFlow cut={cut} edit={edit} aspect={aspect} onClose={() => setExporting(false)} />}
      {tour >= 0 && <Tour steps={tourSteps} index={tour} onNext={() => (tour + 1 < tourSteps.length ? setTour(tour + 1) : endTour())} onSkip={endTour} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  meta: { fontSize: 13, color: theme.muted },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 46 },
  brand: { fontSize: 17, fontWeight: '800', color: theme.ink, letterSpacing: -0.3 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 80, justifyContent: 'flex-end' },
  exportText: { fontSize: 15, fontWeight: '700', color: theme.ink },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 40 },
  bottom: { height: 292, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  clock: { fontSize: 11, color: theme.muted, fontVariant: ['tabular-nums'], marginLeft: 12, marginTop: 6 },
  toolbar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingTop: 8, marginTop: 'auto' },
  toolBack: { paddingHorizontal: 14 },
  tools: { gap: 6, paddingHorizontal: 8 },
  tool: { alignItems: 'center', gap: 4, minWidth: 58, paddingVertical: 2 },
  toolText: { fontSize: 10, color: theme.ink, fontWeight: '500' },
  sheet: { flex: 1, backgroundColor: '#fff' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  sheetSub: { fontSize: 13, color: theme.muted, paddingHorizontal: 20, paddingBottom: 10 },
  sheetDone: { fontSize: 16, fontWeight: '600', color: theme.ink },
  sep: { height: 1, backgroundColor: theme.line, marginHorizontal: 20 },
  cutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  cutReason: { fontSize: 15, fontWeight: '600', color: theme.cut },
  cutText: { fontSize: 14, color: theme.muted },
  restore: { fontSize: 14, fontWeight: '700', color: theme.ink },
});
