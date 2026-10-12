import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Logo } from '../../components/ui';
import { TAB_BAR_HEIGHT, tabBarStyle } from '../../components/tabBar';
import { useAuth } from '../../lib/auth';
import type { Take } from '../../lib/jobs';
import { useCuts, useSettings } from '../../lib/store';
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
  const navigation = useNavigation();
  const { account } = useAuth();
  const cuts = useCuts();
  const { mirrorFront } = useSettings();
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

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  // Hide the tab bar while a take is in progress so the controls own the bottom of the screen.
  const busy = mode !== 'idle' || takes.length > 0;
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: busy ? { display: 'none' } : tabBarStyle });
  }, [busy, navigation]);

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
    if (!micPermission?.granted && !(await requestMic()).granted) return;
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
    const next = result?.uri && duration >= 0.5 ? [...takes, { uri: result.uri, mime: 'video/quicktime', duration }] : takes;
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

  async function importVideo() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
    const a = result.assets?.[0];
    if (result.canceled || !a) return;
    review([{ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }]);
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
        <Button kind="text" title="Import a video" onPress={importVideo} />
      </View>
    );
  }

  const bottom = busy ? insets.bottom + 28 : 22 + TAB_BAR_HEIGHT + 22;
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
          style={StyleSheet.absoluteFill}
          mode="video"
          facing={facing}
          enableTorch={torch}
          videoQuality="1080p"
          // iOS saves front-camera video mirrored by default; `mirror` reverses that.
          mirror={!mirrorFront}
          onCameraReady={() => setReady(true)}
        />
      )}

      <View style={[styles.top, { top: insets.top + 8 }]}>
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
            onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
          />
        </View>
      </View>

      {firstTime && (
        <Pressable style={[styles.tip, { bottom: bottom + 150 }]} onPress={() => setShowTip(false)}>
          <Text style={styles.tipText}>Tap the button to record. Flub a line? Just say it again, Autocut keeps your last take.</Text>
          <Text style={styles.tipDismiss}>Got it</Text>
        </Pressable>
      )}

      <View style={[styles.bottom, { bottom }]}>
        {mode === 'idle' && !takes.length && (
          <View style={styles.lengths}>
            {LENGTHS.map((l) => (
              <Pressable
                key={l.label}
                onPress={() => setLimit(l.seconds)}
                style={[styles.length, limit === l.seconds && styles.lengthOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: limit === l.seconds }}
              >
                <Text style={[styles.lengthText, limit === l.seconds && { color: '#fff' }]}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {busy && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, (total / limit) * 100)}%` }]} />
          </View>
        )}

        <View style={styles.controls}>
          <View style={styles.side}>
            {mode === 'idle' && !takes.length ? (
              <RoundIcon name="photo.on.rectangle" label="Import a video" onPress={importVideo} big />
            ) : null}
          </View>

          <Pressable
            onPress={mode === 'recording' ? pause : record}
            accessibilityLabel={mode === 'recording' ? 'Pause' : mode === 'paused' ? 'Record next take' : 'Record'}
            style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}
          >
            {mode === 'recording' ? (
              <SymbolView name="pause.fill" tintColor="#fff" size={30} />
            ) : (
              <View style={[styles.shutterInner, mode === 'paused' && { backgroundColor: theme.cut }]} />
            )}
          </Pressable>

          <View style={[styles.side, { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' }]}>
            {mode === 'paused' && <RoundIcon name="xmark" label="Delete last take" onPress={discardLast} />}
            {busy && (
              <Pressable onPress={finish} style={styles.done} accessibilityLabel="Done recording">
                <SymbolView name="checkmark" tintColor="#fff" size={20} weight="bold" />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
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
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  brandText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.cut },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  round: { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 16 },
  lengths: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 999, padding: 3 },
  length: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  lengthOn: { backgroundColor: theme.accent },
  lengthText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
  progressTrack: { width: '70%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: theme.cut },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, width: '100%' },
  side: { flex: 1 },
  shutter: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  done: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  tip: { position: 'absolute', left: 24, right: 24, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, padding: 14, gap: 6 },
  tipText: { fontSize: 14, color: theme.ink, lineHeight: 20 },
  tipDismiss: { fontSize: 14, fontWeight: '700', color: theme.accent, alignSelf: 'flex-end' },
});
