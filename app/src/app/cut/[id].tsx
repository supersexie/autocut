import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Thumb } from '../../components/Thumb';
import { Backdrop, Button } from '../../components/ui';
import { stopCut } from '../../lib/jobs';
import { cutFile, deleteCut, useCut } from '../../lib/store';
import { theme } from '../../lib/theme';

const TIPS = [
  'Almost all videos now get edited in around a minute.',
  'Flub a line? Just say it again. Autocut keeps your last take.',
  'Pause between takes, then tap ✓. All your takes are cut as one video.',
  'Turn captions on or off before you send, in More options.',
  'Every cut can be undone in the editor. Tap Restore to see them all.',
];

/** "Cutting… 52%": shown while a take uploads and the server finds the cuts. */
export default function Cutting() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cut = useCut(id);
  const [tip, setTip] = useState(0);

  // A short "Your cut is ready" moment, then into the editor.
  useEffect(() => {
    if (cut?.status !== 'ready') return;
    const t = setTimeout(() => router.replace({ pathname: '/edit/[id]', params: { id } }), 1100);
    return () => clearTimeout(t);
  }, [cut?.status, id]);

  // Notice when an upload stops moving, to say the connection is slow.
  const lastMove = useRef({ progress: -1, at: 0 });
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (cut?.status !== 'uploading') return;
    if (cut.progress !== lastMove.current.progress) {
      lastMove.current = { progress: cut.progress, at: Date.now() };
      setStalled(false);
    }
    const t = setInterval(() => setStalled(Date.now() - lastMove.current.at > 6000), 1000);
    return () => clearInterval(t);
  }, [cut?.status, cut?.progress]);

  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(t);
  }, []);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/cuts'));

  if (!cut) {
    return (
      <Backdrop>
        <Text style={styles.subtitle}>This cut is not on this phone any more.</Text>
        <Button kind="text" title="Back" onPress={leave} />
      </Backdrop>
    );
  }

  if (cut.status === 'failed') {
    return (
      <Backdrop
        footer={
          <>
            <Button
              kind="outline"
              title="Delete this draft"
              onPress={() => {
                deleteCut(id);
                leave();
              }}
            />
            <Button title="Back to camera" onPress={() => router.replace('/')} />
          </>
        }
      >
        <Header onBack={leave} />
        <View style={styles.failed}>
          <SymbolView name="exclamationmark.circle" tintColor={theme.ink} size={34} />
          <Text style={styles.failedTitle}>The edit didn’t finish</Text>
          <Text style={styles.failedBody}>{cut.error}</Text>
        </View>
      </Backdrop>
    );
  }

  const uploading = cut.status === 'uploading';
  const percent = Math.round(100 * (uploading ? cut.progress * 0.25 : 0.25 + 0.75 * cut.progress));
  const preview = cut.previewUri ?? (cut.source ? cutFile(cut.source).uri : undefined);

  if (cut.status === 'ready') {
    return (
      <Backdrop>
        <Animated.Text entering={FadeIn.duration(200)} style={[styles.title, { marginTop: 40 }]}>
          Your cut is ready
        </Animated.Text>
        <Animated.View entering={ZoomIn.springify().damping(16)}>
          <Thumb uri={preview} seconds={0.5} style={[styles.card, styles.cardDone]} />
        </Animated.View>
      </Backdrop>
    );
  }

  const status = uploading
    ? cut.stage === 'waiting'
      ? 'Waiting for your other videos to upload'
      : cut.progress === 0
        ? stalled ? 'Your connection is slow, still trying' : 'Connecting'
        : stalled ? 'Your connection is slow, still trying' : null
    : cut.stage === 'queued'
      ? 'Waiting for the last cut to finish'
      : null;

  return (
    <Backdrop
      footer={
        <Button
          kind="outline"
          title="Stop"
          onPress={() => {
            stopCut(id);
            leave();
          }}
          style={{ alignSelf: 'center', paddingHorizontal: 36 }}
        />
      }
    >
      <Header onBack={leave} />
      <Text style={styles.title}>Cutting</Text>
      {status && <Text style={[styles.subtitle, { color: theme.ink }]}>{status}</Text>}
      <Text style={styles.subtitle}>
        {uploading ? 'Keep Autocut open.' : 'You can lock your phone or leave. Your cut will be waiting in Cuts.'}
      </Text>

      <Thumb uri={preview} seconds={0.5} style={[styles.card, !uploading && styles.cardDone]}>
        <View style={styles.shade} />
        <Text style={styles.percent}>{percent}%</Text>
      </Thumb>

      <View style={styles.tip}>
        <Pressable onPress={() => setTip((tip + TIPS.length - 1) % TIPS.length)} hitSlop={10} accessibilityLabel="Previous tip">
          <SymbolView name="chevron.left" tintColor={theme.faint} size={13} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <Text style={styles.tipLabel}>Tip</Text>
          <Text style={styles.tipText}>{TIPS[tip]}</Text>
        </View>
        <Pressable onPress={() => setTip((tip + 1) % TIPS.length)} hitSlop={10} accessibilityLabel="Next tip">
          <SymbolView name="chevron.right" tintColor={theme.faint} size={13} />
        </Pressable>
      </View>
    </Backdrop>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back" style={{ width: 32, height: 32, justifyContent: 'center' }}>
      <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  subtitle: { fontSize: 13, color: theme.muted, textAlign: 'center', marginTop: 4, marginHorizontal: 20, lineHeight: 18 },
  card: {
    width: 170, height: 300, borderRadius: 20, alignSelf: 'center', marginTop: 24, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#D9D9DE', backgroundColor: '#1C1C1F',
  },
  cardDone: { borderColor: theme.ink },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)' },
  percent: { color: '#fff', fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 6 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 16, padding: 14, marginTop: 24 },
  tipLabel: { fontSize: 12, fontWeight: '600', color: theme.faint },
  tipText: { fontSize: 14, color: theme.ink, textAlign: 'center', lineHeight: 19 },
  failed: { alignItems: 'center', gap: 10, marginTop: 120, paddingHorizontal: 20 },
  failedTitle: { fontSize: 18, fontWeight: '700', color: theme.ink },
  failedBody: { fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20 },
});
