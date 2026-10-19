import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { Choice, HIGHLIGHT, OnbHeader, OnbScreen, OnbTitle, onbCard, StepSlider, Tip } from '../components/Onboarding';
import { PlanPicker } from '../components/PlanPicker';
import { AppleLogo, Button, ErrorText, GoogleLogo, Segmented, type SymbolName } from '../components/ui';
import { openLegal } from '../lib/api';
import { socialOptions, useAuth } from '../lib/auth';
import { updateDraft, useDraft, type Draft } from '../lib/draft';
import {
  AUTOCUT_MINUTES, DAYS_A_MONTH, EDIT_STOPS, EDITOR_PER_VIDEO, editingNumbers, money, perWeekFor, planFor, PLANS, pricePerMonth, recommendedPlan, VOLUME_STOPS,
} from '../lib/plans';
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

// Like CutAI: two questions, two sliders, then what that adds up to, then the plan and an account.
type StepId = 'who' | 'goal' | 'volume' | 'time' | 'spend' | 'adds' | 'life' | 'plan' | 'save';
const STEPS: StepId[] = ['who', 'goal', 'volume', 'time', 'spend', 'adds', 'life', 'plan', 'save'];

// Where the sliders start: 1 a day, and an hour a video.
const VOLUME_START = VOLUME_STOPS.findIndex((v) => v.unit === 'a day' && v.n === 1);
const EDIT_START = EDIT_STOPS.indexOf(60);

/** What they'd pay for Autocut: the plan that suits them, at its yearly price (the one they start on). */
function autocutFor(draft: Draft) {
  const plan = planFor(draft.plan ?? recommendedPlan(draft.editorCost, draft.perWeek, draft.perDay));
  return { plan, monthly: pricePerMonth(plan.monthly, 'yearly'), list: plan.monthly };
}

/** Everything the result screens show, from the two sliders. */
function numbersFor(draft: Draft) {
  const perDay = draft.perDay ?? VOLUME_STOPS[VOLUME_START].perDay;
  const minutes = draft.editMinutes ?? EDIT_STOPS[EDIT_START];
  const { plan, monthly } = autocutFor(draft);
  return { perDay, minutes, plan, monthly, ...editingNumbers(perDay, minutes, monthly) };
}

/** "11 h 56 min", "45 min", "12 h". */
function hm(hours: number) {
  const total = Math.round(hours * 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
/** Hours for the bigger amounts: "84 h", "4,344 h" (and "45 min" when it's under an hour). */
const bigHours = (h: number) => (h < 10 ? hm(h) : `${Math.round(h).toLocaleString('en-US')} h`);
/** "20 minutes", "1 hour", "1.5 hours", "4+ hours" (the last stop). */
function editLabel(minutes: number) {
  if (minutes < 60) return { n: String(minutes), unit: 'minutes a video' };
  const h = minutes / 60;
  if (minutes === EDIT_STOPS[EDIT_STOPS.length - 1]) return { n: `${h}+`, unit: 'hours a video' };
  return { n: String(h), unit: h === 1 ? 'hour a video' : 'hours a video' };
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

  if (step === 'volume') return <Volume key="volume" header={header} draft={draft} onNext={next} />;
  if (step === 'time') return <EditTime key="time" header={header} draft={draft} onNext={next} />;
  if (step === 'spend') return <Spend key="spend" header={header} draft={draft} onNext={next} />;
  if (step === 'adds') return <AddsUp key="adds" header={header} draft={draft} onNext={next} />;
  if (step === 'life') return <Life key="life" header={header} draft={draft} onNext={next} />;
  if (step === 'plan') return <PlanPicker mode="setup" header={header} onDone={next} />;
  if (step === 'save') return <Save header={header} draft={draft} />;

  const key = step === 'who' ? 'who' : 'goal';
  return (
    <OnbScreen header={header} footer={<Button title="Next  →" onPress={next} disabled={!draft[key]} />}>
      <Animated.View key={step} entering={FadeIn.duration(260)} exiting={FadeOut.duration(140)}>
        <OnbTitle>{step === 'who' ? 'Who are you?' : 'What’s your goal?'}</OnbTitle>
        <View style={{ gap: 12 }}>
          {(step === 'who' ? WHO : GOAL).map((o, i) => (
            <Choice key={o.value} index={i} label={o.label} icon={o.icon} selected={draft[key] === o.value} onPress={() => pick({ [key]: o.value })} />
          ))}
        </View>
      </Animated.View>
    </OnbScreen>
  );
}

/** A big number and its unit over a slider, on a white card ("4 a day", "45 minutes a video"). */
function SliderCard({ n, unit, children }: { n: string; unit: string; children: React.ReactNode }) {
  return (
    <View style={[onbCard, { paddingTop: 26, paddingBottom: 16 }]}>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{n}</Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
      <View style={{ marginTop: 18 }}>{children}</View>
    </View>
  );
}

function Volume({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const [i, setI] = useState(() => {
    const at = VOLUME_STOPS.findIndex((v) => Math.abs(v.perDay - (draft.perDay ?? -1)) < 0.001);
    return at >= 0 ? at : VOLUME_START;
  });
  const stop = VOLUME_STOPS[i];
  useEffect(() => {
    updateDraft({ perDay: stop.perDay, perWeek: perWeekFor(stop.perDay) });
  }, [stop.perDay]);
  return (
    <OnbScreen header={header} footer={<Button title="Next  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle>How many videos are you currently posting?</OnbTitle>
        <SliderCard n={String(stop.n)} unit={stop.unit}>
          <StepSlider stops={VOLUME_STOPS.length} index={i} onChange={setI} left="1 a week" right="10+ a day" />
        </SliderCard>
        <Tip icon="square.stack.3d.up">Batch edits take a whole week of takes in one go, so posting more doesn’t mean more editing.</Tip>
      </Animated.View>
    </OnbScreen>
  );
}

function EditTime({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const [i, setI] = useState(() => {
    const at = EDIT_STOPS.indexOf(draft.editMinutes ?? -1);
    return at >= 0 ? at : EDIT_START;
  });
  const minutes = EDIT_STOPS[i];
  useEffect(() => {
    updateDraft({ editMinutes: minutes });
  }, [minutes]);
  const label = editLabel(minutes);
  return (
    <OnbScreen header={header} footer={<Button title="Next  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle>How long do you spend editing?</OnbTitle>
        <SliderCard n={label.n} unit={label.unit}>
          <StepSlider stops={EDIT_STOPS.length} index={i} onChange={setI} left="5 minutes" right="4+ hours" />
        </SliderCard>
        <Tip icon="bolt">With Autocut it’s about {AUTOCUT_MINUTES} minutes a video: send the take, check the cut, export.</Tip>
      </Animated.View>
    </OnbScreen>
  );
}

/**
 * "You spend 12 h a day editing.": what they get back each month in hours, and in money against
 * hiring an editor. The numbers count up; how they were worked out opens under them.
 */
function Spend({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const n = numbersFor(draft);
  const p = easeOut(useProgress(1300, 250));
  const [how, setHow] = useState(false);
  const daily = n.spent >= 1;
  const monthHours = n.saved * DAYS_A_MONTH;
  useEffect(() => {
    const t = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 1550);
    return () => clearTimeout(t);
  }, []);
  return (
    <OnbScreen header={header} footer={<Button title="See my year  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle>
          You spend {hm(daily ? n.spent : n.spent * 7)} a {daily ? 'day' : 'week'} editing.
        </OnbTitle>
        <View style={{ gap: 12 }}>
          <View style={onbCard}>
            <View style={styles.statHead}>
              <SymbolView name="clock" tintColor={theme.blue} size={15} />
              <Text style={styles.statLabel}>You get back</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statBig}>{monthHours >= 1 ? Math.round(monthHours * p).toLocaleString('en-US') : Math.round(monthHours * 60 * p)}</Text>
              <Text style={styles.statUnit}>{monthHours >= 1 ? 'hours' : 'minutes'} a month with Autocut</Text>
            </View>
          </View>
          <View style={onbCard}>
            <View style={styles.statHead}>
              <SymbolView name="dollarsign.circle" tintColor={theme.blue} size={15} />
              <Text style={styles.statLabel}>You save</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statBig}>{money(Math.round(n.savedMoney * p))}</Text>
              <Text style={styles.statUnit}>a month vs. hiring an editor</Text>
            </View>
          </View>
        </View>
        <Pressable onPress={() => setHow((h) => !h)} hitSlop={8} style={styles.howRow} accessibilityRole="button" accessibilityState={{ expanded: how }}>
          <Text style={styles.how}>How we calculated this</Text>
          <SymbolView name={how ? 'chevron.up' : 'chevron.down'} tintColor={theme.blue} size={12} weight="semibold" />
        </Pressable>
        {how && (
          <Animated.Text entering={FadeIn.duration(200)} layout={LinearTransition} style={styles.howText}>
            You post about {Math.round(n.videosAMonth)} videos a month and spend {editLabel(n.minutes).n} {editLabel(n.minutes).unit.replace(' a video', '')} editing each. With Autocut a video
            takes about {AUTOCUT_MINUTES} minutes. An editor is counted at {money(EDITOR_PER_VIDEO)} a short video, against Autocut {n.plan.name} at {money(n.monthly)} a month
            billed yearly.
          </Animated.Text>
        )}
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


/**
 * "It adds up.": what they get back over a day, a week, a month and a year, in time or in money.
 * The curve draws itself left to right and each amount counts up as the line reaches it.
 */
function AddsUp({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const [mode, setMode] = useState<'time' | 'money'>('time');
  const n = numbersFor(draft);
  const year = mode === 'time' ? n.saved * 365 : n.savedMoney * 12;
  const values = [year / 365, year / 52, year / 12, year];
  const show = (v: number) => (mode === 'time' ? (v === values[0] ? hm(v) : bigHours(v)) : money(Math.round(v)));
  return (
    <OnbScreen header={header} footer={<Button title="Show me the real cost  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle>It adds up.</OnbTitle>
        <View style={{ alignSelf: 'center', width: 200, marginTop: -6, marginBottom: 6 }}>
          <Segmented value={mode} onChange={(m) => { Haptics.selectionAsync(); setMode(m); }} options={[{ value: 'time', label: 'Time' }, { value: 'money', label: 'Money' }]} />
        </View>
        <Curve key={mode} values={values} show={show} />
        <Text style={styles.caption}>{mode === 'time' ? 'The time you get back with Autocut.' : 'What you save vs. hiring an editor.'}</Text>
        <Tip icon="calendar">That’s {hm(n.saved)} back every day, for about {Math.round(n.videosAMonth)} videos a month.</Tip>
      </Animated.View>
    </OnbScreen>
  );
}

function Curve({ values, show }: { values: number[]; show: (v: number, i: number) => string }) {
  const p = useProgress(1700, 200);
  const [w, setW] = useState(0);
  const labels = ['Day', 'Week', 'Month', 'Year'];
  const top = values[3] || 1;
  const H = 230;
  const TOP = 40; // room for the year's label
  const BASE = H - 8;
  const xs = [0.08, 0.36, 0.64, 0.92].map((f) => f * w);
  const y = (v: number) => BASE - (v / top) * (BASE - TOP);
  const pts = values.map((v, i) => [xs[i], y(v)] as [number, number]);
  const drawn = easeOut(p);
  const curve = w ? spline(pts).filter(([x]) => x <= xs[0] + (xs[3] - xs[0]) * drawn + 0.5) : [];
  const line = curve.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join(' ');
  const end = curve[curve.length - 1];
  const area = end ? `${line} L${end[0].toFixed(1)} ${BASE} L${xs[0].toFixed(1)} ${BASE} Z` : '';
  const reached = (i: number) => clamp01((drawn - (i / 3) * 0.9) / 0.1);
  const landed = values.filter((_, i) => reached(i) >= 1).length;
  useEffect(() => {
    if (landed > 1 && landed < 4) Haptics.selectionAsync();
    if (landed === 4) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [landed]);
  return (
    <>
      <View style={{ height: H, marginTop: 6 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="keep" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={theme.blue} stopOpacity="0.22" />
                <Stop offset="1" stopColor={theme.blue} stopOpacity="0.02" />
              </LinearGradient>
            </Defs>
            {[0, 1, 2, 3, 4].map((g) => {
              const gy = TOP + (g / 4) * (BASE - TOP);
              return <Line key={g} x1={0} x2={w} y1={gy} y2={gy} stroke="rgba(17,17,20,0.1)" strokeWidth={1} strokeDasharray="3 5" />;
            })}
            <Line x1={0} x2={w} y1={BASE} y2={BASE} stroke="rgba(17,17,20,0.18)" strokeWidth={1} />
            {area ? <Path d={area} fill="url(#keep)" /> : null}
            {line ? <Path d={line} stroke={theme.blue} strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
            {pts.map(([px, py], i) =>
              reached(i) > 0 ? (
                i === 3 ? (
                  <Circle key={i} cx={px} cy={py} r={9 * easeOut(reached(i))} fill={theme.blue} stroke="#fff" strokeWidth={3} />
                ) : (
                  <Circle key={i} cx={px} cy={py} r={6 * easeOut(reached(i))} fill="#fff" stroke={theme.blue} strokeWidth={2.5} />
                )
              ) : null
            )}
          </Svg>
        )}
        {w > 0 &&
          pts.map(([px, py], i) =>
            reached(i) > 0 ? (
              <Text key={i} style={[styles.amount, i === 3 && styles.amountBig, { left: px - 55 - (i === 2 ? 16 : 0) /* the month's, clear of the rising line */, top: py - (i === 3 ? 36 : 28), opacity: clamp01(reached(i) * 2) }]}>
                {show(values[i] * easeOut(reached(i)), i)}
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
    </>
  );
}

const RING = 210;
const RING_STROKE = 16;

/**
 * "Editing takes 50% of your day.": a clock face with the share of their day spent editing filling
 * round it, and the time Autocut gives back in the middle. Then what that is over a year, and the
 * lowest price it costs.
 */
function Life({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const n = numbersFor(draft);
  const p = easeOut(useProgress(1400, 300));
  const share = Math.min(1, n.spent / 24);
  const pct = Math.round(share * 100);
  const days = Math.round((n.saved * 365) / 24);
  const lowest = pricePerMonth(PLANS[0].monthly, 'yearly');
  const r = (RING - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  useEffect(() => {
    const t = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 1750);
    return () => clearTimeout(t);
  }, []);
  return (
    <OnbScreen header={header} footer={<Button title="See my plan  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)} style={{ paddingTop: 4 }}>
        <Text style={styles.lifeTitle}>
          Editing takes <Text style={{ color: HIGHLIGHT }}>{pct >= 1 ? `${Math.round(pct * p)}%` : hm(n.spent)}</Text> of your day.
        </Text>
        <View style={styles.ring}>
          <Svg width={RING} height={RING}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke="rgba(61,107,255,0.12)" strokeWidth={RING_STROKE} fill="#fff" />
            <Circle
              cx={RING / 2} cy={RING / 2} r={r} stroke={theme.blue} strokeWidth={RING_STROKE} fill="none" strokeLinecap="round"
              strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.max(0.02, share) * p)} transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
            {[0, 90, 180, 270].map((a) => {
              const rad = (a * Math.PI) / 180;
              const x = (k: number) => RING / 2 + Math.sin(rad) * k;
              const y = (k: number) => RING / 2 - Math.cos(rad) * k;
              return <Line key={a} x1={x(r - 22)} y1={y(r - 22)} x2={x(r - 14)} y2={y(r - 14)} stroke="rgba(17,17,20,0.35)" strokeWidth={2} strokeLinecap="round" />;
            })}
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={styles.ringBig}>{hm(n.saved)}</Text>
            <Text style={styles.ringSmall}>back every day</Text>
          </View>
        </View>
        <Text style={styles.lifeLine}>
          Get <Text style={{ color: HIGHLIGHT }}>{days >= 1 ? `${days} full day${days === 1 ? '' : 's'}` : `${Math.round(n.saved * 365)} hours`}</Text> of your year back for as low as {money(lowest)} a month.
        </Text>
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
  signIn: { fontSize: 16, fontWeight: '600', color: theme.blue },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8 },
  value: { fontSize: 64, fontWeight: '800', color: theme.ink, letterSpacing: -2, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 18, fontWeight: '700', color: theme.ink },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statLabel: { fontSize: 14, fontWeight: '700', color: theme.ink },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  statBig: { fontSize: 42, fontWeight: '800', color: theme.ink, letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  statUnit: { fontSize: 14, fontWeight: '600', color: theme.muted, flexShrink: 1 },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  how: { fontSize: 14, fontWeight: '700', color: theme.blue },
  howText: { fontSize: 13, lineHeight: 19, color: theme.muted, marginTop: 8 },
  amount: { position: 'absolute', width: 110, textAlign: 'center', fontSize: 14, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  amountBig: { fontSize: 17 },
  axis: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 13, color: theme.muted },
  caption: { fontSize: 14, color: theme.muted, textAlign: 'center', marginTop: 8 },
  lifeTitle: { fontSize: 32, fontWeight: '800', color: theme.ink, letterSpacing: -1, lineHeight: 38, textAlign: 'center', fontVariant: ['tabular-nums'] },
  ring: { width: RING, height: RING, alignSelf: 'center', marginTop: 30 },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringBig: { fontSize: 26, fontWeight: '800', color: theme.blue, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  ringSmall: { fontSize: 12, fontWeight: '600', color: theme.muted, marginTop: 2 },
  lifeLine: { fontSize: 18, fontWeight: '700', color: theme.ink, textAlign: 'center', lineHeight: 25, marginTop: 30, paddingHorizontal: 6 },
  card: { ...onbCard, gap: 12, marginTop: 24 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F1F1F4', alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, fontSize: 15, color: theme.ink, lineHeight: 20 },
  have: { fontSize: 14, color: theme.muted },
  legal: { fontSize: 12, color: theme.muted, textAlign: 'center', lineHeight: 17, marginTop: 2 },
  legalLink: { color: theme.ink, fontWeight: '600', textDecorationLine: 'underline' },
});
