import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { outline } from '../components/ProgressCard';
import { HIGHLIGHT } from '../components/Onboarding';
import { Button, Logo, Wash } from '../components/ui';
import { BRAND_FONT } from '../lib/fonts';
import { clearDraft } from '../lib/draft';
import WORDS from '../lib/introWords.json';
import { column, COLUMN, formatTime, theme } from '../lib/theme';

// The sample: one take, raw and edited. They're the same take frame for frame, so the edit can
// take over mid-sentence. WORDS is the raw take transcribed by Autocut itself (src/transcribe.js).
const RAW = require('../../assets/intro/raw.mp4');
const EDITED = require('../../assets/intro/edited.mp4');
const LENGTH = 24.5;
/** When the edit takes over: the end of the first sentences, once the reading has been seen. */
const READY_AT = 6.4;
const ease = Easing.out(Easing.cubic);
// The card, like the one on the cutting screen: rounded, with progress running round its border.
const ASPECT = 9 / 16;
const RADIUS = 26;
const STROKE = 4;

type Word = { t: string; s: number; e: number };

/** What Autocut is doing, ticked off as the reading gets through the take. */
const STEPS = [
  { label: 'Reading the take', icon: 'waveform' as const, done: 0.34 },
  { label: 'Cutting ums and retakes', icon: 'scissors' as const, done: 0.68 },
  { label: 'Captioning every word', icon: 'captions.bubble' as const, done: 1 },
];
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
 * What a new user sees first, like CutAI: a real raw take plays in a card above the headline. "See it
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

  const line = phase === 'intro' ? undefined : LINES.find((l) => time < l[l.length - 1].e + 0.15 && time >= l[0].s - 0.05) ?? LINES.findLast((l) => l[0].s <= time);

  // The card fills the space above the words, keeping the video's shape.
  const [space, setSpace] = useState({ w: 0, h: 0 });
  const cardH = Math.max(0, Math.min(space.h - 32, (space.w - 48) / ASPECT));
  const cardW = cardH * ASPECT;
  // Round the border: filling while it reads the take, full once the edit is ready.
  const progress = phase === 'ready' ? 1 : phase === 'reading' ? Math.min(1, time / READY_AT) : 0;
  const r = RADIUS - STROKE / 2;
  const perimeter = 2 * (cardW - STROKE - 2 * r) + 2 * (cardH - STROKE - 2 * r) + 2 * Math.PI * r;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 10 }]}>
      <Wash />
      {/* In the same column as everything else, so on iPad they sit by the card, not in the far corners. */}
      <View style={[styles.top, column(COLUMN)]}>
        <View style={styles.side}>
          {phase !== 'intro' && (
            <Animated.View entering={FadeIn.duration(250)}>
              <Pressable onPress={() => setMuted((m) => !m)} hitSlop={10} style={styles.round} accessibilityLabel={muted ? 'Sound on' : 'Sound off'}>
                <SymbolView name={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} tintColor={theme.ink} size={14} />
              </Pressable>
            </Animated.View>
          )}
        </View>
        <View style={styles.brand}>
          <Logo size={26} />
          <Text style={styles.brandText}>Autocut</Text>
        </View>
        <View style={[styles.side, { alignItems: 'flex-end' }]}>
          {phase === 'reading' && (
            <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)}>
              {/* Skip the reading, not the sample: straight to the finished edit. */}
              <Pressable onPress={() => setPhase('ready')} hitSlop={10} style={styles.pill} accessibilityLabel="Skip to the finished edit">
                <Text style={styles.pillText}>Skip</Text>
              </Pressable>
            </Animated.View>
          )}
        </View>
      </View>

      <View style={styles.stage} onLayout={(e) => setSpace({ w: Math.min(e.nativeEvent.layout.width, COLUMN), h: e.nativeEvent.layout.height })}>
        {cardH > 0 && (
          <View style={[styles.cardShadow, { width: cardW, height: cardH, borderRadius: RADIUS }]}>
            <View style={[styles.card, { borderRadius: RADIUS }]}>
              <VideoView player={raw} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
              <Animated.View style={[StyleSheet.absoluteFill, editStyle]} pointerEvents="none">
                <VideoView player={edited} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
              </Animated.View>
              {/* Raw, then edited: the chip says which one is playing. */}
              <Animated.View key={phase === 'ready' ? 'edited' : 'raw'} entering={FadeIn.duration(300)} style={[styles.chip, phase === 'ready' && styles.chipDone]}>
                {phase === 'ready' && <SymbolView name="checkmark" tintColor={theme.ink} size={9} weight="bold" />}
                <Text style={[styles.chipText, phase === 'ready' && { color: theme.ink }]}>{phase === 'ready' ? 'EDITED' : `RAW TAKE · ${formatTime(LENGTH)}`}</Text>
              </Animated.View>
            </View>
            <Svg width={cardW} height={cardH} style={StyleSheet.absoluteFill} pointerEvents="none">
              {progress > 0 && (
                <Path
                  d={outline(cardW, cardH, RADIUS, STROKE / 2)}
                  stroke={theme.ink}
                  strokeWidth={STROKE}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${perimeter} ${perimeter}`}
                  strokeDashoffset={perimeter * (1 - progress)}
                />
              )}
            </Svg>
          </View>
        )}
      </View>

      <View style={[styles.bottom, column()]}>
        {phase === 'intro' ? (
          <Animated.View key="intro" exiting={FadeOut.duration(180)} style={{ gap: 10 }}>
            <Text style={styles.headline}>
              Raw take in.{'\n'}
              <Text style={{ color: HIGHLIGHT }}>Tight cut out.</Text>
            </Text>
            <Text style={styles.sub}>Autocut cuts the dead air, ums and retakes, and captions every word. You just film.</Text>
            <Button title="See it happen" icon={<SymbolView name="play.fill" tintColor="#fff" size={14} />} onPress={seeIt} style={{ marginTop: 8 }} />
            <Text style={styles.signIn}>
              Already have an account?{' '}
              <Text style={styles.signInLink} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'sign-in' } })}>
                Sign in
              </Text>
            </Text>
          </Animated.View>
        ) : (
          <Animated.View key="demo" entering={FadeInDown.duration(380).easing(ease)} style={{ gap: 12 }}>
            {phase === 'reading' ? (
              // What's being said, word by word, the word being spoken in bold. Once the edit takes
              // over, its own captions say it, so this gives way to the result.
              <View style={styles.transcriptCard}>
                <Text style={styles.transcript} numberOfLines={2}>
                  {line?.map((w, i) => (
                    <Text key={`${w.s}-${i}`} style={[w.s > time && styles.unsaid, w.s <= time && time < w.e + 0.1 && styles.saying]}>
                      {w.t}{' '}
                    </Text>
                  ))}
                </Text>
              </View>
            ) : (
              <Animated.Text entering={FadeIn.duration(300)} style={styles.headline}>
                Cut, captioned,{'\n'}
                <Text style={{ color: HIGHLIGHT }}>ready to post.</Text>
              </Animated.Text>
            )}
            <View style={styles.steps}>
              {STEPS.map((st) => {
                const done = progress >= st.done;
                return (
                  <View key={st.label} style={styles.step}>
                    <View style={[styles.stepIcon, done && styles.stepIconDone]}>
                      <SymbolView name={done ? 'checkmark' : st.icon} tintColor={done ? '#fff' : theme.muted} size={done ? 10 : 12} weight={done ? 'bold' : 'regular'} />
                    </View>
                    <Text style={[styles.stepText, done && { color: theme.ink }]}>{st.label}</Text>
                  </View>
                );
              })}
            </View>
            {phase === 'ready' ? (
              <Animated.View entering={FadeInDown.duration(380).easing(ease)}>
                <Button title="Try it with your video" onPress={start} />
              </Animated.View>
            ) : (
              <View style={{ height: 56 }} />
            )}
            <Text style={styles.note}>Sample clip. Nothing uploaded, no permissions needed.</Text>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  top: { height: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  side: { width: 70 },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  brandText: { fontSize: 21, fontFamily: BRAND_FONT, color: theme.ink, letterSpacing: -0.4 },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(17,17,20,0.06)', alignItems: 'center', justifyContent: 'center' },
  pill: { backgroundColor: 'rgba(17,17,20,0.06)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  pillText: { color: theme.ink, fontSize: 14, fontWeight: '700' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardShadow: { backgroundColor: '#1C1C1F', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
  card: { flex: 1, overflow: 'hidden', backgroundColor: '#1C1C1F' },
  chip: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(17,17,20,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipDone: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  // The same height in every step, so the card never jumps as the words change.
  bottom: { height: 262, justifyContent: 'flex-end', paddingHorizontal: 22 },
  headline: { fontSize: 34, fontWeight: '800', color: theme.ink, letterSpacing: -1, lineHeight: 38, textAlign: 'center' },
  sub: { fontSize: 15, color: theme.muted, lineHeight: 21, textAlign: 'center' },
  signIn: { fontSize: 14, color: theme.muted, textAlign: 'center', marginTop: 4 },
  signInLink: { color: theme.ink, fontWeight: '700' },
  transcriptCard: {
    backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  transcript: { fontSize: 20, fontWeight: '700', color: theme.ink, letterSpacing: -0.3, lineHeight: 26, minHeight: 52 },
  unsaid: { color: 'transparent' },
  saying: { fontWeight: '900' },
  // Centred as a group; the ticks still line up down the left of it.
  steps: { gap: 8, alignSelf: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(17,17,20,0.07)', alignItems: 'center', justifyContent: 'center' },
  stepIconDone: { backgroundColor: theme.ink },
  stepText: { fontSize: 15, fontWeight: '600', color: theme.faint },
  note: { fontSize: 11, color: theme.faint, textAlign: 'center' },
});
