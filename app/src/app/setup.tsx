import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
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
import { UI_FONT } from '../lib/fonts';

type Answer = { value: string; label: string; icon: SymbolName };

const WHO: Answer[] = [
  { value: 'shop', label: 'TikTok Shop seller', icon: 'bag' },
  { value: 'ugc', label: 'UGC creator', icon: 'video' },
  { value: 'influencer', label: 'Influencer', icon: 'star' },
  { value: 'me', label: 'Just for me', icon: 'person' },
];

const GOAL: Answer[] = [
  { value: 'more', label: 'Help me post more', icon: 'chart.line.uptrend.xyaxis' },
  { value: 'time', label: 'Give me my time back', icon: 'clock' },
  { value: 'freedom', label: 'Free up my days', icon: 'sun.max' },
  { value: 'editor', label: 'Replace my editor', icon: 'person.badge.minus' },
];

// Like CutAI: two questions, two sliders, then what that adds up to, then the plan and an account.
type StepId = 'who' | 'goal' | 'volume' | 'time' | 'spend' | 'adds' | 'life' | 'plan' | 'save';
const STEPS: StepId[] = ['who', 'goal', 'volume', 'time', 'spend', 'adds', 'life', 'plan', 'save'];

// Where the sliders start: 1 a day, and half an hour a video.
const VOLUME_START = VOLUME_STOPS.findIndex((v) => v.unit === 'a day' && v.n === 1);
const EDIT_START = EDIT_STOPS.indexOf(30);

/** What they'd pay for Autocut: the plan that suits them, at its yearly price (the one they start on). */
function autocutFor(draft: Draft) {
  const plan = planFor(draft.plan ?? recommendedPlan(draft.editorCost, draft.perWeek, draft.perDay));
  return { plan, monthly: pricePerMonth(plan, 'yearly'), list: plan.monthly };
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
/** "20 minutes", "1 hour". */
function editLabel(minutes: number) {
  if (minutes < 60) return { n: String(minutes), unit: 'minutes a video' };
  const h = minutes / 60;
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
        <OnbTitle sub={step === 'who' ? 'So Autocut cuts the way your videos need.' : 'Pick the one that matters most.'}>
          {step === 'who' ? <>What kind of <Text style={{ color: HIGHLIGHT }}>creator</Text> are you?</> : <>What should Autocut do <Text style={{ color: HIGHLIGHT }}>for you</Text>?</>}
        </OnbTitle>
        <View style={{ gap: 12 }}>
          {(step === 'who' ? WHO : GOAL).map((o, i) => (
            <Choice key={o.value} index={i} label={o.label} icon={o.icon} selected={draft[key] === o.value} onPress={() => pick({ [key]: o.value })} />
          ))}
        </View>
      </Animated.View>
    </OnbScreen>
  );
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MAX_STACK = 10;

/** How many videos land on each day of the week (the same every day, up to a column's worth). */
const weekOf = (stop: (typeof VOLUME_STOPS)[number]) => DAYS.map(() => Math.min(MAX_STACK, stop.n));

/**
 * "How many videos do you post a day?" shown as their week: a column for each day, with a little
 * video tile for each post that lands on top (or leaves) as the slider moves. Ten or more shows a "+".
 */
function WeekStack({ stop }: { stop: (typeof VOLUME_STOPS)[number] }) {
  const week = weekOf(stop);
  const total = stop.n * 7;
  return (
    <View>
      <View style={styles.valueRow}>
        <Animated.Text key={`${stop.n}${stop.unit}`} entering={FadeInDown.duration(220)} style={styles.value}>
          {stop.n}
          {stop.unit === 'or more a day' ? '+' : ''}
        </Animated.Text>
        <Text style={styles.unit}>{stop.n === 1 ? 'video a day' : 'videos a day'}</Text>
      </View>
      <View style={styles.week}>
        {week.map((count, d) => (
          <View key={d} style={styles.dayCol}>
            {/* Built from the bottom up: a new video lands on top of the column. */}
            <View style={styles.dayStack}>
              {Array.from({ length: count }, (_, k) => (
                <Animated.View
                  key={k}
                  entering={FadeInDown.duration(200).delay(d * 20)}
                  exiting={FadeOut.duration(120)}
                  style={[styles.tile, { opacity: 0.6 + 0.4 * ((k + 1) / MAX_STACK) }]}
                >
                  <View style={styles.tilePlay} />
                </Animated.View>
              ))}
              {stop.unit === 'or more a day' && <Animated.Text entering={FadeIn.duration(180)} style={styles.more}>+</Animated.Text>}
            </View>
            <Text style={[styles.dayLabel, count > 0 && { color: theme.ink }]}>{DAYS[d]}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.weekTotal}>
        That’s <Text style={{ color: HIGHLIGHT }}>{total}{stop.unit === 'or more a day' ? '+' : ''}</Text> video{total === 1 ? '' : 's'} a week.
      </Text>
    </View>
  );
}

const WATCH = 150;
const WATCH_STROKE = 12;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * "How long does one video take to edit?" as a stopwatch: one turn is an hour, like a clock face. The hand sweeps and
 * the face fills to the answer; under it, their time against Autocut's, side by side.
 */
function Stopwatch({ minutes, label }: { minutes: number; label: { n: string; unit: string } }) {
  const r = (WATCH - WATCH_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const share = useSharedValue(Math.min(1, minutes / 60));
  useEffect(() => {
    share.set(withTiming(Math.min(1, minutes / 60), { duration: 320, easing: Easing.out(Easing.cubic) }));
  }, [minutes, share]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - share.value) }));
  const hand = useAnimatedStyle(() => ({ transform: [{ rotate: `${share.value * 360}deg` }] }));
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: WATCH, height: WATCH }}>
        <Svg width={WATCH} height={WATCH}>
          <Circle cx={WATCH / 2} cy={WATCH / 2} r={r} stroke="#EEF0F6" strokeWidth={WATCH_STROKE} fill="#fff" />
          {/* A mark every 5 minutes, longer at the quarter hours. */}
          {Array.from({ length: 12 }, (_, k) => {
            const a = (k / 12) * 2 * Math.PI;
            const long = k % 3 === 0;
            const r1 = r - WATCH_STROKE / 2 - 4, r2 = r1 - (long ? 9 : 4);
            return (
              <Line key={k} x1={WATCH / 2 + Math.sin(a) * r1} y1={WATCH / 2 - Math.cos(a) * r1} x2={WATCH / 2 + Math.sin(a) * r2} y2={WATCH / 2 - Math.cos(a) * r2}
                stroke={long ? 'rgba(17,17,20,0.45)' : 'rgba(17,17,20,0.18)'} strokeWidth={long ? 2 : 1.5} strokeLinecap="round" />
            );
          })}
          <AnimatedCircle
            cx={WATCH / 2} cy={WATCH / 2} r={r} stroke={theme.ink} strokeWidth={WATCH_STROKE} fill="none" strokeLinecap="round"
            strokeDasharray={`${c} ${c}`} animatedProps={arc} transform={`rotate(-90 ${WATCH / 2} ${WATCH / 2})`}
          />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, hand]} pointerEvents="none">
          {/* A pointer near the rim, so the number in the middle stays clear. */}
          <View style={[styles.hand, { height: 16, top: WATCH / 2 - (r - 11) }]} />
        </Animated.View>
        <View style={styles.watchCenter} pointerEvents="none">
          <Animated.Text key={label.n} entering={FadeInDown.duration(200)} style={styles.watchValue}>{label.n}</Animated.Text>
          <Text style={styles.watchUnit}>{label.unit.replace(' a video', '')}</Text>
        </View>
      </View>
      {/* Autocut's time, side by side with theirs, so the difference is the first thing you see. */}
      <View style={styles.versus}>
        <View style={styles.versusSide}>
          <Text style={styles.versusLabel}>Editing now</Text>
          <Text style={styles.versusValue}>{label.n} <Text style={styles.versusUnit}>{label.unit.replace(' a video', '')}</Text></Text>
        </View>
        <View style={styles.versusArrow}>
          <SymbolView name="arrow.right" tintColor={theme.faint} size={14} weight="semibold" />
        </View>
        <View style={[styles.versusSide, styles.versusOurs]}>
          <Text style={[styles.versusLabel, { color: theme.blue }]}>With Autocut</Text>
          <Text style={[styles.versusValue, { color: theme.blue }]}>{AUTOCUT_MINUTES} <Text style={[styles.versusUnit, { color: theme.blue }]}>min</Text></Text>
        </View>
      </View>
      {minutes > AUTOCUT_MINUTES && (
        <Text style={styles.faster}>
          That’s <Text style={{ color: HIGHLIGHT }}>{Math.round(minutes / AUTOCUT_MINUTES)}× faster</Text> for every video.
        </Text>
      )}
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
        <OnbTitle sub="A typical day is fine.">How many videos do you <Text style={{ color: HIGHLIGHT }}>post</Text> a day?</OnbTitle>
        <View style={[onbCard, { paddingTop: 20, paddingBottom: 16, gap: 16 }]}>
          <WeekStack stop={stop} />
          <StepSlider stops={VOLUME_STOPS.length} index={i} onChange={setI} left="1 a day" right="10+ a day" />
        </View>
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
        <OnbTitle sub="From raw take to ready to post.">How long does one video take to <Text style={{ color: HIGHLIGHT }}>edit</Text>?</OnbTitle>
        <View style={[onbCard, { paddingTop: 22, paddingBottom: 16, gap: 16 }]}>
          <Stopwatch minutes={minutes} label={label} />
          <StepSlider stops={EDIT_STOPS.length} index={i} onChange={setI} left="5 min" right="1 h" />
        </View>
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
    <OnbScreen header={header} footer={<Button title="Next  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle>
          That’s <Text style={{ color: HIGHLIGHT }}>{hm(daily ? n.spent : n.spent * 7)} a {daily ? 'day' : 'week'}</Text> in the edit.
        </OnbTitle>
        <View style={{ gap: 12 }}>
          <View style={onbCard}>
            <View style={styles.statHead}>
              <SymbolView name="clock" tintColor={theme.blue} size={15} />
              <Text style={styles.statLabel}>Time Autocut frees up</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statBig}>{monthHours >= 1 ? Math.round(monthHours * p).toLocaleString('en-US') : Math.round(monthHours * 60 * p)}</Text>
              <Text style={styles.statUnit}>{monthHours >= 1 ? 'hours' : 'minutes'} every month</Text>
            </View>
          </View>
          <View style={onbCard}>
            <View style={styles.statHead}>
              <SymbolView name="dollarsign.circle" tintColor={theme.blue} size={15} />
              <Text style={styles.statLabel}>Money you keep</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statBig}>{money(Math.round(n.savedMoney * p))}</Text>
              <Text style={styles.statUnit}>a month, compared with paying an editor</Text>
            </View>
          </View>
        </View>
        <Pressable onPress={() => setHow((h) => !h)} hitSlop={8} style={styles.howRow} accessibilityRole="button" accessibilityState={{ expanded: how }}>
          <Text style={styles.how}>Where these numbers come from</Text>
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
    <OnbScreen header={header} footer={<Button title="Next  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle>Watch it <Text style={{ color: HIGHLIGHT }}>stack up</Text>.</OnbTitle>
        <View style={{ alignSelf: 'center', width: 200, marginTop: -6, marginBottom: 6 }}>
          <Segmented value={mode} onChange={(m) => { Haptics.selectionAsync(); setMode(m); }} options={[{ value: 'time', label: 'Time' }, { value: 'money', label: 'Money' }]} />
        </View>
        <Curve key={mode} values={values} show={show} />
        <Text style={styles.caption}>{mode === 'time' ? 'Time freed up with Autocut, over a year.' : 'Money kept compared with an editor, over a year.'}</Text>
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

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/**
 * The year as 12 month bars: the hours spent editing, counted as full days (24 hours each), fill
 * the months from January on, with a tag riding the edge of the filled part.
 */
function YearBar({ days }: { days: number }) {
  const p = useProgress(1700, 350);
  const shown = Math.min(365, days) * easeOut(p);
  const [w, setW] = useState(0);
  const [tagW, setTagW] = useState(0);
  // A tick as each month fills, and a thump when it lands.
  // How full each month is: the days before it come first.
  const fills = MONTH_DAYS.map((d, k) => clamp01((shown - MONTH_DAYS.slice(0, k).reduce((a, b) => a + b, 0)) / d));
  const full = fills.filter((f) => f >= 1).length;
  useEffect(() => {
    if (full > 0) Haptics.selectionAsync();
  }, [full]);
  useEffect(() => {
    if (p >= 1) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [p]);
  const GAP = 6;
  const bar = w ? (w - GAP * 11) / 12 : 0;
  const current = Math.min(11, fills.findIndex((f) => f < 1) === -1 ? 11 : fills.findIndex((f) => f < 1));
  const edge = current * (bar + GAP) + bar / 2;
  const tagLeft = Math.max(0, Math.min(w - tagW, edge - tagW / 2));
  const pointer = Math.max(10, Math.min(tagW - 10, edge - tagLeft));
  const n = Math.max(1, Math.round(shown));
  return (
    <View style={styles.barCard}>
      <View style={{ height: 34 }}>
        {w > 0 && (
          <View onLayout={(e) => setTagW(e.nativeEvent.layout.width)} style={[styles.barTag, { left: tagLeft, opacity: tagW ? clamp01(p * 3) : 0 }]}>
            <Text style={styles.barTagText}>
              {n} day{n === 1 ? '' : 's'}
            </Text>
            <View style={[styles.barTagPointer, { left: pointer - 5 }]} />
          </View>
        )}
      </View>
      <View style={[styles.months, { gap: GAP }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 &&
          fills.map((f, k) => (
            <View key={k} style={[styles.monthBar, { width: bar }]}>
              {f > 0 && <View style={[styles.monthFill, { height: `${f * 100}%` }]} />}
            </View>
          ))}
      </View>
      <View style={[styles.monthLetters, { gap: GAP }]}>
        {MONTH_LETTERS.map((l, k) => (
          <Text key={k} style={[styles.barHour, { width: bar, textAlign: 'center' }]}>
            {l}
          </Text>
        ))}
      </View>
      <View style={styles.blockLegend}>
        <View style={[styles.legendDot, { backgroundColor: theme.blue }]} />
        <Text style={styles.legendText}>Your editing time, as full 24-hour days</Text>
      </View>
    </View>
  );
}

/**
 * "N days a year go to editing.": the year's months filling with the editing time (as whole days),
 * then what Autocut gives back and the lowest price it costs.
 */
function Life({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const n = numbersFor(draft);
  const p = easeOut(useProgress(1700, 350));
  const hours = n.spent * 365;
  const days = Math.min(365, hours / 24);
  const back = Math.round((n.saved * 365) / 24);
  const lowest = pricePerMonth(PLANS[0], 'yearly');
  const count = Math.max(1, Math.round(days * p));
  return (
    <OnbScreen header={header} footer={<Button title="See my plan  →" onPress={onNext} />}>
      <Animated.View entering={FadeIn.duration(260)} style={{ paddingTop: 4 }}>
        <Text style={styles.lifeTitle}>
          <Text style={{ color: HIGHLIGHT }}>{count} day{count === 1 ? '' : 's'}</Text> a year go to editing.
        </Text>
        <Text style={styles.lifeSub}>That’s {Math.round(hours).toLocaleString('en-US')} hours, around the clock.</Text>
        <YearBar days={days} />
        <Text style={styles.lifeLine}>
          Autocut hands you <Text style={{ color: HIGHLIGHT }}>{back >= 1 ? `${back} day${back === 1 ? '' : 's'}` : `${Math.round(n.saved * 365)} hours`}</Text> of it back, from {money(lowest)} a month.
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
        <OnbTitle sub="Create your account to keep it.">Your plan is <Text style={{ color: HIGHLIGHT }}>ready</Text></OnbTitle>
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
            Already have an account? <Text style={{ color: theme.ink, ...UI_FONT.bold }}>Sign in</Text>
          </Text>
        </Pressable>
      </Animated.View>
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  signIn: { fontSize: 16, ...UI_FONT.semibold, color: theme.blue },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8 },
  value: { fontSize: 64, ...UI_FONT.extrabold, color: theme.ink, letterSpacing: -2, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 18, ...UI_FONT.bold, color: theme.ink },
  week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 4 },
  dayCol: { alignItems: 'center', gap: 6, width: 32 },
  dayStack: { height: 150, flexDirection: 'column-reverse', justifyContent: 'flex-start', alignItems: 'center', gap: 3 },
  tile: { width: 26, height: 11.5, borderRadius: 4, backgroundColor: theme.blue, alignItems: 'center', justifyContent: 'center' },
  tilePlay: { width: 0, height: 0, borderTopWidth: 3, borderBottomWidth: 3, borderLeftWidth: 5, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: 'rgba(255,255,255,0.9)' },
  more: { fontSize: 14, ...UI_FONT.bold, color: theme.blue },
  dayLabel: { fontSize: 12, ...UI_FONT.bold, color: theme.faint },
  weekTotal: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted, textAlign: 'center', marginTop: 12 },
  hand: { position: 'absolute', left: WATCH / 2 - 2, width: 4, borderRadius: 2, backgroundColor: theme.ink },
  watchCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  watchValue: { fontSize: 38, ...UI_FONT.extrabold, color: theme.ink, letterSpacing: -1.2, fontVariant: ['tabular-nums'] },
  watchUnit: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, marginTop: -2 },
  versus: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 16, alignSelf: 'stretch' },
  versusSide: { flex: 1, borderRadius: 14, backgroundColor: '#F4F5F9', paddingVertical: 10, alignItems: 'center', gap: 2 },
  versusOurs: { backgroundColor: theme.blueTile, borderWidth: 1, borderColor: theme.blueLine },
  versusArrow: { justifyContent: 'center' },
  versusLabel: { fontSize: 12, ...UI_FONT.semibold, color: theme.muted },
  versusValue: { fontSize: 24, ...UI_FONT.extrabold, color: theme.ink, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  versusUnit: { fontSize: 14, ...UI_FONT.bold, color: theme.ink },
  faster: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted, textAlign: 'center', marginTop: 10 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, ...UI_FONT.semibold, color: theme.muted },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statLabel: { fontSize: 14, ...UI_FONT.bold, color: theme.ink },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  statBig: { fontSize: 42, ...UI_FONT.extrabold, color: theme.ink, letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  statUnit: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted, flexShrink: 1 },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  how: { fontSize: 14, ...UI_FONT.bold, color: theme.blue },
  howText: { fontSize: 13, ...UI_FONT.medium, lineHeight: 19, color: theme.muted, marginTop: 8 },
  amount: { position: 'absolute', width: 110, textAlign: 'center', fontSize: 14, ...UI_FONT.extrabold, color: theme.ink, fontVariant: ['tabular-nums'] },
  amountBig: { fontSize: 17 },
  axis: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 13, ...UI_FONT.medium, color: theme.muted },
  caption: { fontSize: 14, ...UI_FONT.medium, color: theme.muted, textAlign: 'center', marginTop: 8 },
  barCard: { ...onbCard, marginTop: 26, gap: 8, paddingTop: 16 },
  barHour: { fontSize: 11, ...UI_FONT.semibold, color: theme.faint, fontVariant: ['tabular-nums'] },
  barTag: { position: 'absolute', top: 0, height: 26, borderRadius: 8, paddingHorizontal: 10, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  barTagText: { fontSize: 12, ...UI_FONT.bold, color: '#fff', fontVariant: ['tabular-nums'] },
  barTagPointer: { position: 'absolute', bottom: -4, width: 10, height: 10, backgroundColor: theme.ink, transform: [{ rotate: '45deg' }], borderRadius: 2 },
  blockLegend: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  lifeTitle: { fontSize: 32, ...UI_FONT.bold, color: theme.ink, letterSpacing: -0.9, lineHeight: 39, textAlign: 'center', fontVariant: ['tabular-nums'] },
  lifeSub: { fontSize: 15, ...UI_FONT.semibold, color: theme.muted, textAlign: 'center', marginTop: 8 },
  months: { height: 96, flexDirection: 'row', alignItems: 'flex-end' },
  monthBar: { height: '100%', borderRadius: 8, backgroundColor: '#EEF0F6', overflow: 'hidden', justifyContent: 'flex-end' },
  monthFill: { width: '100%', borderRadius: 8, backgroundColor: theme.blue },
  monthLetters: { flexDirection: 'row' },
  lifeLine: { fontSize: 18, ...UI_FONT.bold, color: theme.ink, textAlign: 'center', lineHeight: 25, marginTop: 30, paddingHorizontal: 6 },
  card: { ...onbCard, gap: 12, marginTop: 24 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F1F1F4', alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, fontSize: 15, ...UI_FONT.medium, color: theme.ink, lineHeight: 20 },
  have: { fontSize: 14, ...UI_FONT.medium, color: theme.muted },
  legal: { fontSize: 12, ...UI_FONT.medium, color: theme.muted, textAlign: 'center', lineHeight: 17, marginTop: 2 },
  legalLink: { color: theme.ink, ...UI_FONT.semibold, textDecorationLine: 'underline' },
});
