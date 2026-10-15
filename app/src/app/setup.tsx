import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { Choice, HIGHLIGHT, OnbHeader, OnbScreen, OnbTitle } from '../components/Onboarding';
import { PlanPicker } from '../components/PlanPicker';
import { AppleLogo, Button, ErrorText, GoogleLogo, type SymbolName } from '../components/ui';
import { openLegal } from '../lib/api';
import { socialOptions, useAuth } from '../lib/auth';
import { updateDraft, useDraft, type Draft } from '../lib/draft';
import { AUTOCUT_MINUTES, BY_HAND_MINUTES, EDITOR_COSTS, editorMonthly, money, PER_WEEK, planFor, pricePerMonth, recommendedPlan, videosPerWeek } from '../lib/plans';
import { midSentence, theme } from '../lib/theme';

type Answer = { value: string; label: string; icon: SymbolName };

const WHO: Answer[] = [
  { value: 'shop', label: 'TikTok Shop creator', icon: 'bag' },
  { value: 'ugc', label: 'UGC creator', icon: 'video' },
  { value: 'influencer', label: 'Influencer', icon: 'star' },
  { value: 'me', label: 'Just me', icon: 'person' },
];

const GOAL: Answer[] = [
  { value: 'more', label: 'Post more videos', icon: 'chart.line.uptrend.xyaxis' },
  { value: 'time', label: 'Save time', icon: 'clock' },
  { value: 'freedom', label: 'Have more freedom', icon: 'sun.max' },
  { value: 'editor', label: 'Fire my editor', icon: 'person.badge.minus' },
];

// What an editor costs a month (the "nothing" answer from before stays valid for saved profiles).
const COSTS = EDITOR_COSTS.filter((c) => c.bars > 0);

type StepId = 'who' | 'goal' | 'volume' | 'time' | 'cost' | 'adds' | 'months' | 'plan' | 'save';
const STEPS: StepId[] = ['who', 'goal', 'volume', 'time', 'cost', 'adds', 'months', 'plan', 'save'];

// How many videos a week, with an icon that grows with the number.
const VOLUME_ICONS: SymbolName[] = ['video', 'film', 'film.stack', 'flame'];

/** What they'd pay for Autocut: the plan that suits them, at its yearly price (the one they start on). */
function autocutFor(draft: Draft) {
  const plan = planFor(draft.plan ?? recommendedPlan(draft.editorCost, draft.perWeek));
  return { plan, monthly: pricePerMonth(plan.monthly, 'yearly'), list: plan.monthly };
}

export default function Setup() {
  const draft = useDraft();
  const [step, setStep] = useState<StepId>('who');
  const leaving = useRef(false);
  const index = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  const back = () => (index === 0 ? router.back() : setStep(STEPS[index - 1]));

  // Picking an answer moves on by itself after a beat, like CutAI.
  const pick = (patch: Draft) => {
    Haptics.selectionAsync();
    updateDraft(patch);
    if (leaving.current) return;
    leaving.current = true;
    setTimeout(() => {
      leaving.current = false;
      setStep((s) => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(s) + 1)]);
    }, 380);
  };

  const signIn = (
    <Text style={styles.signIn} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'sign-in' } })}>
      Sign in
    </Text>
  );
  const header = <OnbHeader step={index} steps={STEPS.length} onBack={index === 0 ? undefined : back} right={step === 'plan' ? signIn : undefined} />;
  const nextButton = (ready: boolean) => <Button title="Next  →" onPress={next} disabled={!ready} />;

  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  if (step === 'volume') {
    footer = nextButton(!!draft.perWeek);
    body = (
      <>
        <OnbTitle sub="Roughly is fine.">How many videos do you post a week?</OnbTitle>
        <View style={{ gap: 12 }}>
          {PER_WEEK.map((p, i) => (
            <Choice key={p.value} index={i} label={p.label} icon={VOLUME_ICONS[i]} selected={draft.perWeek === p.value} onPress={() => pick({ perWeek: p.value })} />
          ))}
        </View>
      </>
    );
  } else if (step === 'time') {
    return <TimeSaved key="time" header={header} draft={draft} onNext={next} />;
  } else if (step === 'who' || step === 'goal' || step === 'cost') {
    const key = step === 'who' ? 'who' : step === 'goal' ? 'goal' : 'editorCost';
    footer = nextButton(!!draft[key]);
    body =
      step === 'cost' ? (
        <>
          <OnbTitle sub="Per month.">How much are you currently paying for your editor?</OnbTitle>
          <View style={{ gap: 12 }}>
            {COSTS.map((c, i) => (
              <Choice key={c.value} index={i} label={c.label} bars={c.bars} selected={draft.editorCost === c.value} onPress={() => pick({ editorCost: c.value })} />
            ))}
          </View>
        </>
      ) : (
        <>
          <OnbTitle>{step === 'who' ? 'Who are you?' : 'What’s your goal?'}</OnbTitle>
          <View style={{ gap: 12 }}>
            {(step === 'who' ? WHO : GOAL).map((o, i) => (
              <Choice key={o.value} index={i} label={o.label} icon={o.icon} selected={draft[key] === o.value} onPress={() => pick({ [key]: o.value })} />
            ))}
          </View>
        </>
      );
  } else if (step === 'adds') {
    return <AddsUp key="adds" header={header} draft={draft} onNext={next} />;
  } else if (step === 'months') {
    return <Months key="months" header={header} draft={draft} onNext={next} />;
  } else if (step === 'plan') {
    return <PlanPicker mode="setup" header={header} onDone={next} />;
  } else {
    return <Save header={header} draft={draft} />;
  }

  return (
    <OnbScreen header={header} footer={footer}>
      <Animated.View key={step} entering={FadeIn.duration(260)} exiting={FadeOut.duration(140)}>
        {body}
      </Animated.View>
    </OnbScreen>
  );
}

/** Eases 0 → 1 over `ms` (after `delay`), for the chart and counters. */
function useProgress(ms: number, delay = 300) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const start = Date.now() + delay;
    let frame = 0;
    const tick = () => {
      const t = Math.max(0, Math.min(1, (Date.now() - start) / ms));
      setP(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ms, delay]);
  return p;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A smooth curve through the points that never overshoots them (monotone cubic Hermite), sampled
 * finely so it can be drawn part-way. No bumps, dips or corners. Each point's slope is the average
 * of the lines either side, capped at 3× the gentler one: the most a curve can lean in while staying
 * monotone, so it starts rising before a steep stretch instead of turning sharply at the point.
 */
function spline(pts: [number, number][], samples = 240): [number, number][] {
  const n = pts.length;
  const h = pts.slice(1).map(([x], i) => x - pts[i][0]);
  const d = pts.slice(1).map(([, y], i) => (y - pts[i][1]) / (h[i] || 1));
  const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  // The slope at each point: gentle where the line is flat, never steeper than its neighbours allow.
  const m = pts.map((_, i) => {
    if (i === 0) return h[0] ? (3 * d[0] - inner(1)) / 2 : 0;
    if (i === n - 1) return h[n - 2] ? (3 * d[n - 2] - inner(n - 2)) / 2 : 0;
    return inner(i);
  });
  function inner(i: number) {
    if (i <= 0 || i >= n - 1) return d[Math.max(0, Math.min(n - 2, i))];
    if (sign(d[i - 1]) !== sign(d[i]) || !d[i]) return 0;
    const mean = (d[i - 1] + d[i]) / 2;
    return sign(mean) * Math.min(Math.abs(mean), 3 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i])));
  }
  const out: [number, number][] = [];
  const x0 = pts[0][0], x1 = pts[n - 1][0];
  for (let s = 0; s <= samples; s++) {
    const x = x0 + ((x1 - x0) * s) / samples;
    let i = 0;
    while (i < n - 2 && x > pts[i + 1][0]) i++;
    const t = (x - pts[i][0]) / (h[i] || 1);
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h[i] * m[i + 1];
    out.push([x, y]);
  }
  return out;
}

/** "45 min", "1 hr", "13.5 hrs". */
const hrs = (h: number) => (h < 1 ? `${Math.max(5, Math.round((h * 60) / 5) * 5)} min` : `${Math.round(h * 2) / 2} hr${h >= 1.25 ? 's' : ''}`);

const RING = 210;
const RING_STROKE = 16;

/**
 * "Autocut gives you back 13.5 hrs a week": a ring fills to the share of editing time they get
 * back while the hours count up inside it, then the two ways of cutting race as bars (by hand
 * fills the track, Autocut barely starts), and what that comes to over a year lands last.
 */
function TimeSaved({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const p = useProgress(2600, 350);
  const videos = videosPerWeek(draft.perWeek) || 2;
  const byHand = (videos * BY_HAND_MINUTES) / 60;
  const withAutocut = (videos * AUTOCUT_MINUTES) / 60;
  const saved = byHand - withAutocut;
  const share = saved / byHand;
  const days = Math.round((saved * 52) / 24);
  const ring = easeOut(clamp01(p / 0.55));
  const bars = clamp01((p - 0.4) / 0.4);
  const year = clamp01((p - 0.82) / 0.18);
  useEffect(() => {
    if (year >= 1) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [year]);
  const r = (RING - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const bar = (label: string, hours: number, fill: number, strong: boolean) => (
    <View style={{ gap: 6 }}>
      <View style={styles.compare}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={[styles.barValue, { opacity: clamp01(bars * 2) }]}>{hrs(hours * easeOut(bars))} a week</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.max(2, 100 * fill * easeOut(bars))}%`, backgroundColor: strong ? theme.ink : '#C9C9CF' }]} />
      </View>
    </View>
  );
  return (
    <OnbScreen header={header} footer={<Button title="Next  →" onPress={onNext} disabled={p < 1} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle center>Autocut gives you back</OnbTitle>
        <View style={styles.ringWrap}>
          <Svg width={RING} height={RING} style={{ transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke="rgba(17,17,20,0.08)" strokeWidth={RING_STROKE} fill="none" />
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={r}
              stroke={theme.ink}
              strokeWidth={RING_STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${c} ${c}`}
              strokeDashoffset={c * (1 - share * ring)}
            />
          </Svg>
          <View style={styles.ringCenter}>
            <Text style={styles.ringValue}>{hrs(saved * ring)}</Text>
            <Text style={styles.ringSub}>every week</Text>
          </View>
        </View>
        <View style={[styles.card, { marginTop: 22, gap: 16 }]}>
          {bar('Cutting by hand', byHand, 1, false)}
          {bar('With Autocut', withAutocut, withAutocut / byHand, true)}
        </View>
        <View style={[styles.yearPill, { opacity: year, transform: [{ translateY: 10 * (1 - year) }, { scale: 0.96 + 0.04 * year }] }]}>
          <SymbolView name="calendar" tintColor="#fff" size={15} />
          <Text style={styles.yearText}>That’s {days} full day{days === 1 ? '' : 's'} back a year</Text>
        </View>
        <Text style={styles.caption}>
          For about {Math.round(videos)} videos a week, at {BY_HAND_MINUTES} minutes each by hand.
        </Text>
      </Animated.View>
    </OnbScreen>
  );
}

/**
 * "It adds up.": what they keep by switching, a day, a week, a month and a year. The curve draws
 * itself left to right, each amount counts up as the line reaches it, and the year lands last.
 */
function AddsUp({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const p = useProgress(1900);
  const [w, setW] = useState(0);
  const editor = editorMonthly(draft.editorCost);
  const { plan, monthly } = autocutFor(draft);
  const year = Math.max(0, Math.round((editor - monthly) * 12));
  const values = [year / 365, year / 52, year / 12, year];
  const labels = ['Day', 'Week', 'Month', 'Year'];
  const H = 250;
  const TOP = 40; // room for the year's label
  const BASE = H - 8;
  const xs = [0.08, 0.36, 0.64, 0.92].map((f) => f * w);
  const y = (v: number) => BASE - (v / Math.max(1, year)) * (BASE - TOP);
  const pts = values.map((v, i) => [xs[i], y(v)] as [number, number]);
  const drawn = easeOut(p);
  const curve = w ? spline(pts).filter(([x]) => x <= xs[0] + (xs[3] - xs[0]) * drawn + 0.5) : [];
  const line = curve.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join(' ');
  const end = curve[curve.length - 1];
  const area = end ? `${line} L${end[0].toFixed(1)} ${BASE} L${xs[0].toFixed(1)} ${BASE} Z` : '';
  // Each point arrives as the line reaches it (the year just before the end); its amount counts up over a moment.
  const reached = (i: number) => clamp01((drawn - (i / 3) * 0.9) / 0.1);
  const landed = values.filter((_, i) => reached(i) >= 1).length;
  useEffect(() => {
    if (landed > 1 && landed < 4) Haptics.selectionAsync();
    if (landed === 4) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [landed]);

  return (
    <OnbScreen header={header} footer={<Button title="See my editor vs. Autocut  →" onPress={onNext} disabled={p < 1} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle>It adds up.</OnbTitle>
        <View style={{ height: H, marginTop: 6 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w > 0 && (
            <Svg width={w} height={H}>
              <Defs>
                <LinearGradient id="keep" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={theme.ink} stopOpacity="0.16" />
                  <Stop offset="1" stopColor={theme.ink} stopOpacity="0.02" />
                </LinearGradient>
              </Defs>
              {[0, 1, 2, 3, 4].map((g) => {
                const gy = TOP + (g / 4) * (BASE - TOP);
                return <Line key={g} x1={0} x2={w} y1={gy} y2={gy} stroke="rgba(17,17,20,0.12)" strokeWidth={1} strokeDasharray="3 5" />;
              })}
              <Line x1={0} x2={w} y1={BASE} y2={BASE} stroke="rgba(17,17,20,0.2)" strokeWidth={1} />
              {area ? <Path d={area} fill="url(#keep)" /> : null}
              {line ? <Path d={line} stroke={theme.ink} strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
              {pts.map(([px, py], i) =>
                reached(i) > 0 ? (
                  i === 3 ? (
                    <Circle key={i} cx={px} cy={py} r={9 * easeOut(reached(i))} fill={theme.ink} stroke="#fff" strokeWidth={3} />
                  ) : (
                    <Circle key={i} cx={px} cy={py} r={6 * easeOut(reached(i))} fill="#fff" stroke={theme.ink} strokeWidth={2.5} />
                  )
                ) : null
              )}
            </Svg>
          )}
          {w > 0 &&
            pts.map(([px, py], i) =>
              reached(i) > 0 ? (
                <Text key={i} style={[styles.amount, i === 3 && styles.amountBig, { left: px - 50 - (i === 2 ? 18 : 0) /* the month's, clear of the rising line */, top: py - (i === 3 ? 36 : 28), opacity: clamp01(reached(i) * 2) }]}>
                  {money(Math.round(values[i] * easeOut(reached(i))))}
                </Text>
              ) : null
            )}
        </View>
        <View style={{ height: 22 }}>
          {w > 0 &&
            labels.map((l, i) => (
              <Text key={l} style={[styles.axis, { left: xs[i] - 40 }]}>
                {l}
              </Text>
            ))}
        </View>
        <Text style={styles.caption}>What you keep by switching to Autocut.</Text>
        <View style={[styles.card, { opacity: clamp01((p - 0.7) / 0.3) }]}>
          <View style={styles.compare}>
            <Text style={styles.compareLabel}>Your editor</Text>
            <Text style={styles.compareValue}>{money(editor)} a month</Text>
          </View>
          <View style={styles.rule} />
          <View style={styles.compare}>
            <Text style={styles.compareLabel}>Autocut {plan.name}</Text>
            <Text style={styles.compareValue}>{money(monthly)} a month</Text>
          </View>
          <Text style={styles.small}>Autocut billed yearly. Editor from your answer.</Text>
        </View>
      </Animated.View>
    </OnbScreen>
  );
}

const DOT = 30;
const PER_ROW = 6;

/**
 * "One month of your editor pays for N months of Autocut.": a dot for each month of Autocut drops
 * in, one after another, and the number counts up with them.
 */
function Months({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const editor = editorMonthly(draft.editorCost);
  const { list } = autocutFor(draft);
  const n = Math.max(1, Math.floor(editor / list));
  // A dot a month, or a dot for two or three when there are a lot of them.
  const unit = Math.ceil(n / 30);
  const dots = Math.ceil(n / unit);
  const p = useProgress(Math.min(1800, 300 + dots * 80), 500);
  const lit = Math.min(dots, Math.floor(p * dots + 0.0001));
  const shown = lit === dots ? n : Math.min(n, lit * unit);
  useEffect(() => {
    if (lit > 0 && lit < dots) Haptics.selectionAsync();
    if (lit === dots) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [lit, dots]);
  return (
    <OnbScreen header={header} footer={<Button title="See my plan  →" onPress={onNext} disabled={lit < dots} />}>
      <Animated.View entering={FadeIn.duration(260)} style={{ paddingTop: 18 }}>
        <Text style={styles.monthsTitle}>
          One month of your editor pays for{'\n'}
          <Text style={{ color: HIGHLIGHT }}>{shown}</Text> month{n === 1 ? '' : 's'} of Autocut.
        </Text>
        <View style={styles.equation}>
          <View style={styles.editorBubble}>
            <Text style={styles.bubbleTop}>1 month</Text>
            <Text style={styles.bubbleSub}>Your editor</Text>
          </View>
          <Text style={styles.equals}>=</Text>
          <View style={[styles.dots, { width: Math.min(dots, PER_ROW) * (DOT + 8) }]}>
            {Array.from({ length: dots }, (_, i) => {
              const q = clamp01(p * dots - i);
              return <View key={i} style={[styles.dot, { opacity: q > 0 ? 1 : 0, transform: [{ scale: q > 0 ? 0.6 + 0.4 * easeOut(Math.min(1, q * 1.6)) : 0.6 }] }]} />;
            })}
          </View>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.dot, { width: 18, height: 18, borderWidth: 2.5 }]} />
          <Text style={styles.legendText}>{unit === 1 ? '1 month' : `${unit} months`} of Autocut</Text>
        </View>
      </Animated.View>
    </OnbScreen>
  );
}

/** Last step: what we set up from their answers, then an account to keep it. */
function Save({ header, draft }: { header: React.ReactNode; draft: Draft }) {
  const auth = useAuth();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState({ apple: false, google: false });
  const { plan } = autocutFor(draft);
  const who = WHO.find((m) => m.value === draft.who);

  useEffect(() => {
    socialOptions().then(setProviders);
  }, []);

  async function go(kind: 'apple' | 'google' | 'email') {
    if (kind === 'email') return router.push({ pathname: '/sign-in', params: { mode: 'sign-up' } });
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'apple' ? auth.signInWithApple() : auth.signInWithGoogle());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const points: { icon: SymbolName; text: string }[] = [
    { icon: 'scissors', text: who && who.value !== 'me' ? `Cuts tuned for ${/^[aeio]/i.test(who.label) ? 'an' : 'a'} ${midSentence(who.label)}` : 'Dead air, ums and retakes cut for you' },
    { icon: 'captions.bubble', text: 'Captions on every word' },
    { icon: 'checkmark.seal', text: `${plan.name}: ${midSentence(plan.edits)}` },
  ];

  return (
    <OnbScreen
      header={header}
      footer={
        <>
          <ErrorText>{error}</ErrorText>
          {providers.apple && <Button title="Continue with Apple" icon={<AppleLogo />} loading={busy === 'apple'} onPress={() => go('apple')} />}
          {providers.google && <Button kind="outline" title="Continue with Google" icon={<GoogleLogo />} loading={busy === 'google'} onPress={() => go('google')} />}
          <Button
            kind={providers.apple ? 'outline' : 'primary'}
            title="Continue with email"
            icon={<SymbolView name="envelope" tintColor={providers.apple ? theme.ink : '#fff'} size={17} />}
            onPress={() => go('email')}
          />
          <Text style={styles.legal}>
            By continuing you agree to the{' '}
            <Text style={styles.legalLink} onPress={() => openLegal('terms')}>
              Terms
            </Text>{' '}
            and{' '}
            <Text style={styles.legalLink} onPress={() => openLegal('privacy')}>
              Privacy Policy
            </Text>
            .
          </Text>
        </>
      }
    >
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle sub="Create your account to keep it.">Your plan is ready</OnbTitle>
        <View style={styles.card}>
          {points.map((pt) => (
            <View key={pt.text} style={styles.point}>
              <View style={styles.pointIcon}>
                <SymbolView name={pt.icon} tintColor={theme.ink} size={16} />
              </View>
              <Text style={styles.pointText}>{pt.text}</Text>
            </View>
          ))}
        </View>
        <Pressable onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'sign-in' } })} hitSlop={8} style={{ alignSelf: 'center', marginTop: 18 }}>
          <Text style={styles.have}>
            Already have an account? <Text style={{ color: theme.ink, fontWeight: '700' }}>Sign in</Text>
          </Text>
        </Pressable>
      </Animated.View>
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  signIn: { fontSize: 16, fontWeight: '600', color: theme.ink },
  ringWrap: { alignSelf: 'center', width: RING, height: RING, marginTop: 4 },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringValue: { fontSize: 40, fontWeight: '800', color: theme.ink, letterSpacing: -1.2, fontVariant: ['tabular-nums'] },
  ringSub: { fontSize: 15, color: theme.muted, marginTop: 2 },
  barLabel: { fontSize: 15, fontWeight: '600', color: theme.ink },
  barValue: { fontSize: 15, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  track: { height: 12, borderRadius: 6, backgroundColor: 'rgba(17,17,20,0.06)', overflow: 'hidden' },
  trackFill: { height: 12, borderRadius: 6 },
  yearPill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginTop: 20 },
  yearText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  amount: { position: 'absolute', width: 100, textAlign: 'center', fontSize: 15, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  amountBig: { fontSize: 18, color: theme.cut }, // the year, in red
  axis: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 14, color: theme.muted },
  caption: { fontSize: 15, color: theme.muted, textAlign: 'center', marginTop: 10 },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 12, marginTop: 24,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  compare: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  compareLabel: { fontSize: 16, fontWeight: '600', color: theme.ink },
  compareValue: { fontSize: 16, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  small: { fontSize: 12, color: theme.faint },
  monthsTitle: { fontSize: 32, fontWeight: '800', color: theme.ink, letterSpacing: -1, lineHeight: 38, textAlign: 'center', fontVariant: ['tabular-nums'] },
  equation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 30 },
  editorBubble: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  bubbleTop: { fontSize: 15, fontWeight: '800', color: theme.ink },
  bubbleSub: { fontSize: 11, color: theme.muted, marginTop: 1 },
  equals: { fontSize: 28, fontWeight: '700', color: theme.muted },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.ink, borderWidth: 4, borderColor: '#C9C9CF' },
  legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 26 },
  legendText: { fontSize: 15, color: theme.muted, fontWeight: '500' },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F1F1F4', alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, fontSize: 15, color: theme.ink, lineHeight: 20 },
  have: { fontSize: 14, color: theme.muted },
  legal: { fontSize: 12, color: theme.muted, textAlign: 'center', lineHeight: 17, marginTop: 2 },
  legalLink: { color: theme.ink, fontWeight: '600', textDecorationLine: 'underline' },
});
