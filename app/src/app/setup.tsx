import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Backdrop, Button, ErrorText, Option, StepHeader, Title, type SymbolName } from '../components/ui';
import { openLegal } from '../lib/api';
import { enabledProviders, useAuth } from '../lib/auth';
import { updateDraft, useDraft, type Draft } from '../lib/draft';
import { EDITOR_COSTS, editorMonthly, money, planFor, recommendedPlan } from '../lib/plans';
import { theme } from '../lib/theme';

type Choice = { value: string; label: string; icon: SymbolName };

const WHO: Choice[] = [
  { value: 'shop', label: 'TikTok Shop creator', icon: 'bag' },
  { value: 'ugc', label: 'UGC creator', icon: 'video' },
  { value: 'influencer', label: 'Influencer', icon: 'star' },
  { value: 'me', label: 'Just me', icon: 'person' },
];

const GOALS: Choice[] = [
  { value: 'more', label: 'Post more videos', icon: 'chart.line.uptrend.xyaxis' },
  { value: 'time', label: 'Save time', icon: 'clock' },
  { value: 'freedom', label: 'Have more freedom', icon: 'sun.max' },
  { value: 'editor', label: 'Fire my editor', icon: 'person.crop.circle.badge.xmark' },
];

type StepId = 'who' | 'goal' | 'cost' | 'adds' | 'months' | 'save';
const STEPS: StepId[] = ['who', 'goal', 'cost', 'adds', 'months', 'save'];

export default function Setup() {
  const draft = useDraft();
  const [step, setStep] = useState<StepId>('who');
  // Without an editor there's nothing to compare, so the money screens are skipped.
  const steps = editorMonthly(draft.editorCost) === 0 && draft.editorCost ? STEPS.filter((s) => s !== 'adds' && s !== 'months') : STEPS;
  const index = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(steps.length - 1, index + 1)]);
  const back = () => (index === 0 ? router.back() : setStep(steps[index - 1]));
  const header = (
    <StepHeader
      progress={(index + 1) / steps.length}
      onBack={back}
      right={
        <Text style={styles.signIn} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'sign-in' } })}>
          Sign in
        </Text>
      }
    />
  );

  // A single choice moves on by itself, like tapping through a quiz.
  const pickAndGo = (patch: Draft) => {
    updateDraft(patch);
    const skip = patch.editorCost !== undefined && editorMonthly(patch.editorCost) === 0;
    setTimeout(() => setStep(skip ? 'save' : STEPS[STEPS.indexOf(step) + 1]), 280);
  };

  if (step === 'who') {
    return (
      <Backdrop footer={<Button title="Next  →" onPress={next} disabled={!draft.who} />}>
        {header}
        <Title>Who are you?</Title>
        <View style={{ gap: 10 }}>
          {WHO.map((o) => (
            <Option key={o.value} label={o.label} icon={o.icon} selected={draft.who === o.value} onPress={() => updateDraft({ who: o.value })} />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (step === 'goal') {
    return (
      <Backdrop>
        {header}
        <Title>What’s your goal?</Title>
        <View style={{ gap: 10 }}>
          {GOALS.map((o) => (
            <Option key={o.value} label={o.label} icon={o.icon} selected={draft.goal === o.value} onPress={() => pickAndGo({ goal: o.value })} />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (step === 'cost') {
    return (
      <Backdrop>
        {header}
        <Title sub="Per month.">How much are you currently paying for your editor?</Title>
        <View style={{ gap: 10 }}>
          {EDITOR_COSTS.map((c) => (
            <Option
              key={c.value}
              label={c.label}
              icon={c.bars ? 'chart.bar' : 'person.fill.checkmark'}
              selected={draft.editorCost === c.value}
              onPress={() => pickAndGo({ editorCost: c.value })}
            />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (step === 'adds') return <AddsUp header={header} draft={draft} onNext={next} />;
  if (step === 'months') return <Months header={header} draft={draft} onNext={next} />;
  return <Save header={header} />;
}

/** Eases 0 → 1 over `ms`, for the chart and counter animations. */
function useProgress(ms: number) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      setP(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ms]);
  return p;
}

function AddsUp({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const { width } = useWindowDimensions();
  const plan = planFor(recommendedPlan(draft.editorCost));
  const saved = Math.max(0, editorMonthly(draft.editorCost) - plan.monthly); // per month
  const p = useProgress(1600);

  const W = width - 44 - 32;
  const H = 210;
  const pad = { top: 34, bottom: 30, side: 26 };
  const values = [saved / 30, (saved * 7) / 30, saved, saved * 12].map((v) => v * p);
  const max = saved * 12 || 1;
  const xs = [0, 1 / 3, 2 / 3, 1].map((f) => pad.side + f * (W - pad.side * 2));
  const ys = values.map((v) => H - pad.bottom - (v / max) * (H - pad.top - pad.bottom));
  let line = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i - 1] + xs[i]) / 2;
    line += ` C ${cx} ${ys[i - 1]}, ${cx} ${ys[i]}, ${xs[i]} ${ys[i]}`;
  }
  const area = `${line} L ${xs[3]} ${H - pad.bottom} L ${xs[0]} ${H - pad.bottom} Z`;
  const labels = ['Day', 'Week', 'Month', 'Year'];

  return (
    <Backdrop footer={<Button title="See my editor vs. Autocut  →" onPress={onNext} disabled={p < 1} />}>
      {header}
      <Title>It adds up.</Title>
      <View style={styles.chartCard}>
        <View style={{ width: W, height: H }}>
          <Svg width={W} height={H}>
            <Defs>
              <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={theme.ink} stopOpacity={0.14} />
                <Stop offset="1" stopColor={theme.ink} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={area} fill="url(#fill)" />
            <Path d={line} stroke={theme.ink} strokeWidth={3} fill="none" />
            {xs.map((x, i) => (
              <Circle key={i} cx={x} cy={ys[i]} r={5} fill="#fff" stroke={theme.ink} strokeWidth={2.5} />
            ))}
          </Svg>
          {xs.map((x, i) => (
            <Text key={`v${i}`} style={[styles.pointValue, { left: x - 45, top: ys[i] - 26 }]}>
              {money(Math.round(values[i]))}
            </Text>
          ))}
          {xs.map((x, i) => (
            <Text key={`l${i}`} style={[styles.axis, { left: x - 30, top: H - pad.bottom + 10 }]}>
              {labels[i]}
            </Text>
          ))}
        </View>
        <Text style={styles.chartNote}>What you keep by switching to Autocut {plan.name}.</Text>
      </View>
      <Text style={styles.small}>
        From your answer: about {money(editorMonthly(draft.editorCost))} a month on an editor, versus {money(plan.monthly)} a month for Autocut {plan.name}.
      </Text>
    </Backdrop>
  );
}

/** A dot that grows in as the counter ticks up. */
function PopDot() {
  const [scale] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(scale, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [scale]);
  return <Animated.View style={[styles.dot, { transform: [{ scale }] }]} />;
}

const MAX_DOTS = 35;

function Months({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const plan = planFor(recommendedPlan(draft.editorCost));
  const months = Math.max(1, Math.floor(editorMonthly(draft.editorCost) / plan.monthly));
  const [count, setCount] = useState(0);

  // One dot per tick, and the number goes up with it. Short totals tick slower so each pop reads.
  useEffect(() => {
    if (count >= months) return;
    const step = Math.max(60, Math.min(260, 1600 / months));
    const t = setTimeout(() => setCount((c) => c + 1), count === 0 ? 450 : step);
    return () => clearTimeout(t);
  }, [count, months]);

  const done = count >= months;
  return (
    <Backdrop footer={<Button title="See my plan  →" onPress={onNext} disabled={!done} />}>
      {header}
      <Text style={styles.monthsTitle}>
        One month of your editor pays for{'\n'}
        <Text style={styles.monthsCount}>{count}</Text> month{count === 1 ? '' : 's'} of Autocut.
      </Text>
      <View style={styles.equation}>
        <View style={styles.editorBubble}>
          <Text style={styles.bubbleBig}>1 month</Text>
          <Text style={styles.bubbleSmall}>Your editor</Text>
        </View>
        <Text style={styles.equals}>=</Text>
        <View style={styles.dots}>
          {Array.from({ length: Math.min(count, MAX_DOTS) }, (_, i) => (
            <PopDot key={i} />
          ))}
        </View>
      </View>
      <View style={styles.legend}>
        <View style={[styles.dot, { width: 10, height: 10, borderRadius: 5 }]} />
        <Text style={[styles.small, { marginTop: 0 }]}>
          1 month of Autocut {plan.name}
          {months > MAX_DOTS ? ` (first ${MAX_DOTS} shown)` : ''}
        </Text>
      </View>
    </Backdrop>
  );
}

function Save({ header }: { header: React.ReactNode }) {
  const auth = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState({ apple: false, google: false });

  useEffect(() => {
    enabledProviders().then(async ({ google, apple }) =>
      setProviders({ google, apple: apple && Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync()) })
    );
  }, []);

  async function go(kind: 'apple' | 'google' | 'email') {
    setTried(true);
    if (!agreed) return;
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

  const social = providers.apple || providers.google;
  return (
    <Backdrop>
      {header}
      <Title sub="Create your account to see your plan.">Save your progress</Title>
      <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
        {providers.apple && (
          <Button title="Sign in with Apple" icon={<SymbolView name="apple.logo" tintColor="#fff" size={18} />} loading={busy === 'apple'} onPress={() => go('apple')} />
        )}
        {providers.google && (
          <Button kind="outline" title="Sign in with Google" icon={<Text style={styles.g}>G</Text>} loading={busy === 'google'} onPress={() => go('google')} />
        )}
        <Button
          kind={social ? 'outline' : 'primary'}
          title="Continue with email"
          icon={<SymbolView name="envelope" tintColor={social ? theme.ink : '#fff'} size={17} />}
          onPress={() => go('email')}
        />
        <Pressable style={styles.agree} onPress={() => setAgreed(!agreed)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
          <View style={[styles.box, agreed && styles.boxOn]}>{agreed && <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />}</View>
          <Text style={styles.agreeText}>
            I agree to Autocut’s{' '}
            <Text style={styles.agreeLink} onPress={() => openLegal('terms')}>
              Terms and Conditions
            </Text>{' '}
            and{' '}
            <Text style={styles.agreeLink} onPress={() => openLegal('privacy')}>
              Privacy Policy
            </Text>
          </Text>
        </Pressable>
        {tried && !agreed && <Text style={styles.mustAgree}>Accept the Terms and Privacy Policy to continue.</Text>}
        <ErrorText>{error}</ErrorText>
      </View>
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  signIn: { fontSize: 15, fontWeight: '600', color: theme.ink, paddingLeft: 4 },
  chartCard: { backgroundColor: theme.card, borderRadius: 22, padding: 16, gap: 10, alignItems: 'center' },
  pointValue: { position: 'absolute', width: 90, textAlign: 'center', fontSize: 12, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  axis: { position: 'absolute', width: 60, textAlign: 'center', fontSize: 12, color: theme.muted },
  chartNote: { fontSize: 13, color: theme.muted, textAlign: 'center' },
  small: { fontSize: 13, color: theme.muted, lineHeight: 18, marginTop: 12 },
  monthsTitle: { fontSize: 30, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.6, lineHeight: 38, marginTop: 10 },
  monthsCount: { fontVariant: ['tabular-nums'] },
  equation: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 34 },
  editorBubble: { width: 78, height: 78, borderRadius: 39, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  bubbleBig: { fontSize: 13, fontWeight: '800', color: theme.ink },
  bubbleSmall: { fontSize: 10, color: theme.muted },
  equals: { fontSize: 26, fontWeight: '700', color: theme.ink },
  dots: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 7, minHeight: 34 },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.ink, borderWidth: 4, borderColor: '#3A3A3F' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 18 },
  g: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  agree: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  agreeText: { flex: 1, fontSize: 13, color: theme.muted, lineHeight: 18 },
  agreeLink: { color: theme.ink, fontWeight: '600', textDecorationLine: 'underline' },
  mustAgree: { fontSize: 13, color: '#E0811E' },
});
