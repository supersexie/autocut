import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ProgressCard } from '../../components/ProgressCard';
import { Editor } from '../edit/[id]';
import { Backdrop, Button } from '../../components/ui';
import { canRetry, retryCut, stopCut } from '../../lib/jobs';
import { cutFile, deleteCut, useCut, whenText } from '../../lib/store';
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
  return <CuttingView id={id} />;
}

/**
 * The cutting screen, then the editor once the cut is ready. Review and Arrange show it in place
 * after Send, so no screen closes on the way (which would flash the camera underneath).
 */
export function CuttingView({ id }: { id: string }) {
  const cut = useCut(id);
  const [tip, setTip] = useState(0);

  // A short "Your cut is ready" moment, then the editor takes over this screen. Opening it as a
  // screen of its own would close this one first and flash the camera underneath.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (cut?.status !== 'ready') return;
    const t = setTimeout(() => setEditing(true), 1100);
    return () => clearTimeout(t);
  }, [cut?.status]);

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
        <Text style={styles.subtitle}>This cut is not on this device any more.</Text>
        <Button kind="text" title="Back" onPress={leave} />
      </Backdrop>
    );
  }

  if (cut.status === 'failed') {
    return (
      <Backdrop
        footer={
          <>
            {canRetry(cut) && <Button title="Try again" onPress={() => retryCut(id)} />}
            <Button
              kind="outline"
              title="Delete this draft"
              onPress={() => {
                deleteCut(id);
                leave();
              }}
            />
            <Button kind={canRetry(cut) ? 'text' : 'primary'} title="Back to camera" onPress={() => router.replace('/')} />
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
  const flip = !!cut.previewUri && !!cut.previewFlip;

  if (cut.status === 'ready' && editing && cut.source) {
    return (
      <View style={{ flex: 1 }}>
        <Editor cut={cut} />
      </View>
    );
  }

  if (cut.status === 'ready') {
    return (
      <Backdrop>
        <View style={{ height: 32 }} />
        <Animated.Text entering={FadeIn.duration(200)} style={styles.title}>
          Your cut is ready
        </Animated.Text>
        {/* No fade: the card stays put from the cutting screen, its border already full. */}
        <View style={{ marginTop: 24 }}>
          <ProgressCard uri={preview} progress={1} flip={flip} />
        </View>
      </Backdrop>
    );
  }

  if (cut.stage === 'scheduled' && cut.scheduledFor) {
    return (
      <Backdrop
        footer={
          <Pressable
            onPress={() => {
              stopCut(id);
              leave();
            }}
            style={({ pressed }) => [styles.stop, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.stopText}>Cancel</Text>
          </Pressable>
        }
      >
        <Header onBack={leave} />
        <Text style={styles.title}>Scheduled</Text>
        <Text style={[styles.subtitle, { color: theme.ink }]}>Autocut will cut this {whenText(cut.scheduledFor).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}.</Text>
        <Text style={styles.subtitle}>It’s uploaded, so your phone doesn’t need to be on. It’ll be waiting in Cuts.</Text>
        <View style={{ marginTop: 22 }}>
          <ProgressCard uri={preview} progress={0} label={new Date(cut.scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} flip={flip} />
        </View>
      </Backdrop>
    );
  }

  const status = cut.stage === 'reconnecting'
    ? 'Connection lost. Trying again…'
    : uploading
    ? cut.stage === 'waiting'
      ? 'Waiting for your other videos to upload'
      : stalled
        ? 'Your connection is slow, still trying'
        : cut.progress === 0
          ? 'Connecting'
          : null
    : cut.stage === 'queued'
      ? 'Waiting for the last cut to finish'
      : cut.stage === 'joining'
        ? 'Combining your clips…'
        : null;

  return (
    <Backdrop
      footer={
        <Pressable
          onPress={() => {
            stopCut(id);
            leave();
          }}
          style={({ pressed }) => [styles.stop, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      }
    >
      <Header onBack={uploading ? undefined : leave} />
      <Text style={styles.title}>Cutting</Text>
      {status && <Text style={[styles.subtitle, { color: theme.ink }]}>{status}</Text>}
      <Text style={styles.subtitle}>{uploading ? 'Keep Autocut open.' : 'You’re free to go. Your cut will be waiting in Cuts.'}</Text>

      <View style={{ marginTop: 22 }}>
        <ProgressCard uri={preview} progress={percent / 100} label={`${percent}%`} flip={flip} />
      </View>

      <View style={styles.tip}>
        <Pressable onPress={() => setTip((tip + TIPS.length - 1) % TIPS.length)} hitSlop={10} accessibilityLabel="Previous tip">
          <SymbolView name="chevron.left" tintColor={theme.faint} size={13} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
          <Text style={styles.tipLabel}>Tip</Text>
          <Animated.Text key={tip} entering={FadeIn.duration(250)} style={styles.tipText}>
            {TIPS[tip]}
          </Animated.Text>
        </View>
        <Pressable onPress={() => setTip((tip + 1) % TIPS.length)} hitSlop={10} accessibilityLabel="Next tip">
          <SymbolView name="chevron.right" tintColor={theme.faint} size={13} />
        </Pressable>
      </View>
    </Backdrop>
  );
}

function Header({ onBack }: { onBack?: () => void }) {
  return (
    <Pressable onPress={onBack} disabled={!onBack} hitSlop={12} accessibilityLabel="Back" style={{ width: 32, height: 32, justifyContent: 'center', opacity: onBack ? 1 : 0 }}>
      <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: theme.ink, textAlign: 'center', letterSpacing: -0.2 },
  subtitle: { fontSize: 13, color: theme.muted, textAlign: 'center', marginTop: 5, marginHorizontal: 24, lineHeight: 18 },
  tip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 18, paddingVertical: 16, paddingHorizontal: 14, marginTop: 22,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  tipLabel: { fontSize: 12, fontWeight: '500', color: theme.faint },
  tipText: { fontSize: 15, color: theme.ink, textAlign: 'center', lineHeight: 21 },
  stop: { alignSelf: 'center', backgroundColor: theme.card, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 11 },
  stopText: { fontSize: 15, fontWeight: '600', color: theme.ink },
  failed: { alignItems: 'center', gap: 10, marginTop: 120, paddingHorizontal: 20 },
  failedTitle: { fontSize: 18, fontWeight: '700', color: theme.ink },
  failedBody: { fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20 },
});
