import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Button } from '../components/ui';
import { clearDraft } from '../lib/draft';
import WORDS from '../lib/introWords.json';
import { column, formatTime, theme } from '../lib/theme';

// The sample: one take, raw and edited. They're the same take frame for frame, so the edit can
// take over mid-sentence. WORDS is the raw take transcribed by Autocut itself (src/transcribe.js).
const RAW = require('../../assets/intro/raw.mp4');
const EDITED = require('../../assets/intro/edited.mp4');
const LENGTH = 24.5;
/** When the edit takes over: the end of the first sentences, once the reading has been seen. */
const READY_AT = 6.4;
const ease = Easing.out(Easing.cubic);

type Word = { t: string; s: number; e: number };
type Phase = 'intro' | 'reading' | 'ready';

// expo-video is driven by setting properties on the player.
const setPlayer = (p: VideoPlayer, patch: { muted?: boolean; loop?: boolean; currentTime?: number }) => {
  Object.assign(p, patch);
};

/** Short lines of the transcript (a sentence, or six words at most), shown as they're spoken. */
const LINES: Word[][] = (() => {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of WORDS as Word[]) {
    cur.push(w);
    if (cur.length >= 6 || /[.?!,]$/.test(w.t)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
})();

/**
 * What a new user sees first, like CutAI: a real raw take plays behind the headline. "See it
 * happen" plays it with sound while Autocut reads it (captions type on, word by word), then the
 * edited version takes over at the same moment and plays on. Nothing is uploaded.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('intro');
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const phaseRef = useRef<Phase>('intro');
  useEffect(() => {
    phaseRef.current = phase;
  });

  const raw = useVideoPlayer(RAW, (p) => {
    p.muted = true;
    p.loop = true;
    p.timeUpdateEventInterval = 1 / 20;
    p.play();
  });
  const edited = useVideoPlayer(EDITED, (p) => {
    p.muted = true;
    p.loop = true;
    p.timeUpdateEventInterval = 1 / 20;
  });

  // The edit fades in over the raw take.
  const editShown = useSharedValue(0);
  const editStyle = useAnimatedStyle(() => ({ opacity: editShown.value }));

  useEffect(() => {
    const subs = [
      raw.addListener('timeUpdate', ({ currentTime }) => {
        if (phaseRef.current === 'reading') setTime(currentTime);
        if (phaseRef.current === 'reading' && currentTime >= READY_AT) setPhase('ready');
      }),
      edited.addListener('timeUpdate', ({ currentTime }) => {
        if (phaseRef.current === 'ready') setTime(currentTime);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [raw, edited]);

  // Ready: the edit takes over where the raw take is, with its sound.
  useEffect(() => {
    if (phase !== 'ready') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (Math.abs(edited.currentTime - raw.currentTime) > 0.12) setPlayer(edited, { currentTime: raw.currentTime });
    setPlayer(edited, { muted });
    setPlayer(raw, { muted: true });
    editShown.set(withTiming(1, { duration: 450, easing: ease }));
    // Once the edit is fully in, the raw take can rest.
    const t = setTimeout(() => raw.pause(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === 'reading') setPlayer(raw, { muted });
    if (phase === 'ready') setPlayer(edited, { muted });
  }, [muted, phase, raw, edited]);

  // Leaving for setup or sign-in: stop the sound. Coming back: carry on quietly.
  useFocusEffect(
    useCallback(() => {
      if (phaseRef.current === 'ready') edited.play();
      else raw.play();
      return () => {
        raw.pause();
        edited.pause();
        setMuted(true);
      };
    }, [raw, edited])
  );

  function seeIt() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Both start together from the top, so they stay in step for the hand-over.
    setPlayer(raw, { currentTime: 0, loop: false, muted });
    setPlayer(edited, { currentTime: 0, muted: true });
    raw.play();
    edited.play();
    setTime(0);
    setPhase('reading');
  }

  function start() {
    clearDraft(); // a fresh start: no answers left over from an earlier run through setup
    router.push('/setup');
  }

  const heard = (WORDS as Word[]).filter((w) => w.s <= time);
  const line = phase === 'intro' ? undefined : LINES.find((l) => time < l[l.length - 1].e + 0.15 && time >= l[0].s - 0.05) ?? LINES.findLast((l) => l[0].s <= time);
  const status = phase === 'ready' ? 'Edit ready' : time < 2 ? 'Reading the take' : time < 4.2 ? 'Writing captions' : 'Timing every word';

  return (
    <View style={styles.screen}>
      <VideoView player={raw} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <Animated.View style={[StyleSheet.absoluteFill, editStyle]} pointerEvents="none">
        <VideoView player={edited} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      </Animated.View>

      <View style={[styles.top, { top: insets.top + 8 }]}>
        {phase === 'intro' ? (
          <Animated.View exiting={FadeOut.duration(150)} style={styles.chip}>
            <Text style={styles.chipText}>RAW TAKE · {formatTime(LENGTH)}</Text>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(250)}>
            <Pressable onPress={() => setMuted((m) => !m)} hitSlop={10} style={styles.round} accessibilityLabel={muted ? 'Sound on' : 'Sound off'}>
              <SymbolView name={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} tintColor="#fff" size={14} />
            </Pressable>
          </Animated.View>
        )}
        {phase === 'reading' && (
          <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)}>
            <Pressable onPress={start} hitSlop={10} style={styles.chip} accessibilityLabel="Skip">
              <Text style={styles.chipText}>Skip</Text>
            </Pressable>
          </Animated.View>
        )}
      </View>

      {/* A solid white panel for the words and buttons; the picture above stays clear, with a short fade into it. */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.fade} pointerEvents="none">
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#fff" stopOpacity="0" />
                <Stop offset="1" stopColor="#fff" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
          </Svg>
        </View>
        <View style={column()}>
        {phase === 'intro' ? (
          <Animated.View key="intro" exiting={FadeOut.duration(180)} style={{ gap: 10 }}>
            <Text style={styles.headline}>Raw take in.{'\n'}Tight cut out.</Text>
            <Text style={styles.sub}>Autocut cuts the dead air, ums and retakes, and captions every word. You just film.</Text>
            <Button title="See it happen" onPress={seeIt} style={{ marginTop: 12 }} />
            <Text style={styles.signIn}>
              Already have an account?{' '}
              <Text style={styles.signInLink} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'sign-in' } })}>
                Sign In
              </Text>
            </Text>
          </Animated.View>
        ) : (
          <Animated.View key="demo" entering={FadeInDown.duration(380).easing(ease)} style={{ gap: 14 }}>
            {phase === 'reading' ? (
              // What's being said, word by word, the word being spoken in bold. Once the edit takes
              // over, its own captions say it, so this gives way to the result.
              <Text style={styles.transcript} numberOfLines={2}>
                {line?.map((w, i) => (
                  <Text key={`${w.s}-${i}`} style={[w.s > time && styles.unsaid, w.s <= time && time < w.e + 0.1 && styles.saying]}>
                    {w.t}{' '}
                  </Text>
                ))}
              </Text>
            ) : (
              <Animated.Text entering={FadeIn.duration(300)} style={styles.transcript}>
                Cut, captioned,{'\n'}ready to post.
              </Animated.Text>
            )}

            <View>
              <View style={styles.track}>
                {phase === 'ready' ? (
                  <Animated.View entering={FadeIn.duration(300)} style={[StyleSheet.absoluteFill, styles.trackFull]} />
                ) : (
                  <View style={[styles.trackFill, { width: `${Math.min(100, (time / LENGTH) * 100)}%` }]} />
                )}
                {/* A tick for every word Autocut has placed so far. */}
                {(phase === 'ready' ? (WORDS as Word[]) : heard).map((w) => (
                  <View key={w.s} style={[styles.tick, { left: `${(w.s / LENGTH) * 100}%` }, phase === 'ready' && styles.tickOn]} />
                ))}
                <View style={[styles.head, { left: `${Math.min(100, (time / LENGTH) * 100)}%` }]} />
              </View>
              <View style={styles.statusRow}>
                {phase === 'ready' ? (
                  <Animated.View entering={FadeIn.duration(250)} style={styles.done}>
                    <SymbolView name="checkmark" tintColor="#fff" size={9} weight="bold" />
                  </Animated.View>
                ) : (
                  <View style={styles.pulse} />
                )}
                <Text style={styles.status}>{status}</Text>
                <Text style={styles.count}>{phase === 'ready' ? `${WORDS.length} words captioned` : formatTime(time)}</Text>
              </View>
            </View>

            {phase === 'ready' ? (
              <Animated.View entering={FadeInDown.duration(380).easing(ease)}>
                <Button title="Try it with your video" onPress={start} />
              </Animated.View>
            ) : (
              <View style={{ height: 54 }} />
            )}
            <Text style={styles.note}>Sample clip. Nothing uploaded, no permissions needed.</Text>
          </Animated.View>
        )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, paddingHorizontal: 22, paddingTop: 6 },
  fade: { position: 'absolute', left: 0, right: 0, top: -70, height: 70 },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { backgroundColor: 'rgba(17,17,20,0.55)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  round: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(17,17,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  headline: { fontSize: 36, fontWeight: '800', color: theme.ink, letterSpacing: -0.9, lineHeight: 40 },
  sub: { fontSize: 15, color: theme.muted, lineHeight: 21 },
  signIn: { fontSize: 14, color: theme.muted, textAlign: 'center', marginTop: 6 },
  signInLink: { color: theme.ink, fontWeight: '700' },
  transcript: { fontSize: 22, fontWeight: '700', color: theme.ink, letterSpacing: -0.3, lineHeight: 28, minHeight: 56 },
  unsaid: { color: 'transparent' },
  saying: { fontWeight: '900' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E6E6EA', overflow: 'visible' },
  trackFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, backgroundColor: '#B9B9C0' },
  trackFull: { borderRadius: 3, backgroundColor: theme.ink },
  tick: { position: 'absolute', top: -3, width: 2, height: 12, marginLeft: -1, borderRadius: 1, backgroundColor: theme.ink },
  tickOn: { backgroundColor: '#fff', top: 1, height: 4 },
  head: { position: 'absolute', top: -5, width: 3, height: 16, marginLeft: -1.5, borderRadius: 1.5, backgroundColor: theme.ink },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.ink },
  done: { width: 16, height: 16, borderRadius: 8, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  status: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.ink },
  count: { fontSize: 13, fontWeight: '600', color: theme.muted, fontVariant: ['tabular-nums'] },
  note: { fontSize: 11, color: theme.faint, textAlign: 'center' },
});
