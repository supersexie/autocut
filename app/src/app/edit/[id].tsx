import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutRectangle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportFlow } from '../../components/ExportFlow';
import { CaptionsPanel, FormatPanel, MusicPanel, SizePanel, SpeedPanel, StylePicker, VolumePanel } from '../../components/editor/Panels';
import { pickSong, useMusic } from '../../components/editor/music';
import { CoverPicker, Preview, ReorderStrip, TextComposer, Tour, type TextDraft, type TourStep } from '../../components/editor/Overlays';
import { Timeline } from '../../components/editor/Timeline';
import { usePlayback } from '../../components/editor/playback';
import { Button, PressableScale, type SymbolName } from '../../components/ui';
import {
  captionLines, clipOffset, coverSource, duplicateClip, framingAt, keyframeAt, putKeyframe, isRestored, locate, outDuration, removeClip, restoreCut, splitAt, totalDuration,
  trimClip, updateClip, type ClipEdit, type Edit, type Framing, type Keyframe, type TextOverlay,
} from '../../lib/edit';
import { cutFile, editOf, getSettings, saveEdit, updateSettings, useCut, type CutRecord } from '../../lib/store';
import { BRAND_FONT } from '../../lib/fonts';
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

type PanelId = 'captions' | 'captionStyle' | 'format' | 'volume' | 'speed' | 'music' | 'textStyle' | 'textSize' | null;
type History = { past: Edit[]; present: Edit; future: Edit[] };
const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const newId = () => Math.random().toString(36).slice(2, 10);

function Editor({ cut }: { cut: CutRecord }) {
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= 700; // iPad
  const sourceUri = cutFile(cut.source!).uri;
  const [history, setHistory] = useState<History>(() => ({ past: [], present: editOf(cut), future: [] }));
  const edit = history.present;
  const { clips } = edit;
  const total = totalDuration(clips);

  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>(null);
  const [focusLine, setFocusLine] = useState<string | undefined>();
  const [composer, setComposer] = useState<(TextDraft & { id?: string }) | null>(null);
  const [reorderFrom, setReorderFrom] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [choosingCover, setChoosingCover] = useState(false);
  // Keyframes: the one being framed (pinch and drag on the picture), and its framing mid-gesture.
  const [framingId, setFramingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Framing | null>(null);
  const draftRef = useRef<Framing | null>(null);
  const [exporting, setExporting] = useState(false);
  const [aspect, setAspect] = useState(9 / 16);

  const playback = usePlayback({ cutId: cut.id, serverId: cut.serverId, sourceUri, clips, muted: edit.muted });
  const { time, playing } = playback;
  useMusic(edit.music, time, playing);

  // ---- Keyframes: zoom and pan over time.
  const keyframes = edit.keyframes;
  const here = keyframeAt(keyframes, time);
  // Framing mode lasts while the playhead sits on that keyframe; playing or scrubbing away ends it.
  const adjusting = !!framingId && here?.id === framingId;
  const framing = (adjusting && draft) || framingAt(keyframes, time);

  function addKeyframe() {
    playback.pause();
    const k: Keyframe = { id: newId(), t: time, ...framingAt(keyframes, time) };
    commit({ ...edit, keyframes: putKeyframe(keyframes, k) }, { keepTime: true });
    setFramingId(k.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function deleteKeyframe(k: Keyframe) {
    commit({ ...edit, keyframes: (keyframes ?? []).filter((x) => x.id !== k.id) }, { keepTime: true });
    setFramingId(null);
  }

  function keyframeMenu(k: Keyframe) {
    playback.pause();
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Keyframe', options: ['Adjust framing', 'Delete keyframe', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) setFramingId(k.id);
        if (i === 1) deleteKeyframe(k);
      }
    );
  }

  function saveFraming() {
    const f = draftRef.current;
    const k = keyframes?.find((x) => x.id === framingId);
    draftRef.current = null;
    setDraft(null);
    if (f && k) commit({ ...edit, keyframes: putKeyframe(keyframes, { ...k, ...f }) }, { keepTime: true });
  }

  // Video shape from a frame (already rotated the way it's shown).
  useEffect(() => {
    VideoThumbnails.getThumbnailAsync(sourceUri, { time: 100 })
      .then((t) => t.width && t.height && setAspect(t.width / t.height))
      .catch(() => {});
  }, [sourceUri]);

  // ---- History: every change is undoable and saved.
  function commit(next: Edit, opts: { keepTime?: boolean } = {}) {
    setHistory((h) => ({ past: [...h.past, h.present].slice(-60), present: next, future: [] }));
    saveEdit(cut.id, next);
    if (next.clips !== clips && !opts.keepTime) playback.seek(Math.min(time, totalDuration(next.clips) - 0.05), next.clips);
  }
  const setClips = (next: ClipEdit[]) => next.length && commit({ ...edit, clips: next });

  function undo() {
    const prev = history.past.at(-1);
    if (!prev) return;
    setHistory((h) => ({ past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }));
    saveEdit(cut.id, prev);
    playback.seek(Math.min(time, totalDuration(prev.clips) - 0.05), prev.clips);
    Haptics.selectionAsync();
  }
  function redo() {
    const next = history.future[0];
    if (!next) return;
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: h.future.slice(1) }));
    saveEdit(cut.id, next);
    playback.seek(Math.min(time, totalDuration(next.clips) - 0.05), next.clips);
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
    { title: 'Your cut, clip by clip', body: 'Drag to scrub, pinch to zoom. Tap a clip, then pull its edges to trim. Hold a clip to reorder.', target: targets.timeline, cta: 'Next' },
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

  // ---- Song under the video.
  async function addSong(replace = false) {
    playback.pause();
    try {
      const music = await pickSong(cut.id, edit.music?.volume);
      if (music) commit({ ...edit, music }, { keepTime: true });
      if (music && !replace) setPanel('music');
    } catch (e) {
      Alert.alert('Couldn’t add that song', e instanceof Error ? e.message : String(e));
    }
  }

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
            playback.pause();
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
        video={playback.video}
        aspect={aspect}
        line={line}
        activeWord={activeWord}
        captionStyleId={edit.captions.style}
        captionLook={{ box: edit.captions.box, outline: edit.captions.outline }}
        texts={visibleTexts}
        selectedText={selectedText}
        fullscreen={fullscreen}
        onTap={() => (adjusting ? undefined : selectedText ? setSelectedText(null) : playback.toggle())}
        onTapText={(id) => setSelectedText(id)}
        onMoveText={(id, x, y) => updateText(id, { x, y })}
        onCloseFullscreen={() => setFullscreen(false)}
        framing={framing}
        adjusting={adjusting}
        onFrame={(f) => {
          draftRef.current = f;
          setDraft(f);
        }}
        onFrameEnd={saveFraming}
      />

      {adjusting && here ? (
        <View style={styles.transport}>
          <Pressable onPress={() => deleteKeyframe(here)} hitSlop={10} style={{ width: 120 }} accessibilityLabel="Delete keyframe">
            <SymbolView name="trash" tintColor={theme.danger} size={17} />
          </Pressable>
          <Text style={styles.framingHint}>Pinch and drag the video</Text>
          <Pressable onPress={() => setFramingId(null)} hitSlop={10} style={{ width: 120, alignItems: 'flex-end' }}>
            <Text style={styles.framingDone}>Done</Text>
          </Pressable>
        </View>
      ) : (
      <View style={styles.transport}>
        <Pressable onPress={() => setFullscreen(true)} hitSlop={10} accessibilityLabel="Full screen" style={{ width: 120 }}>
          <SymbolView name="arrow.up.left.and.arrow.down.right" tintColor={theme.ink} size={16} />
        </Pressable>
        <Pressable onPress={playback.toggle} hitSlop={14} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <SymbolView name={playing ? 'pause.fill' : 'play.fill'} tintColor={theme.ink} size={22} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 20, width: 120, justifyContent: 'flex-end', alignItems: 'center' }}>
          {/* Filled when the playhead is on a keyframe (tap for options); outlined adds one here. */}
          <Pressable
            onPress={() => (here ? keyframeMenu(here) : addKeyframe())}
            hitSlop={8}
            accessibilityLabel={here ? 'Keyframe options' : 'Add a keyframe'}
          >
            <SymbolView name={here ? 'diamond.fill' : 'diamond'} tintColor={theme.ink} size={18} />
          </Pressable>
          <Pressable onPress={undo} disabled={!history.past.length} hitSlop={8} accessibilityLabel="Undo">
            <SymbolView name="arrow.uturn.backward" tintColor={history.past.length ? theme.ink : '#C7C7CC'} size={17} />
          </Pressable>
          <Pressable onPress={redo} disabled={!history.future.length} hitSlop={8} accessibilityLabel="Redo">
            <SymbolView name="arrow.uturn.forward" tintColor={history.future.length ? theme.ink : '#C7C7CC'} size={17} />
          </Pressable>
        </View>
      </View>
      )}

      <View style={styles.bottom}>
        <View style={styles.clockRow}>
          <Text style={styles.clock}>
            {mmss(time)} / {mmss(total)}
          </Text>
          {playback.preparing && (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.preparing}>
              <ActivityIndicator size="small" color={theme.muted} style={{ transform: [{ scale: 0.7 }] }} />
              <Text style={styles.preparingText}>Smoothing playback…</Text>
            </Animated.View>
          )}
        </View>
        <View ref={timelineRef} collapsable={false}>
          <Timeline
            clips={clips}
            sourceUri={sourceUri}
            sourceDuration={cut.duration}
            time={time}
            selected={selected}
            coverSource={coverSource(edit)}
            captionsOn={edit.captions.enabled}
            music={edit.music}
            keyframes={keyframes}
            onKeyframe={(k) => {
              playback.pause();
              playback.seek(k.t);
            }}
            lines={lines}
            texts={edit.texts}
            selectedText={selectedText}
            onScrubStart={() => {
              playback.pause();
              playback.setScrubbing(true);
            }}
            onScrub={(t) => playback.seek(t)}
            onScrubEnd={() => playback.setScrubbing(false)}
            onSelectClip={(i) => {
              playback.setScrubbing(false);
              setSelectedText(null);
              if (i !== selected) playback.seek(clipOffset(clips, i) + 0.02);
              Haptics.selectionAsync();
            }}
            onTrim={(i, edges) => {
              playback.setScrubbing(false);
              setClips(trimClip(clips, i, edges, cut.duration));
            }}
            onReorderStart={(i) => setReorderFrom(i)}
            onCover={() => {
              playback.pause();
              setChoosingCover(true);
            }}
            onAudio={() => (edit.music ? setPanel('music') : addSong())}
            onCaptions={(l) => {
              playback.setScrubbing(false);
              if (l) playback.seek(l.start);
              setFocusLine(l?.key);
              setPanel('captions');
            }}
            onSelectText={(tid) => {
              playback.setScrubbing(false);
              setSelectedText(tid);
              const t = edit.texts.find((x) => x.id === tid);
              if (t) playback.seek(t.start);
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tools, wide && styles.toolsCentered]}>
            {tools.map((t) => (
              <PressableScale
                key={t.label}
                onPress={() => runTool(t.id)}
                disabled={t.disabled}
                scaleTo={0.9}
                style={[styles.tool, t.disabled && { opacity: 0.3 }]}
                accessibilityLabel={t.label}
              >
                <SymbolView name={t.icon} tintColor={t.danger ? theme.danger : theme.ink} size={20} />
                <Text style={[styles.toolText, t.danger && { color: theme.danger }]}>{t.label}</Text>
              </PressableScale>
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
            onSeek={(t) => playback.seek(t)}
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
            muted={edit.muted}
            onMute={(muted) => commit({ ...edit, muted }, { keepTime: true })}
            onDone={() => setPanel(null)}
          />
        )}
        {panel === 'music' && edit.music && (
          <MusicPanel
            key={edit.music.file}
            music={edit.music}
            onVolume={(volume) => edit.music && commit({ ...edit, music: { ...edit.music, volume } }, { keepTime: true })}
            onReplace={() => addSong(true)}
            onRemove={() => {
              commit({ ...edit, music: undefined }, { keepTime: true });
              setPanel(null);
            }}
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

      {choosingCover && (
        <CoverPicker
          clips={clips}
          sourceUri={sourceUri}
          value={edit.cover ?? 0}
          onCancel={() => setChoosingCover(false)}
          onDone={(cover) => {
            commit({ ...edit, cover }, { keepTime: true });
            setChoosingCover(false);
          }}
        />
      )}
      {exporting && <ExportFlow cut={cut} edit={edit} aspect={aspect} onClose={() => setExporting(false)} />}
      {tour >= 0 && <Tour steps={tourSteps} index={tour} onNext={() => (tour + 1 < tourSteps.length ? setTour(tour + 1) : endTour())} onSkip={endTour} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  meta: { fontSize: 13, color: theme.muted },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 46 },
  brand: { fontSize: 19, fontFamily: BRAND_FONT, color: theme.ink, letterSpacing: -0.3 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 80, justifyContent: 'flex-end' },
  exportText: { fontSize: 15, fontWeight: '700', color: theme.ink },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 40 },
  framingHint: { fontSize: 13, color: theme.muted, fontWeight: '500' },
  framingDone: { fontSize: 15, fontWeight: '700', color: theme.ink },
  bottom: { height: 330, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 12, marginTop: 6, height: 18 },
  clock: { fontSize: 11, color: theme.muted, fontVariant: ['tabular-nums'] },
  preparing: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  preparingText: { fontSize: 11, color: theme.muted, fontWeight: '500' },
  toolbar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingTop: 8, marginTop: 'auto' },
  toolBack: { paddingHorizontal: 14 },
  tools: { gap: 6, paddingHorizontal: 8 },
  toolsCentered: { flexGrow: 1, justifyContent: 'center' },
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
