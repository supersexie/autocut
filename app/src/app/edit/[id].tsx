import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutRectangle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportFlow } from '../../components/ExportFlow';
import { MatchSheet, SaveLookSheet } from '../../components/editor/ColorDialogs';
import { ColorPanel, type ColorScope } from '../../components/editor/ColorPanel';
import { GradedFrame, pixelsOf, useFrameAt } from '../../components/editor/GradedFrame';
import { CaptionsPanel, FormatPanel, LineEditor, MusicPanel, OverlayVolumePanel, SizePanel, SpeedPanel, StylePicker, VolumePanel } from '../../components/editor/Panels';
import { pickOverlay } from '../../components/editor/overlayMedia';
import { pickSong, useMusic } from '../../components/editor/music';
import { CoverPicker, Preview, ReorderStrip, TextComposer, Tour, type TextDraft, type TourStep } from '../../components/editor/Overlays';
import { Timeline } from '../../components/editor/Timeline';
import { usePlayback } from '../../components/editor/playback';
import { Button, Logo, PressableScale, Wash, WASH, type SymbolName } from '../../components/ui';
import {
  CAPTION_X, CAPTION_Y, captionLines, fitToLength, clipOffset, deleteCaption, splitCaption, coverSource, duplicateClip, framingAt, keyframeAt, putKeyframe, isRestored, locate, MIN_OVERLAY, outDuration, overlayHeight, overlaysAt, removeClip,
  restoreCut, retimeOverlay, splitAt, splitOverlay, totalDuration, trimClip, updateClip, type CaptionLine, type CaptionSettings, type ClipEdit, type Edit, type Framing, type Keyframe, type Overlay, type TextOverlay,
} from '../../lib/edit';
import { getWaveform } from '../../lib/api';
import { autoGrade, cleanGrade, frameStats, matchGrade, type Grade } from '../../lib/grade.mjs';
import { cutFile, editOf, getSettings, saveEdit, updateCut, updateSettings, useCut, useSettings, type CutRecord } from '../../lib/store';
import { useTours } from '../../lib/tours';
import { BRAND_FONT, UI_FONT } from '../../lib/fonts';
import { OVERLAP } from '../../lib/plans';
import { useUsage } from '../../lib/usage';
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

type PanelId = 'color' | 'captions' | 'captionStyle' | 'format' | 'volume' | 'speed' | 'music' | 'textStyle' | 'textSize' | 'overlayVolume' | null;
type History = { past: Edit[]; present: Edit; future: Edit[] };
const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const BOTTOM_H = 330;
const newId = () => Math.random().toString(36).slice(2, 10);

/** The editor for a ready cut. Also shown by the cutting screen in place, once the cut is done. */
export function Editor({ cut }: { cut: CutRecord }) {
  const insets = useSafeAreaInsets();
  const usage = useUsage();
  const wide = useWindowDimensions().width >= 700; // iPad
  const sourceUri = cutFile(cut.source!).uri;
  const [history, setHistory] = useState<History>(() => ({ past: [], present: editOf(cut), future: [] }));
  const edit = history.present;
  const { clips } = edit;
  const total = totalDuration(clips);

  // One thing at a time is selected: a text, an overlay, or a caption line (by its key).
  const [selection, setSelection] = useState<{ kind: 'text' | 'overlay' | 'caption'; id: string } | null>(null);
  const selectedText = selection?.kind === 'text' ? selection.id : null;
  const selectedOverlay = selection?.kind === 'overlay' ? selection.id : null;
  const selectedCaption = selection?.kind === 'caption' ? selection.id : null;
  const setSelectedText = (id: string | null) => setSelection(id ? { kind: 'text', id } : null);
  const setSelectedOverlay = (id: string | null) => setSelection(id ? { kind: 'overlay', id } : null);
  const [editingLine, setEditingLine] = useState<CaptionLine | null>(null);
  const [panel, setPanel] = useState<PanelId>(null);
  const [focusLine, setFocusLine] = useState<string | undefined>();
  const [composer, setComposer] = useState<(TextDraft & { id?: string }) | null>(null);
  const [reorderFrom, setReorderFrom] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // The Adjust tool: whether its changes go to every clip or just the one at the playhead, and the before/after view.
  const [colorScope, setColorScope] = useState<ColorScope>('all');
  const [compare, setCompare] = useState(false);
  const looks = useSettings().looks ?? [];
  const [restoring, setRestoring] = useState(false);
  const [choosingCover, setChoosingCover] = useState(false);
  // The keyframe a pinch is shaping right now.
  const shaping = useRef<Keyframe | null>(null);
  const [exporting, setExporting] = useState(false);
  const [aspect, setAspect] = useState(9 / 16);

  const playback = usePlayback({ cutId: cut.id, serverId: cut.serverId, sourceUri, clips, muted: edit.muted });
  const { time, playing } = playback;
  useMusic(edit.music, time, playing);

  // ---- Keyframes: zoom and pan over time. Pinch the picture and the framing is saved as a
  // keyframe at the playhead (a new one, or the one already there); the picture glides between them.
  const keyframes = edit.keyframes;
  const here = keyframeAt(keyframes, time);
  const framing = framingAt(keyframes, time);

  function addKeyframe() {
    playback.pause();
    const k: Keyframe = { id: newId(), t: time, ...framingAt(keyframes, time) };
    commit({ ...edit, keyframes: putKeyframe(keyframes, k) }, { keepTime: true });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function deleteKeyframe(k: Keyframe) {
    commit({ ...edit, keyframes: (keyframes ?? []).filter((x) => x.id !== k.id) }, { keepTime: true });
    Haptics.selectionAsync();
  }

  // A pinch writes straight into its keyframe as the fingers move (nothing held aside that could
  // go stale). The undo point is taken when the pinch starts, so a whole pinch is one undo.
  function startFraming(): Framing {
    playback.pause();
    const k = here ?? { id: newId(), t: time, ...framingAt(keyframes, time) };
    commit({ ...edit, keyframes: putKeyframe(keyframes, k) }, { keepTime: true });
    shaping.current = k;
    return { scale: k.scale, x: k.x, y: k.y };
  }

  function frameLive(f: Framing) {
    const k = shaping.current;
    if (!k) return;
    const next = { ...k, ...f };
    shaping.current = next;
    setHistory((h) => ({ ...h, present: { ...h.present, keyframes: putKeyframe(h.present.keyframes, next) } }));
  }

  function saveFraming() {
    shaping.current = null;
  }


  // Cuts made before waveforms were saved: fetch it once (the server works it out).
  useEffect(() => {
    if (cut.waveform || !cut.serverId) return;
    getWaveform(cut.serverId)
      .then((waveform) => updateCut(cut.id, { waveform }))
      .catch(() => {});
  }, [cut.id, cut.serverId, cut.waveform]);

  // Video shape from a frame (already rotated the way it's shown).
  useEffect(() => {
    VideoThumbnails.getThumbnailAsync(sourceUri, { time: 100 })
      .then((t) => t.width && t.height && setAspect(t.width / t.height))
      .catch(() => {});
  }, [sourceUri]);

  useEffect(() => {
    const t = setTimeout(() => saveEdit(cut.id, edit), 400);
    return () => clearTimeout(t);
  }, [cut.id, edit]);

  // ---- History: every change is undoable and saved.
  function commit(next: Edit, opts: { keepTime?: boolean } = {}) {
    if (next.clips !== clips) next = fitToLength(next, totalDuration(next.clips));
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
  const captionLine = lines.find((l) => l.key === selectedCaption);
  const captionPlacement = { x: edit.captions.x ?? CAPTION_X, y: edit.captions.y ?? CAPTION_Y, scale: edit.captions.scale ?? 1 };
  const setCaptions = (captions: CaptionSettings) => commit({ ...edit, captions }, { keepTime: true });
  const updateText = (id: string, patch: Partial<TextOverlay>) => commit({ ...edit, texts: edit.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }, { keepTime: true });

  // ---- Overlays: photos and videos over the picture.
  const overlays = edit.overlays ?? [];
  const overlay = overlays.find((o) => o.id === selectedOverlay);
  const visibleOverlays = overlaysAt(overlays, time);
  const setOverlays = (next: Overlay[]) => commit({ ...edit, overlays: next }, { keepTime: true });
  const updateOverlay = (id: string, patch: Partial<Overlay>) => setOverlays(overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const selectOverlay = (id: string | null) => {
    setSelectedOverlay(id);
    if (panel === 'overlayVolume' && id !== selectedOverlay) setPanel(null);
  };
  const selectCaption = (key: string) => {
    setSelection({ kind: 'caption', id: key });
    if (panel && panel !== 'captionStyle') setPanel(null);
  };

  async function addOverlay() {
    playback.pause();
    try {
      const media = await pickOverlay(cut.id);
      if (!media) return;
      const start = Math.max(0, Math.min(time, total - 1));
      const end = Math.min(total, start + Math.max(MIN_OVERLAY, media.kind === 'video' ? media.length : 3));
      // Most of the frame's width, but never taller than most of its height.
      const tall = overlayHeight({ ...media, width: 0.8 }, aspect);
      const width = tall > 0.7 ? (0.8 * 0.7) / tall : 0.8;
      const o: Overlay = { ...media, id: newId(), start, end, from: 0, x: 0.5, y: 0.5, width, rotation: 0, volume: 1 };
      commit({ ...edit, overlays: [...overlays, o] }, { keepTime: true });
      setPanel(null);
      selectOverlay(o.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      Alert.alert('Couldn’t add that', e instanceof Error ? e.message : String(e));
    }
  }

  // Moving and sizing things on the picture with fingers (overlays, text, captions) updates them
  // live; the undo point is taken at the first change, so a tap that only selects leaves nothing to undo.
  const placing = useRef(false);
  function touched() {
    playback.pause();
    placing.current = false;
  }
  function liveEdit(change: (e: Edit) => Edit) {
    const first = !placing.current;
    placing.current = true;
    setHistory((h) => {
      const present = change(h.present);
      return first ? { past: [...h.past, h.present].slice(-60), present, future: [] } : { ...h, present };
    });
  }
  const placeEnd = () => {
    placing.current = false;
  };
  function overlayTouched(id: string) {
    touched();
    if (id !== selectedOverlay) selectOverlay(id);
  }
  const overlayLive = (id: string, patch: Partial<Overlay>) =>
    liveEdit((e) => ({ ...e, overlays: (e.overlays ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

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
  const tours = useTours();
  const editorTourSeen = tours.seen('editor');
  useEffect(() => {
    if (editorTourSeen) return;
    const t = setTimeout(() => {
      const measure = (ref: React.RefObject<View | null>) =>
        new Promise<LayoutRectangle | undefined>((resolve) => ref.current?.measureInWindow((x, y, w, h) => resolve({ x, y, width: w, height: h })) ?? resolve(undefined));
      Promise.all([measure(timelineRef), measure(toolbarRef), measure(exportRef)]).then(([timeline, toolbar, exp]) => {
        setTargets({ timeline, toolbar, export: exp });
        setTour(0);
      });
    }, 700);
    return () => clearTimeout(t);
    // Decided when the cut opens; seeing the tour mid-way doesn't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tourSteps: TourStep[] = [
    { title: 'Your cut, clip by clip', accent: 'clip by clip', body: 'Drag to scrub, pinch to zoom. Tap a clip, then pull its edges to trim. Hold a clip to reorder.', target: targets.timeline, cta: 'Next' },
    { title: 'The toolbox', accent: 'toolbox', body: 'Split or delete clips, add text and captions, change volume and speed.', target: targets.toolbar, cta: 'Next' },
    { title: 'When it looks right', accent: 'right', body: 'Export renders your cut and saves it to Photos.', target: targets.export, cta: 'Got it' },
  ];
  const endTour = () => {
    setTour(-1);
    tours.done('editor');
  };

  // ---- Toolbar: plain data, with one handler that does the work.
  const selected = locate(clips, Math.min(time, total - 0.01))[0];
  const clip = clips[selected];

  // ---- Colour (the Adjust tool). Changes go to every clip, or just this one; a slider drag is one undo step.
  const colorOpen = panel === 'color';
  const frame = useFrameAt(sourceUri, locate(clips, Math.min(time, total - 0.01))[1], colorOpen);
  function applyGrade(g: Grade | undefined, live = false) {
    const change = (list: ClipEdit[]) => (colorScope === 'all' ? list.map((c) => ({ ...c, grade: g })) : list.map((c, k) => (k === selected ? { ...c, grade: g } : c)));
    if (live) liveEdit((e) => ({ ...e, clips: change(e.clips) }));
    else {
      placeEnd();
      setClips(change(clips));
    }
  }
  function autoColor() {
    const px = pixelsOf(frame);
    if (!px) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    applyGrade(cleanGrade({ ...clip?.grade, adjust: { ...clip?.grade?.adjust, ...autoGrade(frameStats(px, 16)) } }));
    showColorNote('Auto adjusted');
  }
  // Match and Save look open our own sheets; Copy, Paste and the results show a short note.
  const [matching, setMatching] = useState(false);
  const [namingLook, setNamingLook] = useState(false);
  const [colorNote, setColorNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showColorNote(text: string) {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setColorNote(text);
    noteTimer.current = setTimeout(() => setColorNote(null), 1800);
  }
  async function matchTo(pick: number) {
    setMatching(false);
    try {
      const ref = clips[pick];
      const thumb = await VideoThumbnails.getThumbnailAsync(sourceUri, { time: Math.round(((ref.start + ref.end) / 2) * 1000), quality: 0.6 });
      const { Skia } = await import('@shopify/react-native-skia');
      const refPx = pixelsOf(Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(thumb.uri)));
      const px = pixelsOf(frame);
      if (!refPx || !px) throw new Error('no frames');
      const m = matchGrade(frameStats(px, 16), frameStats(refPx, 16));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Matching is for this clip only.
      setColorScope('clip');
      const g = cleanGrade({ ...clip?.grade, adjust: { ...clip?.grade?.adjust, ...m } });
      setClips(clips.map((c, k) => (k === selected ? { ...c, grade: g } : c)));
      showColorNote(`Matched to clip ${pick + 1}`);
    } catch {
      showColorNote('Couldn’t match those clips. Try again.');
    }
  }
  function saveLook(name: string) {
    setNamingLook(false);
    const g = cleanGrade(clip?.grade);
    if (!g) return;
    const list = getSettings().looks ?? [];
    const id = String(Math.max(0, ...list.map((l) => Number(l.id) || 0)) + 1); // one more than any before
    updateSettings({ looks: [{ id, name: name.trim().slice(0, 18) || `Look ${list.length + 1}`, grade: g }, ...list].slice(0, 12) });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showColorNote('Saved to Filters');
  }
  type ToolId = 'split' | 'duplicate' | 'delete' | 'text' | 'captions' | 'adjust' | 'volume' | 'speed' | 'restore'
    | 'textEdit' | 'textStyle' | 'textSize' | 'textStart' | 'textEnd' | 'textDuplicate' | 'textDelete'
    | 'overlay' | 'overlaySplit' | 'overlayDuplicate' | 'overlayMute' | 'overlayVolume' | 'overlayFront' | 'overlayDelete'
    | 'captionEdit' | 'captionSplit' | 'captionDelete' | 'captionStyle' | 'captionAll';
  /** `divider`: a thin line after this tool, between the clip's own tools and the ones that add things. */
  type Tool = { id: ToolId; icon: SymbolName; label: string; disabled?: boolean; danger?: boolean; divider?: boolean };
  const clipTools: Tool[] = [
    { id: 'split', icon: 'square.split.2x1', label: 'Split' },
    { id: 'duplicate', icon: 'plus.square.on.square', label: 'Duplicate' },
    { id: 'delete', icon: 'trash', label: 'Delete', disabled: clips.length < 2, danger: true, divider: true },
    { id: 'text', icon: 'textformat', label: 'Text' },
    { id: 'captions', icon: 'captions.bubble', label: 'Captions' },
    { id: 'overlay', icon: 'photo.on.rectangle', label: 'Overlay' },
    { id: 'adjust', icon: 'slider.horizontal.3', label: 'Adjust' },
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
  const overlayIsVideo = overlay?.kind === 'video';
  const overlayTools: Tool[] = [
    { id: 'overlay', icon: 'plus', label: 'Add' },
    { id: 'overlaySplit', icon: 'square.split.2x1', label: 'Split', disabled: !overlay || time - overlay.start < MIN_OVERLAY || overlay.end - time < MIN_OVERLAY },
    { id: 'overlayDuplicate', icon: 'plus.square.on.square', label: 'Duplicate' },
    ...(overlayIsVideo
      ? ([
          { id: 'overlayMute', icon: overlay?.muted ? 'speaker.slash' : 'speaker.wave.2', label: overlay?.muted ? 'Unmute' : 'Mute' },
          { id: 'overlayVolume', icon: 'speaker.wave.3', label: 'Volume' },
        ] satisfies Tool[])
      : []),
    { id: 'overlayFront', icon: 'square.3.layers.3d.top.filled', label: 'To front', disabled: overlays.at(-1)?.id === overlay?.id },
    { id: 'overlayDelete', icon: 'trash', label: 'Delete', danger: true },
  ];
  const captionSplit = captionLine ? splitCaption(edit.captions, captionLine, time) : null;
  const captionTools: Tool[] = [
    { id: 'captionEdit', icon: 'pencil', label: 'Edit' },
    { id: 'captionSplit', icon: 'square.split.2x1', label: 'Split', disabled: !captionSplit },
    { id: 'captionDelete', icon: 'trash', label: 'Delete', danger: true },
    { id: 'captionStyle', icon: 'textformat', label: 'Style' },
    { id: 'captionAll', icon: 'list.bullet', label: 'All captions' },
  ];
  const tools = overlay ? overlayTools : text ? textTools : captionLine ? captionTools : clipTools;

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
    else if (tool === 'adjust') {
      playback.pause();
      setPanel('color');
    }
    else if (tool === 'volume') setPanel('volume');
    else if (tool === 'speed') setPanel('speed');
    else if (tool === 'restore') setRestoring(true);
    else if (tool === 'overlay') addOverlay();
    else if (captionLine && tool.startsWith('caption')) {
      if (tool === 'captionEdit') {
        playback.pause();
        setEditingLine(captionLine);
      } else if (tool === 'captionSplit' && captionSplit) setCaptions(captionSplit);
      else if (tool === 'captionDelete') {
        setCaptions(deleteCaption(edit.captions, captionLine));
        setSelection(null);
      } else if (tool === 'captionStyle') setPanel('captionStyle');
      else if (tool === 'captionAll') {
        setFocusLine(captionLine.key);
        setPanel('captions');
      }
    }
    else if (overlay) {
      if (tool === 'overlaySplit') {
        const next = splitOverlay(overlays, overlay.id, time, newId);
        if (next !== overlays) setOverlays(next);
      } else if (tool === 'overlayDuplicate') {
        const copy = { ...overlay, id: newId(), x: Math.min(0.95, overlay.x + 0.05), y: Math.min(0.95, overlay.y + 0.05) };
        setOverlays([...overlays, copy]);
        setSelectedOverlay(copy.id);
      } else if (tool === 'overlayMute') updateOverlay(overlay.id, { muted: !overlay.muted });
      else if (tool === 'overlayVolume') setPanel('overlayVolume');
      else if (tool === 'overlayFront') setOverlays([...overlays.filter((o) => o.id !== overlay.id), overlay]);
      else if (tool === 'overlayDelete') {
        setOverlays(overlays.filter((o) => o.id !== overlay.id));
        setSelectedOverlay(null);
        if (panel === 'overlayVolume') setPanel(null);
      }
    } else if (!text) return;
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
      <Wash />
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" style={{ width: 82 }}>
          <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
        </Pressable>
        <View style={styles.brandRow}>
          <Logo size={24} />
          <Text style={styles.brand}>Autocut</Text>
        </View>
        <Pressable
          ref={exportRef}
          onPress={() => {
            playback.pause();
            setExporting(true);
          }}
          hitSlop={10}
          style={styles.exportBtn}
        >
          <Text style={styles.exportText}>Export</Text>
        </Pressable>
      </View>

      <Preview
        video={playback.video}
        graded={colorOpen ? (w, h) => <GradedFrame image={frame} grade={clip?.grade} width={w} height={h} split={compare ? w / 2 : 0} /> : undefined}
        aspect={aspect}
        line={line}
        activeWord={activeWord}
        captionStyleId={edit.captions.style}
        captionLook={{ box: edit.captions.box, outline: edit.captions.outline, color: edit.captions.color }}
        captionPlacement={captionPlacement}
        captionSelected={!!selectedCaption}
        onCaptionTouch={() => {
          touched();
          if (line) selectCaption(line.key);
        }}
        onCaptionChange={(p) => liveEdit((e) => ({ ...e, captions: { ...e.captions, ...p } }))}
        onCaptionEdit={() => {
          playback.pause();
          if (line) setEditingLine(line);
        }}
        onPlaceEnd={placeEnd}
        texts={visibleTexts}
        selectedText={selectedText}
        fullscreen={fullscreen}
        onTap={() => (selection ? selectOverlay(null) : playback.toggle())}
        onTextTouch={(id) => {
          touched();
          if (id !== selectedText) setSelectedText(id);
        }}
        onTextChange={(id, p) => liveEdit((e) => ({ ...e, texts: e.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) }))}
        onTextEdit={(id) => {
          const t = edit.texts.find((x) => x.id === id);
          if (t) setComposer({ id: t.id, text: t.text, style: t.style, font: t.font, color: t.color, box: t.box, outline: t.outline, align: t.align, scale: t.scale });
        }}
        onCloseFullscreen={() => setFullscreen(false)}
        framing={framing}
        onFrameStart={startFraming}
        onFrame={frameLive}
        onFrameEnd={saveFraming}
        overlays={visibleOverlays}
        selectedOverlay={selectedOverlay}
        time={time}
        playing={playing}
        onOverlayStart={overlayTouched}
        onOverlayChange={overlayLive}
        onOverlayEnd={placeEnd}
      />

      <View style={styles.transport}>
        <Pressable onPress={() => setFullscreen(true)} hitSlop={10} accessibilityLabel="Full screen" style={{ width: 120 }}>
          <SymbolView name="arrow.up.left.and.arrow.down.right" tintColor={theme.ink} size={16} />
        </Pressable>
        <Pressable onPress={playback.toggle} hitSlop={14} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <SymbolView name={playing ? 'pause.fill' : 'play.fill'} tintColor={theme.ink} size={22} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 20, width: 120, justifyContent: 'flex-end', alignItems: 'center' }}>
          {/* Filled on a keyframe (tap to remove it); outlined adds one here. Pinching the video adds one too. */}
          <Pressable onPress={() => (here ? deleteKeyframe(here) : addKeyframe())} hitSlop={8} accessibilityLabel={here ? 'Remove this keyframe' : 'Add a keyframe'}>
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

      <View style={[styles.bottom, overlays.length > 0 && { height: BOTTOM_H + 40 }]}>
        <View style={styles.clockRow}>
          <Text style={styles.clock}>
            {/* The length is rounded, like Photos and the export sheet show it; the playhead counts whole seconds. */}
            <Text style={styles.clockNow}>{mmss(time)}</Text> / {mmss(Math.round(total))}
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
            waveform={cut.waveform}
            muted={edit.muted}
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
              selectOverlay(null);
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
            selectedCaption={selectedCaption}
            onCaptions={(l) => {
              playback.setScrubbing(false);
              if (!l) {
                setFocusLine(undefined);
                setPanel('captions');
                return;
              }
              // A caption block selects that caption, like CutAI: move it, resize it, edit, split or delete it.
              playback.pause();
              playback.seek(l.start + 0.01);
              selectCaption(l.key);
              Haptics.selectionAsync();
            }}
            onSelectText={(tid) => {
              playback.setScrubbing(false);
              setSelectedOverlay(null);
              setSelectedText(tid);
              const t = edit.texts.find((x) => x.id === tid);
              if (t) playback.seek(t.start);
            }}
            onAddText={() => setComposer({ text: '', style: 'classic' })}
            overlays={overlays}
            selectedOverlay={selectedOverlay}
            onSelectOverlay={(oid) => {
              playback.setScrubbing(false);
              playback.pause();
              selectOverlay(oid);
              const o = overlays.find((x) => x.id === oid);
              // Onto the overlay, so it shows (unless the playhead is already on it).
              if (o && (time < o.start || time >= o.end)) playback.seek(o.start + 0.01);
              Haptics.selectionAsync();
            }}
            onRetimeOverlay={(oid, change) => {
              const o = overlays.find((x) => x.id === oid);
              if (o) setOverlays(overlays.map((x) => (x.id === oid ? retimeOverlay(o, change, total) : x)));
            }}
            onAddOverlay={addOverlay}
          />
        </View>

        <View ref={toolbarRef} collapsable={false} style={[styles.toolbar, { paddingBottom: insets.bottom + 4 }]}>
          {(text || overlay || captionLine) && (
            <Pressable onPress={() => selectOverlay(null)} hitSlop={10} style={styles.toolBack} accessibilityLabel="Back to clips">
              <SymbolView name="chevron.left" tintColor={theme.ink} size={16} weight="semibold" />
            </Pressable>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tools, wide && styles.toolsCentered]}>
            {tools.map((t) => (
              <Fragment key={t.label}>
                <PressableScale
                  onPress={() => runTool(t.id)}
                  disabled={t.disabled}
                  scaleTo={0.9}
                  style={[styles.tool, t.disabled && { opacity: 0.3 }]}
                  accessibilityLabel={t.label}
                >
                  <SymbolView name={t.icon} tintColor={t.danger ? theme.danger : theme.ink} size={20} weight="semibold" />
                  <Text style={[styles.toolText, t.danger && { color: theme.danger }]}>{t.label}</Text>
                </PressableScale>
                {t.divider && <View style={styles.toolDivider} />}
              </Fragment>
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
          <StylePicker
            kind="captions"
            value={edit.captions.style}
            onPick={(style) => commit({ ...edit, captions: { ...edit.captions, style, box: undefined, outline: undefined } }, { keepTime: true })}
            color={edit.captions.color}
            onColor={(color) => commit({ ...edit, captions: { ...edit.captions, color } }, { keepTime: true })}
            onClose={() => setPanel(captionLine ? null : 'captions')}
            onDone={() => setPanel(captionLine ? null : 'captions')}
          />
        )}
        {panel === 'format' && (
          <FormatPanel settings={edit.captions} onChange={(captions) => commit({ ...edit, captions }, { keepTime: true })} onClose={() => setPanel('captions')} onDone={() => setPanel('captions')} />
        )}
        {panel === 'textStyle' && text && (
          <StylePicker kind="texts" value={text.style} onPick={(style) => updateText(text.id, { style, box: undefined, outline: undefined, color: undefined, font: undefined })} onClose={() => setPanel(null)} onDone={() => setPanel(null)} />
        )}
        {panel === 'textSize' && text && <SizePanel scale={text.scale} onChange={(scale) => updateText(text.id, { scale })} onDone={() => setPanel(null)} />}
        {colorOpen && clip && (
          <ColorPanel
            grade={clip.grade}
            scope={colorScope}
            onScope={setColorScope}
            clipLabel={`Clip ${selected + 1} of ${clips.length}`}
            onClipStep={clips.length > 1 ? (by) => playback.seek(clipOffset(clips, (selected + by + clips.length) % clips.length) + 0.02) : undefined}
            onChange={applyGrade}
            onEnd={placeEnd}
            compare={compare}
            onCompare={() => setCompare((c) => !c)}
            onAuto={autoColor}
            canMatch={clips.length > 1}
            onMatch={() => setMatching(true)}
            looks={looks}
            onSaveLook={() => setNamingLook(true)}
            note={colorNote}
            onNote={showColorNote}
            frame={frame}
            onDone={() => {
              setPanel(null);
              setCompare(false);
            }}
          />
        )}
        {panel === 'color' && (
          <>
            <MatchSheet visible={matching} clips={clips} current={selected} sourceUri={sourceUri} onPick={matchTo} onClose={() => setMatching(false)} />
            <SaveLookSheet visible={namingLook} suggested={`Look ${looks.length + 1}`} onSave={saveLook} onClose={() => setNamingLook(false)} />
          </>
        )}
        {panel === 'volume' && clip && (
          <VolumePanel
            volume={clip.volume}
            clipLabel={`Clip ${selected + 1} of ${clips.length}`}
            onChange={(volume) => setClips(updateClip(clips, selected, { volume }))}
            onAll={() => setClips(clips.map((c) => ({ ...c, volume: clip.volume })))}
            muted={edit.muted}
            onMute={(muted) => commit({ ...edit, muted }, { keepTime: true })}
            overlap={edit.overlapAudio !== false}
            overlapLocked={!usage.allows(OVERLAP)}
            onOverlap={(overlapAudio) => commit({ ...edit, overlapAudio }, { keepTime: true })}
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
        {panel === 'overlayVolume' && overlay && (
          <OverlayVolumePanel
            key={overlay.id}
            volume={overlay.volume}
            muted={!!overlay.muted}
            onChange={(volume) => updateOverlay(overlay.id, { volume })}
            onMute={(muted) => updateOverlay(overlay.id, { muted })}
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

      {editingLine && (
        <LineEditor
          line={editingLine}
          settings={edit.captions}
          onSettings={(captions) => commit({ ...edit, captions }, { keepTime: true })}
          onDone={(t) => {
            const l = editingLine;
            setEditingLine(null);
            if (t && t !== l.text) setCaptions({ ...edit.captions, edits: { ...edit.captions.edits, [l.key]: t } });
          }}
        />
      )}
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
  screen: { flex: 1, backgroundColor: WASH[1] }, // with the blue wash behind
  meta: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 46 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brand: { fontSize: 19, fontFamily: BRAND_FONT, color: theme.ink, letterSpacing: -0.3 },
  // The same width as the back button, so the name stays centred.
  exportBtn: { width: 82, height: 30, alignItems: 'flex-end', justifyContent: 'center' },
  exportText: { fontSize: 17, ...UI_FONT.bold, color: theme.blue },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 40 },
  bottom: { height: BOTTOM_H, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 12, marginTop: 6, height: 18 },
  clock: { fontSize: 11, ...UI_FONT.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
  clockNow: { ...UI_FONT.bold, color: theme.ink },
  preparing: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  preparingText: { fontSize: 11, color: theme.muted, ...UI_FONT.semibold },
  toolbar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingTop: 8, marginTop: 'auto' },
  toolBack: { paddingHorizontal: 14 },
  tools: { gap: 6, paddingHorizontal: 8 },
  toolsCentered: { flexGrow: 1, justifyContent: 'center' },
  tool: { alignItems: 'center', gap: 4, minWidth: 58, paddingVertical: 2 },
  toolText: { fontSize: 11, color: theme.ink, ...UI_FONT.bold },
  toolDivider: { width: 1, height: 30, borderRadius: 0.5, backgroundColor: 'rgba(17,17,20,0.12)', alignSelf: 'center', marginHorizontal: 4 },
  sheet: { flex: 1, backgroundColor: '#fff' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 4 },
  sheetTitle: { fontSize: 17, ...UI_FONT.bold, color: theme.ink },
  sheetSub: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, paddingHorizontal: 20, paddingBottom: 10 },
  sheetDone: { fontSize: 16, ...UI_FONT.semibold, color: theme.ink },
  sep: { height: 1, backgroundColor: theme.line, marginHorizontal: 20 },
  cutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  cutReason: { fontSize: 15, ...UI_FONT.semibold, color: theme.cut },
  cutText: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted },
  restore: { fontSize: 14, ...UI_FONT.bold, color: theme.ink },
});
