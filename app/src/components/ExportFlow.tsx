import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as StoreReview from 'expo-store-review';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Alert, LayoutAnimation, AppState, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Asset } from 'expo-asset';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { cancelPhoneExport, exportOnPhone, hasPhoneExport } from '../../modules/autocut-export';
import { download, getJob, ServerUnreachable, startRender, uploadTake } from '../lib/api';
import { CAPTION_FONTS, UI_FONT } from '../lib/fonts';
import { nativeGrade } from '../lib/gradeFiles';
import { exportSpec } from '../lib/localExport';
import { reportError } from '../lib/crashes';
import { CAPTION_STYLES, TEXT_STYLES } from './editor/StyledText';
import { nextChange } from '../lib/live';
import { coverSource, exportBody, totalDuration, type Edit } from '../lib/edit';
import { cutFile, getCut, getCuts, getSettings, updateCut, updateSettings, type CutRecord } from '../lib/store';
import { OVERLAP } from '../lib/plans';
import { formatTime, sleep, theme } from '../lib/theme';
import { useUsage } from '../lib/usage';
import { ProgressCard } from './ProgressCard';
import { Thumb } from './Thumb';
import { Button, Logo, Wash, WASH } from './ui';
import Slider from '@react-native-community/slider';

const RESOLUTIONS = [480, 720, 1080, 1440, 2160];
const FRAME_RATES = [24, 30, 60];
const BITRATES = [4, 8, 12, 20, 30, 60];
/** A good bitrate for each resolution: what the bitrate slider starts on, and what it calls Recommended. */
const RECOMMENDED: Record<number, number> = { 480: 4, 720: 8, 1080: 12, 1440: 20, 2160: 30 };
const resLabel = (h: number) => (h === 1440 ? '2K' : h === 2160 ? '4K' : `${h}p`);
type Open = 'res' | 'fps' | 'rate' | null;

type Phase = { kind: 'sheet' } | { kind: 'exporting'; progress: number; note?: string } | { kind: 'done'; file: string; saved: boolean; assetId?: string } | { kind: 'failed'; error: string };

const stamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `Autocut ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
};

/** A row of choices that opens under its setting, like CutAI's: the picked one in a pale blue pill. */
function Pills<T extends number>({ options, value, label, onPick }: { options: T[]; value: T; label: (v: T) => string; onPick: (v: T) => void }) {
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.pills}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => {
              Haptics.selectionAsync();
              onPick(o);
            }}
            style={[styles.pill, on && styles.pillOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.pillText, on && styles.pillTextOn]}>{label(o)}</Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

/** Export sheet → "Exporting your cut… 79%" → "Your cut is ready" (saved to Photos). */
/** '9:16', '16:9', '1:1'… — the common ratio closest to the video's shape. */
function ratioLabel(aspect: number) {
  const ratios: [string, number][] = [['9:16', 9 / 16], ['3:4', 3 / 4], ['4:5', 4 / 5], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9]];
  return ratios.reduce((best, r) => (Math.abs(r[1] - aspect) < Math.abs(best[1] - aspect) ? r : best))[0];
}

/** The caption fonts as files on this phone, for the phone export (loaded once). */
let fontFiles: Promise<Record<string, string>> | null = null;
function loadFontFiles() {
  fontFiles ??= Promise.all(
    Object.entries(CAPTION_FONTS).map(async ([family, mod]) => {
      const [asset] = await Asset.loadAsync(mod);
      return [family, asset.localUri ?? asset.uri] as const;
    })
  )
    .then(Object.fromEntries)
    .catch((e) => {
      fontFiles = null;
      throw e;
    });
  return fontFiles;
}

/**
 * Runs `request`, and if the phone can't reach the server, tries again for about half a minute
 * (calling `onRetry` meanwhile) before giving up. Other errors come straight back.
 */
async function patiently<T>(request: () => Promise<T>, onRetry: () => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (e) {
      if (!(e instanceof ServerUnreachable) || attempt >= 15) throw e;
      onRetry();
      await sleep(2000);
    }
  }
}

export function ExportFlow({ cut, edit, aspect, onClose }: { cut: CutRecord; edit: Edit; aspect: number; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'sheet' });
  const overlapAllowed = useUsage().allows(OVERLAP); // a Pro and Ultimate feature
  // The server's export from an earlier attempt, so Try again picks it up instead of starting over.
  const renderId = useRef<string | null>(null);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [bitrate, setBitrate] = useState(12);
  const [open, setOpen] = useState<Open>(null);
  const toggle = (which: Open) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
    setOpen((o) => (o === which ? null : which));
  };
  const [note, setNote] = useState(true);
  const length = totalDuration(edit.clips);
  const sizeMb = Math.max(1, (length * bitrate) / 8);
  const preview = cut.source ? cutFile(cut.source).uri : undefined;
  // Leaving the screen stops a phone export that's still running.
  useEffect(() => () => cancelPhoneExport(), []);
  const firstSeconds = coverSource(edit);

  async function run() {
    let progress = 0;
    const show = (p: number, note?: string) => {
      progress = p;
      setPhase({ kind: 'exporting', progress: p, note });
    };
    const reconnecting = () => show(progress, 'Connection lost. Reconnecting…');
    const chosen = overlapAllowed ? edit : { ...edit, overlapAudio: false };
    show(0);

    // On the phone, like CapCut: no upload or download, and nothing waits on the server. Builds
    // without it (Expo Go), or a phone export that fails, use the server instead.
    async function onPhone() {
      const name = `${cut.id}-export.mp4`;
      const overlays = chosen.overlays ?? [];
      const body = exportBody(chosen, cut.words, { height, fps, bitrate }, chosen.music ? 'music' : undefined, Object.fromEntries(overlays.map((o) => [o.id, o.id])));
      const spec = exportSpec(body, { captions: CAPTION_STYLES, texts: TEXT_STYLES }, {
        source: cutFile(cut.source!).uri,
        output: cutFile(name).uri,
        music: chosen.music ? cutFile(chosen.music.file).uri : undefined,
        overlays: Object.fromEntries(overlays.map((o) => [o.id, cutFile(o.file).uri])),
        fonts: await loadFontFiles(),
        grade: nativeGrade,
      });
      await exportOnPhone(spec, (p) => show(p));
      return name;
    }

    async function onServer() {
      const id = cut.serverId;
      if (!id) throw new Error('This cut was made on another server.');
      const job = () => patiently(() => getJob(id), reconnecting);

      let render = (await job()).render;
      const resumable = render && render.id === renderId.current && render.stage !== 'failed';
      if (!resumable) {
        // The server makes one export of a cut at a time: let an older one finish first.
        while (render && ['queued', 'rendering'].includes(render.stage)) {
          show(0, 'Finishing your last export of this cut first…');
          await sleep(1500);
          render = (await job()).render;
        }
        // A song goes up first, the same way takes do, and the server mixes it in.
        let musicUpload: string | undefined;
        const music = edit.music;
        if (music) {
          show(0, 'Adding your song…');
          musicUpload = await patiently(() => uploadTake(cutFile(music.file).uri, music.mime, () => {}), reconnecting);
        }
        // Overlay photos and videos go up the same way, one by one.
        const overlayUploads: Record<string, string> = {};
        const overlays = edit.overlays ?? [];
        for (const [i, o] of overlays.entries()) {
          show(0, overlays.length > 1 ? `Adding your overlays (${i + 1} of ${overlays.length})…` : 'Adding your overlay…');
          overlayUploads[o.id] = await patiently(() => uploadTake(cutFile(o.file).uri, o.mime, () => {}), reconnecting);
        }
        renderId.current = await patiently(() => startRender(id, exportBody(chosen, cut.words, { height, fps, bitrate }, musicUpload, overlayUploads)), reconnecting);
      }
      while (true) {
        const r = (await job()).render;
        if (!r || r.id !== renderId.current) throw new Error('The export was replaced by another one.');
        if (r.stage === 'failed') {
          renderId.current = null;
          throw new Error(r.error ?? 'The export failed.');
        }
        if (r.stage === 'ready') break;
        show(0.88 * (r.progress ?? 0));
        // Pushed export progress moves the bar without asking the server; done or failed is fetched.
        for (let e; (e = await nextChange(id, 800)) && e.render?.id === renderId.current && e.render.stage === 'rendering'; ) show(0.88 * (e.render.progress ?? 0));
      }
      return await patiently(
        () => download(`/cuts/${id}/video`, `${cut.id}-export.mp4`, (f) => show(0.88 + 0.12 * f)),
        reconnecting
      );
    }

    // The screen stays on while exporting (a phone that locks itself would stop the export).
    await activateKeepAwakeAsync('export').catch(() => {});
    // iOS stops a phone export when the app goes to the background; noted here so it can start
    // again when the user comes back, rather than going to the server.
    let leftApp = false;
    const watch = AppState.addEventListener('change', (state) => {
      if (state !== 'active') leftApp = true;
    });
    const backInApp = () =>
      AppState.currentState === 'active'
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const sub = AppState.addEventListener('change', (state) => {
              if (state === 'active') {
                sub.remove();
                resolve();
              }
            });
          });
    try {
      let file: string | undefined;
      if (hasPhoneExport && cut.source && cutFile(cut.source).exists) {
        for (let attempt = 0; attempt < 3 && !file; attempt++) {
          leftApp = false;
          try {
            file = await onPhone();
          } catch (e) {
            if (!leftApp && AppState.currentState === 'active') {
              console.warn('Phone export failed, using the server:', e);
              reportError(e, 'phone export');
              show(0, 'Finishing on our servers…');
              break;
            }
            show(0, 'Paused while Autocut was in the background. Picking up again…');
            await backInApp();
          }
        }
      }
      file ??= await onServer();
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      let saved = false;
      let assetId: string | undefined;
      if (permission.granted) {
        assetId = (await MediaLibrary.Asset.create(cutFile(file).uri)).id;
        saved = true;
      }
      updateCut(cut.id, { exports: (getCut(cut.id)?.exports ?? 0) + 1, exportedAt: new Date().toISOString() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase({ kind: 'done', file, saved, assetId });
    } catch (e) {
      setPhase({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
    } finally {
      watch.remove();
      deactivateKeepAwake('export');
    }
  }

  if (phase.kind === 'sheet') {
    const recommended = RECOMMENDED[height] ?? 12;
    const rows: { key: Exclude<Open, null> | 'len' | 'size'; label: string; value: string }[] = [
      { key: 'res', label: 'Resolution', value: resLabel(height) },
      { key: 'fps', label: 'Frame rate', value: `${fps} fps` },
      { key: 'rate', label: 'Bitrate', value: `${bitrate} Mbps` },
      { key: 'len', label: 'Length', value: formatTime(length) },
      { key: 'size', label: 'Size', value: `~${sizeMb.toFixed(1)} MB` },
    ];
    return (
      <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={styles.sheet}>
          <Wash soft />
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <Thumb uri={preview} seconds={firstSeconds} style={styles.sheetThumb} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{stamp(cut.createdAt)}</Text>
              <Text style={styles.sheetMeta}>{formatTime(length)} · {ratioLabel(aspect)}</Text>
              <Text style={styles.sheetMeta}>From your original</Text>
            </View>
          </View>
          {note && (
            <View style={styles.note}>
              <SymbolView name="sparkles" tintColor={theme.blue} size={14} />
              <Text style={styles.noteText}>These settings already match your video. Tap Export and your cut saves to Photos.</Text>
              <Pressable onPress={() => setNote(false)} hitSlop={8} accessibilityLabel="Dismiss">
                <SymbolView name="xmark" tintColor={theme.faint} size={12} />
              </Pressable>
            </View>
          )}
          <View style={styles.rows}>
            {rows.map((r, i) => {
              const opens = r.key === 'res' || r.key === 'fps' || r.key === 'rate';
              const isOpen = open === r.key;
              return (
                <View key={r.key} style={[styles.rowWrap, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
                  <Pressable onPress={opens ? () => toggle(r.key as Open) : undefined} disabled={!opens} style={styles.row}>
                    <Text style={styles.rowLabel}>{r.label}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.rowValue, opens && { color: theme.blue }]}>{r.value}</Text>
                      {opens && <SymbolView name={isOpen ? 'chevron.up' : 'chevron.down'} tintColor={isOpen ? theme.blue : theme.faint} size={11} weight="semibold" />}
                    </View>
                  </Pressable>
                  {isOpen && r.key === 'res' && (
                    <Pills
                      options={RESOLUTIONS}
                      value={height}
                      label={resLabel}
                      onPick={(h) => {
                        setHeight(h);
                        setBitrate(RECOMMENDED[h] ?? 12);
                      }}
                    />
                  )}
                  {isOpen && r.key === 'fps' && <Pills options={FRAME_RATES} value={fps} label={(v) => `${v} fps`} onPick={setFps} />}
                  {isOpen && r.key === 'rate' && (
                    <Animated.View entering={FadeIn.duration(180)} style={styles.rateBox}>
                      <Slider
                        minimumValue={0}
                        maximumValue={BITRATES.length - 1}
                        step={1}
                        value={Math.max(0, BITRATES.indexOf(bitrate))}
                        onValueChange={(i) => {
                          const v = BITRATES[Math.round(i)];
                          if (v !== bitrate) Haptics.selectionAsync();
                          setBitrate(v);
                        }}
                        minimumTrackTintColor={theme.blue}
                        maximumTrackTintColor="#E3E6EE"
                      />
                      <Text style={styles.rateHint}>
                        Recommended · <Text style={{ color: theme.blue }}>{recommended} Mbps</Text>
                      </Text>
                    </Animated.View>
                  )}
                </View>
              );
            })}
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
        <Done file={phase.file} saved={phase.saved} assetId={phase.assetId} aspect={aspect} onClose={onClose} />
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
      <Wash soft />
      <Pressable onPress={onClose} disabled={!failed} hitSlop={10} style={{ alignSelf: 'flex-start', opacity: failed ? 1 : 0.25 }} accessibilityLabel="Close">
        <SymbolView name="xmark" tintColor={theme.ink} size={17} weight="semibold" />
      </Pressable>
      <View style={{ alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Text style={styles.bigTitle}>
          {failed ? 'The export didn’t finish' : <>Exporting your <Text style={{ color: theme.blue }}>cut</Text>…</>}
        </Text>
        <Text style={styles.sub}>{phase.kind === 'failed' ? phase.error : phase.kind === 'exporting' && phase.note ? phase.note : 'Keep Autocut open while it finishes'}</Text>
      </View>
      <View style={{ marginTop: 28 }}>
        <ProgressCard uri={preview} seconds={seconds} progress={phase.kind === 'exporting' ? phase.progress : 0} percent={phase.kind === 'exporting'} />
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

// The apps' own marks, for the buttons that open them.
const TIKTOK = require('../../assets/tiktok-logo.png');
const INSTAGRAM = require('../../assets/instagram-logo.png');

/** Opens Instagram with the saved video picked, or TikTok (where it's the newest video in Photos). */
async function postTo(app: 'instagram' | 'tiktok', assetId?: string) {
  const urls =
    app === 'instagram'
      ? [`instagram://library?LocalIdentifier=${encodeURIComponent((assetId ?? '').replace(/^ph:\/\//, ''))}`]
      : ['tiktok://', 'snssdk1233://'];
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // not installed under this name; try the next
    }
  }
  const name = app === 'instagram' ? 'Instagram' : 'TikTok';
  Alert.alert(`${name} isn’t installed`, `Your cut is saved in Photos, so you can post it once ${name} is on this phone.`);
}

function Done({ file, saved, assetId, aspect, onClose }: { file: string; saved: boolean; assetId?: string; aspect: number; onClose: () => void }) {
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
      <Wash soft />
      <View style={styles.doneHead}>
        <View style={{ width: 50 }} />
        <Text style={styles.doneTitle}>Your cut is <Text style={{ color: theme.blue }}>ready</Text></Text>
        <Pressable onPress={onClose} hitSlop={10} style={{ width: 50, alignItems: 'flex-end' }}>
          <Text style={styles.doneLink}>Done</Text>
        </Pressable>
      </View>
      {/* The video's own shape (9:16 for most), as tall as there's room for; never cropped. */}
      <Animated.View entering={FadeIn.duration(260)} style={[styles.donePlayer, { aspectRatio: aspect }]}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      </Animated.View>

      {rating ? (
        <Animated.View entering={SlideInDown.duration(280).easing(Easing.out(Easing.cubic))} style={styles.rateCard}>
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
          {saved && (
            <View style={styles.postRow}>
              <Button kind="outline" title="TikTok" icon={<Image source={TIKTOK} style={styles.brandIcon} accessibilityIgnoresInvertColors />} onPress={() => postTo('tiktok')} style={{ flex: 1 }} />
              <Button kind="outline" title="Instagram" icon={<Image source={INSTAGRAM} style={styles.brandIcon} accessibilityIgnoresInvertColors />} onPress={() => postTo('instagram', assetId)} style={{ flex: 1 }} />
            </View>
          )}
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
  brandIcon: { width: 22, height: 22, borderRadius: 5 },
  sheet: { flex: 1, backgroundColor: WASH[1], padding: 20, paddingTop: 10, gap: 14 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#DCDCE0', marginBottom: 6 },
  sheetHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  sheetThumb: { width: 48, height: 72, borderRadius: 8 },
  sheetTitle: { fontSize: 16, ...UI_FONT.bold, color: theme.ink },
  sheetMeta: { fontSize: 12, ...UI_FONT.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 13, ...UI_FONT.semibold, color: theme.ink, lineHeight: 18 },
  rows: { borderRadius: 16, backgroundColor: '#fff', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  rowWrap: { borderBottomWidth: 1, borderBottomColor: theme.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
  pills: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 14 },
  pill: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pillOn: { borderColor: theme.blueLine, backgroundColor: theme.blueTile },
  pillText: { fontSize: 13, ...UI_FONT.semibold, color: theme.ink },
  pillTextOn: { color: theme.blue },
  rateBox: { paddingHorizontal: 14, paddingBottom: 12, gap: 2 },
  rateHint: { fontSize: 12, ...UI_FONT.semibold, color: theme.muted },
  rowLabel: { fontSize: 15, ...UI_FONT.semibold, color: theme.ink },
  rowValue: { fontSize: 15, ...UI_FONT.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
  full: { flex: 1, backgroundColor: WASH[1], paddingHorizontal: 20 },
  bigTitle: { fontSize: 18, ...UI_FONT.semibold, color: theme.ink, textAlign: 'center' },
  sub: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, textAlign: 'center', lineHeight: 18 },
  done: { flex: 1, backgroundColor: WASH[1], paddingHorizontal: 20, gap: 14, alignItems: 'center' },
  doneHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  doneTitle: { fontSize: 17, ...UI_FONT.bold, color: theme.ink },
  doneLink: { fontSize: 16, ...UI_FONT.semibold, color: theme.ink },
  donePlayer: { flex: 1, maxWidth: '100%', borderRadius: 22, overflow: 'hidden', backgroundColor: '#000' },
  postRow: { flexDirection: 'row', gap: 10 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  rateCard: { alignSelf: 'stretch', backgroundColor: '#fff', borderRadius: 24, padding: 20, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: -4 } },
  ratePill: { fontSize: 11, ...UI_FONT.bold, color: '#fff', backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  rateTitle: { fontSize: 17, ...UI_FONT.bold, color: theme.ink, marginTop: 4 },
  stars: { flexDirection: 'row', gap: 14, marginVertical: 6 },
});
