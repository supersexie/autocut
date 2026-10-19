import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, PreAppFont } from '../components/ui';
import { clearDraft } from '../lib/draft';
import WORDS from '../lib/introWords.json';
import { column, formatTime, theme } from '../lib/theme';
import { JAKARTA } from '../lib/fonts';

// The sample: one take, raw and edited. They're the same take frame for frame, so the edit can
// take over mid-sentence. WORDS is the raw take transcribed by Autocut itself (src/transcribe.js).
const RAW = require('../../assets/intro/raw.mp4');
const EDITED = require('../../assets/intro/edited.mp4');
const LENGTH = 24.5;
/** When the edit takes over: the end of the first sentences, once the reading has been seen. */
const READY_AT = 6.4;
const ease = Easing.out(Easing.cubic);
/** The colour the video fades into at the bottom, and the plain screen under it where the words sit. */
const FADE = '#F5F7FF';
// The fade into it, eased in (smoothstep) over many stops so it has no visible start or bands.
const FADE_AT = Array.from({ length: 11 }, (_, i) => i / 10);
const FADE_COLORS = FADE_AT.map((t) => `rgba(245,247,255,${(t * t * (3 - 2 * t)).toFixed(3)})`) as unknown as readonly [string, string, ...string[]];

type Word = { t: string; s: number; e: number };

/** What Autocut is doing, under the track while it reads the take. */
const STEPS = [
  { label: 'Reading the take', until: 0.34 },
  { label: 'Cutting ums and retakes', until: 0.68 },
  { label: 'Captioning every word', until: 1 },
];
type Phase = 'intro' | 'reading' | 'ready';

// expo-video is driven by setting properties on the player.
const setPlayer = (p: VideoPlayer, patch: { muted?: boolean; loop?: boolean; currentTime?: number }) => {
  Object.assign(p, patch);
};

/** Where each sentence ends, as a share of the take: the joins in the track. */
const JOINS = (WORDS as Word[]).filter((w, i, all) => /[.?!]$/.test(w.t) && i < all.length - 1).map((w) => w.e / LENGTH);

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
 * What a new user sees first, like CutAI: a real raw take fills the screen and fades into the wash
 * under the headline. "See it happen" plays it with sound while Autocut reads it (the words type on
 * over a track of the take), then the edited version takes over at the same moment and plays on.
 * Nothing is uploaded.
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
  const { height } = useWindowDimensions();
  // Reading: how far through the reading it is (it hands over at READY_AT). The track shows the take.
  const progress = phase === 'ready' ? 1 : phase === 'reading' ? Math.min(1, time / READY_AT) : 0;
  const at = Math.min(1, time / LENGTH);
  const doing = STEPS.find((st) => progress < st.until) ?? STEPS[STEPS.length - 1];

  return (
    <PreAppFont>
    <View style={styles.screen}>
      {/* The take, full width from the top, fading into the wash where the words are. */}
      {/* Down to just behind the headline, so the words sit where the fade has turned light. */}
      <View style={[styles.video, { height: height - insets.bottom - 245 }]} pointerEvents="none">
        <VideoView player={raw} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        <Animated.View style={[StyleSheet.absoluteFill, editStyle]}>
          <VideoView player={edited} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        </Animated.View>
        <LinearGradient colors={['rgba(0,0,0,0.28)', 'rgba(0,0,0,0)']} style={[styles.shade, { height: insets.top + 70 }]} />
        <LinearGradient colors={FADE_COLORS} locations={FADE_AT as unknown as readonly [number, number, ...number[]]} style={styles.fade} />
      </View>

      <View style={[styles.top, { top: insets.top + 8 }]}>
        <View style={styles.side}>
          {phase === 'ready' ? (
            <Animated.View entering={FadeIn.duration(250)}>
              <Pressable onPress={() => setMuted((m) => !m)} hitSlop={10} style={styles.round} accessibilityLabel={muted ? 'Sound on' : 'Sound off'}>
                <SymbolView name={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} tintColor={theme.ink} size={14} />
              </Pressable>
            </Animated.View>
          ) : phase === 'intro' ? (
            <Animated.View exiting={FadeOut.duration(150)} style={styles.chip}>
              <Text style={styles.chipText}>RAW TAKE · {formatTime(LENGTH)}</Text>
            </Animated.View>
          ) : null}
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

      <View style={[styles.bottom, column(), { paddingBottom: insets.bottom + 10 }]}>
        {phase === 'intro' ? (
          <Animated.View key="intro" exiting={FadeOut.duration(180)} style={{ gap: 10 }}>
            <Text style={styles.headline}>Raw take in.{'\n'}Tight <Text style={{ color: theme.blue }}>cut</Text> out.</Text>
            <Text style={styles.sub}>Autocut cuts the dead air, ums and retakes, and captions every word. You just film.</Text>
            <Button title="See it happen" icon={<SymbolView name="play.fill" tintColor="#fff" size={14} />} onPress={seeIt} style={{ marginTop: 8 }} />
            <Text style={styles.signIn}>
              Have an account?{' '}
              <Text style={styles.signInLink} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'sign-in' } })}>
                Sign in
              </Text>
            </Text>
          </Animated.View>
        ) : (
          <Animated.View key="demo" entering={FadeInDown.duration(380).easing(ease)} style={{ gap: 12 }}>
            {/* What's being said, word by word: said words dark, the rest still to come in grey. */}
            <Text style={styles.transcript} numberOfLines={2}>
              {line?.map((w, i) => (
                <Text key={`${w.s}-${i}`} style={w.s > time && styles.unsaid}>
                  {w.t}{' '}
                </Text>
              ))}
            </Text>
            <Track ready={phase === 'ready'} at={at} />
            <View style={styles.status}>
              {phase === 'ready' ? (
                <Animated.View key="done" entering={FadeIn.duration(250)} style={styles.statusLeft}>
                  <SymbolView name="checkmark.circle.fill" tintColor={theme.ink} size={15} />
                  <Text style={[styles.statusText, { color: theme.ink }]}>Edit ready</Text>
                </Animated.View>
              ) : (
                <Text style={styles.statusText}>{doing.label}</Text>
              )}
              {phase === 'ready' ? (
                <Animated.Text entering={FadeIn.duration(250)} style={[styles.length, { color: theme.blue, fontSize: 15, fontFamily: JAKARTA.medium }]}>
                  Cut and captioned
                </Animated.Text>
              ) : (
                <Text style={styles.length}>{formatTime(LENGTH)}</Text>
              )}
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
    </PreAppFont>
  );
}

/**
 * The take as a track. While it's read: a thin line that fills as it plays, with a mark at the end of
 * each sentence. Once the edit is ready: a solid blue bar in pieces, one a sentence, with the playhead.
 */
function Track({ ready, at }: { ready: boolean; at: number }) {
  const [w, setW] = useState(0);
  const cuts = [0, ...JOINS, 1];
  return (
    <View style={styles.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 &&
        (ready ? (
          <Animated.View entering={FadeIn.duration(300)} style={StyleSheet.absoluteFill}>
            {cuts.slice(0, -1).map((c, i) => (
              <View key={i} style={[styles.piece, { left: c * w + (i ? 1.5 : 0), width: (cuts[i + 1] - c) * w - (i ? 1.5 : 0) - (i < cuts.length - 2 ? 1.5 : 0) }]} />
            ))}
            <View style={[styles.head, { left: Math.max(0, at * w - 1.5), backgroundColor: theme.ink }]} />
          </Animated.View>
        ) : (
          <>
            <View style={styles.rail} />
            <View style={[styles.railFill, { width: at * w }]} />
            {JOINS.map((j) => (
              <View key={j} style={[styles.join, { left: j * w - 5, backgroundColor: j <= at ? theme.ink : 'rgba(17,17,20,0.3)' }]} />
            ))}
            <View style={[styles.head, { left: Math.max(0, at * w - 1.5) }]} />
          </>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: FADE },
  video: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#1C1C1F', overflow: 'hidden' },
  shade: { position: 'absolute', top: 0, left: 0, right: 0 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  side: { minWidth: 70 },
  round: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  pill: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  pillText: { color: theme.ink, fontSize: 14, fontFamily: JAKARTA.bold },
  chip: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { color: theme.ink, fontSize: 10.5, fontFamily: JAKARTA.extrabold, letterSpacing: 0.7 },
  // Pinned to the bottom; the words, track and button sit over the fade.
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 22 },
  headline: { fontSize: 38, fontFamily: JAKARTA.bold, color: theme.ink, letterSpacing: -1.1, lineHeight: 44 },
  sub: { fontSize: 16, fontFamily: JAKARTA.medium, color: theme.muted, lineHeight: 22 },
  signIn: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted, textAlign: 'center', marginTop: 6 },
  signInLink: { color: theme.ink, fontFamily: JAKARTA.bold },
  transcript: { fontSize: 21, fontFamily: JAKARTA.extrabold, color: theme.ink, letterSpacing: -0.4, lineHeight: 27, minHeight: 54 },
  unsaid: { color: 'rgba(17,17,20,0.22)' },
  track: { height: 14, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(17,17,20,0.14)' },
  railFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: theme.ink },
  join: { position: 'absolute', width: 10, height: 10, borderRadius: 3 },
  piece: { position: 'absolute', top: 3, height: 8, borderRadius: 4, backgroundColor: theme.blue },
  head: { position: 'absolute', top: 0, width: 3, height: 14, borderRadius: 2, backgroundColor: theme.blue },
  status: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 13, fontFamily: JAKARTA.bold, color: theme.muted },
  length: { fontSize: 18, fontFamily: JAKARTA.extrabold, color: theme.ink, fontVariant: ['tabular-nums'] },
  note: { fontSize: 11, fontFamily: JAKARTA.medium, color: theme.faint, textAlign: 'center' },
});
