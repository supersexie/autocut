import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Logo } from '../../components/ui';
import { TAB_BAR_HEIGHT, tabBarStyle } from '../../components/tabBar';
import { useAuth } from '../../lib/auth';
import type { Take } from '../../lib/jobs';
import { folderName, useCuts, useFolders, useSettings } from '../../lib/store';
import { AddVideoSheet, FolderSheet } from '../../components/CameraSheets';
import { BRAND_FONT } from '../../lib/fonts';
import { formatTime, theme } from '../../lib/theme';

const LENGTHS = [
  { label: '60s', seconds: 60 },
  { label: '3m', seconds: 180 },
  { label: '10m', seconds: 600 },
  { label: '20m', seconds: 1200 },
];

type Mode = 'idle' | 'recording' | 'paused';

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const navigation = useNavigation();
  const { account } = useAuth();
  const cuts = useCuts();
  const { mirrorSelfie, saveFolder } = useSettings();
  const [camPermission, requestCam] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const startedAt = useRef(0);
  const finishWhenStopped = useRef(false);

  const [focused, setFocused] = useState(true);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [torch, setTorch] = useState(false);
  const [limit, setLimit] = useState(60);
  const [mode, setMode] = useState<Mode>('idle');
  const [takes, setTakes] = useState<Take[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [showTip, setShowTip] = useState(true);
  const [sheet, setSheet] = useState<'folder' | 'add' | null>(null);
  useFolders(); // re-render when a folder is renamed

  // Keep the camera running until the next screen has slid in, so the transition never flashes black.
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useFocusEffect(
    useCallback(() => {
      clearTimeout(blurTimer.current);
      setFocused(true);
      return () => {
        blurTimer.current = setTimeout(() => setFocused(false), 700);
      };
    }, [])
  );

  // Hide the tab bar while a take is in progress so the controls own the bottom of the screen.
  const busy = mode !== 'idle' || takes.length > 0;
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: busy ? { display: 'none' } : tabBarStyle(screen.width) });
  }, [busy, navigation, screen.width]);

  useEffect(() => {
    if (mode !== 'recording') return;
    const timer = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
    return () => clearInterval(timer);
  }, [mode]);

  const recorded = takes.reduce((t, k) => t + k.duration, 0);
  const total = recorded + (mode === 'recording' ? elapsed : 0);

  function review(list: Take[]) {
    setTakes([]);
    setMode('idle');
    router.push({ pathname: '/review', params: { takes: JSON.stringify(list) } });
  }

  async function record() {
    if (!camera.current || !ready) return;
    if (!micPermission?.granted && !(await requestMic()).granted) {
      Alert.alert('Microphone is off', 'Autocut needs your microphone to hear what you say. Turn it on in Settings › Autocut.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    const remaining = limit - recorded;
    if (remaining < 1) return;
    setElapsed(0);
    setMode('recording');
    startedAt.current = Date.now();
    let result: { uri: string } | undefined;
    try {
      result = await camera.current.recordAsync({ maxDuration: Math.floor(remaining) });
    } catch {
      result = undefined;
    }
    const duration = (Date.now() - startedAt.current) / 1000;
    // iOS always records the front camera mirrored; unless the user wants that, the server flips it back.
    const flip = facing === 'front' && !mirrorSelfie;
    const next = result?.uri && duration >= 0.5 ? [...takes, { uri: result.uri, mime: 'video/quicktime', duration, flip }] : takes;
    setTakes(next);
    setElapsed(0);
    if (finishWhenStopped.current || recorded + duration >= limit - 0.5) {
      finishWhenStopped.current = false;
      if (next.length) review(next);
      else setMode('idle');
    } else {
      setMode(next.length ? 'paused' : 'idle');
    }
  }

  // Double-tap the picture to switch cameras (not mid-take: switching stops the recording on iOS).
  const lastTap = useRef(0);
  function flip() {
    if (mode === 'recording') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFacing((f) => (f === 'front' ? 'back' : 'front'));
  }
  function tapPreview() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      flip();
    } else lastTap.current = now;
  }

  function pause() {
    camera.current?.stopRecording();
  }

  function finish() {
    if (mode === 'recording') {
      finishWhenStopped.current = true;
      camera.current?.stopRecording();
    } else if (takes.length) {
      review(takes);
    }
  }

  function discardLast() {
    const next = takes.slice(0, -1);
    setTakes(next);
    if (!next.length) setMode('idle');
  }

  /** One video to cut, or several (in the order they're tapped) joined into one cut. */
  async function importVideo(kind: 'single' | 'multiple' = 'single') {
    // The video as it is: converting it while picking (an export preset) can take minutes with
    // nothing on screen, which looks like the tap did nothing.
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 1,
        ...(kind === 'multiple' && { allowsMultipleSelection: true, selectionLimit: 20, orderedSelection: true }),
      });
    } catch (e) {
      Alert.alert('Couldn’t open that video', e instanceof Error ? e.message : String(e));
      return;
    }
    if (result.canceled || !result.assets.length) return;
    const picked = result.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }));
    // Several clips: put them in order first, then they're combined into one cut.
    if (kind === 'multiple') router.push({ pathname: '/arrange', params: { takes: JSON.stringify(picked) } });
    else review(picked);
  }

  if (!camPermission) return <View style={styles.black} />;
  if (!camPermission.granted) {
    return (
      <View style={[styles.black, styles.center, { padding: 32, gap: 14 }]}>
        <SymbolView name="camera.fill" tintColor="#fff" size={36} />
        <Text style={styles.permTitle}>Film your take here</Text>
        <Text style={styles.permBody}>Autocut needs your camera and microphone to record. Or import a video you already have.</Text>
        <Button
          title={camPermission.canAskAgain ? 'Allow camera' : 'Open Settings'}
          onPress={() => (camPermission.canAskAgain ? requestCam() : Linking.openSettings())}
          style={{ alignSelf: 'stretch' }}
        />
        <Button kind="text" title="Import a video" onPress={() => setSheet('add')} />
        <AddVideoSheet visible={sheet === 'add'} onClose={() => setSheet(null)} onPick={importVideo} />
      </View>
    );
  }

  // The camera shows a 9:16 frame under the status bar — exactly what gets recorded. On iPad the
  // screen is wider than 9:16, so the frame is centred with black either side.
  // (Phones that are only slightly wide, like the SE, keep a full-width frame instead of thin bars.)
  const fitW = ((screen.height - insets.top) * 9) / 16;
  const frameW = fitW < screen.width - 24 ? fitW : screen.width;
  const frameH = Math.min((frameW * 16) / 9, screen.height - insets.top);
  const frameX = (screen.width - frameW) / 2;
  const belowFrame = screen.height - insets.top - frameH;
  // Controls sit at a fixed spot near the bottom of the frame, whatever the recording state.
  const bottom = Math.max(belowFrame, 22 + TAB_BAR_HEIGHT + 6) + 22;
  const takeLabel =
    mode === 'recording'
      ? `Take ${takes.length + 1} · ${formatTime(elapsed)}`
      : `${takes.length} take${takes.length === 1 ? '' : 's'} · ${formatTime(recorded)}  Paused`;
  const firstTime = account?.profile.tour && cuts.length === 0 && showTip && mode === 'idle';

  return (
    <View style={styles.black}>
      {focused && (
        <CameraView
          ref={camera}
          style={{ position: 'absolute', top: insets.top, left: frameX, width: frameW, height: frameH }}
          mode="video"
          // 'auto' switches to cinematic stabilisation when recording starts, which crops (zooms) in.
          videoStabilizationMode="off"
          facing={facing}
          enableTorch={torch}
          videoQuality="1080p"
          onCameraReady={() => setReady(true)}
        />
      )}

      <Pressable
        onPress={tapPreview}
        accessibilityLabel="Double-tap to switch camera"
        style={{ position: 'absolute', top: insets.top, left: frameX, width: frameW, height: frameH }}
      />

      <View style={[styles.top, { top: insets.top + 8, left: frameX + 16, right: frameX + 16 }]}>
        <View style={styles.brand}>
          <Logo size={24} />
          <Text style={styles.brandText}>Autocut</Text>
        </View>
        {busy && (
          <View style={styles.pill}>
            {mode === 'recording' && <View style={styles.dot} />}
            <Text style={styles.pillText}>{takeLabel}</Text>
          </View>
        )}
        <View style={{ gap: 10 }}>
          <RoundIcon name={torch ? 'bolt.fill' : 'bolt.slash.fill'} label="Flash" onPress={() => setTorch(!torch)} />
          <RoundIcon
            name="arrow.triangle.2.circlepath.camera"
            label="Flip camera"
            disabled={mode === 'recording'}
            onPress={flip}
          />
        </View>
      </View>

      {firstTime && (
        <Pressable style={[styles.tip, { bottom: bottom + 150, left: frameX + 24, right: frameX + 24 }]} onPress={() => setShowTip(false)}>
          <Text style={styles.tipText}>Tap the button to record. Flub a line? Just say it again, Autocut keeps your last take.</Text>
          <Text style={styles.tipDismiss}>Got it</Text>
        </Pressable>
      )}

      <View style={[styles.bottom, { bottom, left: frameX, right: frameX }]}>
        {mode === 'idle' && !takes.length && <LengthPicker value={limit} onChange={setLimit} />}

        <View style={styles.controls}>
          <View style={styles.side}>
            {mode === 'idle' && !takes.length ? (
              <Pressable onPress={() => setSheet('folder')} style={({ pressed }) => [styles.folder, pressed && { opacity: 0.8 }]} accessibilityLabel="Where new videos are saved">
                <SymbolView name="folder.fill" tintColor={theme.ink} size={16} />
                <Text style={styles.folderText} numberOfLines={1}>
                  {folderName(saveFolder) ?? 'Cuts'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={mode === 'recording' ? pause : record}
            accessibilityLabel={mode === 'recording' ? 'Pause' : mode === 'paused' ? 'Record next take' : 'Record'}
            style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.95 }] }]}
          >
            <ShutterRing progress={busy ? Math.min(1, total / limit) : 0} dim={busy} />
            {mode === 'recording' ? (
              <SymbolView name="pause.fill" tintColor="#fff" size={30} />
            ) : (
              <View style={[styles.shutterInner, mode === 'paused' && { backgroundColor: theme.cut }]} />
            )}
          </Pressable>

          <View style={[styles.side, { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' }]}>
            {mode === 'idle' && !takes.length && (
              <Pressable onPress={() => setSheet('add')} style={({ pressed }) => [styles.importButton, pressed && { opacity: 0.8 }]} accessibilityLabel="Add a video from Photos">
                <SymbolView name="photo.on.rectangle.angled" tintColor={theme.ink} size={22} />
              </Pressable>
            )}
            {mode === 'paused' && <RoundIcon name="xmark" label="Delete last take" onPress={discardLast} />}
            {busy && (
              <Pressable onPress={finish} style={styles.done} accessibilityLabel="Done recording">
                <SymbolView name="checkmark" tintColor={theme.ink} size={20} weight="bold" />
              </Pressable>
            )}
          </View>
        </View>
      </View>
      <FolderSheet visible={sheet === 'folder'} onClose={() => setSheet(null)} />
      <AddVideoSheet visible={sheet === 'add'} onClose={() => setSheet(null)} onPick={importVideo} />
    </View>
  );
}

const LENGTH_W = 52; // each option, so the picker can slide the chosen one over the shutter
const LENGTH_PAD = 3;

/** 60s / 3m / 10m / 20m. It slides so the chosen length sits right above the record button. */
function LengthPicker({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  const index = Math.max(0, LENGTHS.findIndex((l) => l.seconds === value));
  // Centred as a whole, then moved so option `index` lines up with the middle.
  const offset = (i: number) => ((LENGTHS.length - 1) / 2 - i) * LENGTH_W;
  const x = useSharedValue(offset(index));
  useEffect(() => {
    x.value = withTiming(offset(index), { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [index, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View style={[styles.lengths, slide]}>
      {LENGTHS.map((l) => (
        <Pressable
          key={l.label}
          onPress={() => {
            Haptics.selectionAsync();
            onChange(l.seconds);
          }}
          style={[styles.length, value === l.seconds && styles.lengthOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === l.seconds }}
        >
          <Text style={[styles.lengthText, value === l.seconds && { color: theme.ink }]}>{l.label}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const RING = 84;
const RING_STROKE = 5;
const RING_R = (RING - RING_STROKE) / 2;
const RING_LEN = 2 * Math.PI * RING_R;

/** The shutter's outline; while recording, a red arc fills it as the length limit approaches. */
function ShutterRing({ progress, dim }: { progress: number; dim: boolean }) {
  return (
    <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
      <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={dim ? 'rgba(255,255,255,0.45)' : '#fff'} strokeWidth={RING_STROKE} fill="none" />
      {progress > 0 && (
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={RING_R}
          stroke={theme.cut}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${RING_LEN} ${RING_LEN}`}
          strokeDashoffset={RING_LEN * (1 - progress)}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      )}
    </Svg>
  );
}

function RoundIcon({ name, label, onPress, disabled, big }: { name: React.ComponentProps<typeof SymbolView>['name']; label: string; onPress: () => void; disabled?: boolean; big?: boolean }) {
  const size = big ? 48 : 40;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.round, { width: size, height: size, borderRadius: size / 2, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <SymbolView name={name} tintColor="#fff" size={big ? 22 : 18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  permTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
  permBody: { color: 'rgba(255,255,255,0.75)', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  top: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  brandText: { color: '#fff', fontSize: 17, fontFamily: BRAND_FONT },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.cut },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  round: { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', alignItems: 'center', gap: 16 },
  lengths: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 999, padding: LENGTH_PAD },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: 150, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12 },
  folderText: { fontSize: 15, fontWeight: '600', color: theme.ink, flexShrink: 1 },
  importButton: { width: 52, height: 52, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  length: { width: LENGTH_W, alignItems: 'center', paddingVertical: 7, borderRadius: 999 },
  lengthOn: { backgroundColor: '#fff' },
  lengthText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, width: '100%' },
  side: { flex: 1 },
  shutter: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  done: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  tip: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, padding: 14, gap: 6 },
  tipText: { fontSize: 14, color: theme.ink, lineHeight: 20 },
  tipDismiss: { fontSize: 14, fontWeight: '700', color: theme.accent, alignSelf: 'flex-end' },
});
