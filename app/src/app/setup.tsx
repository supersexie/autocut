import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppleLogo, Backdrop, Button, ErrorText, GoogleLogo, Option, StepHeader, Title, type SymbolName } from '../components/ui';
import { openLegal } from '../lib/api';
import { socialOptions, useAuth } from '../lib/auth';
import { updateDraft, useDraft, type Draft } from '../lib/draft';
import {
  AUTOCUT_MINUTES, BY_HAND_MINUTES, EDITOR_COSTS, editorMonthly, hoursBack, money, PER_WEEK, planFor, recommendedPlan, videosPerWeek,
} from '../lib/plans';
import { theme } from '../lib/theme';

type Choice = { value: string; label: string; icon: SymbolName };

const MAKING: Choice[] = [
  { value: 'shop', label: 'Product videos for TikTok Shop', icon: 'bag' },
  { value: 'ugc', label: 'UGC for brands', icon: 'video' },
  { value: 'influencer', label: 'My own channel', icon: 'person.wave.2' },
  { value: 'me', label: 'Just trying it out', icon: 'sparkles' },
];

const HELP: Choice[] = [
  { value: 'more', label: 'Posting every day', icon: 'chart.line.uptrend.xyaxis' },
  { value: 'time', label: 'Getting my evenings back', icon: 'moon.stars' },
  { value: 'freedom', label: 'Editing from my phone', icon: 'iphone' },
  { value: 'editor', label: 'Not paying for edits', icon: 'dollarsign.circle' },
];

type StepId = 'making' | 'help' | 'volume' | 'cost' | 'time' | 'money' | 'save';
const STEPS: StepId[] = ['making', 'help', 'volume', 'cost', 'time', 'money', 'save'];

/** "45 minutes", "1 hour", "2.5 hours". */
const duration = (hours: number) =>
  hours < 1 ? `${Math.max(5, Math.round((hours * 60) / 5) * 5)} minutes` : `${Math.round(hours * 2) / 2} hour${hours >= 1.25 ? 's' : ''}`;

export default function Setup() {
  const draft = useDraft();
  const [step, setStep] = useState<StepId>('making');
  // Without an editing bill there's nothing to compare, so the money screen is skipped.
  const steps = draft.editorCost && editorMonthly(draft.editorCost) === 0 ? STEPS.filter((s) => s !== 'money') : STEPS;
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

  if (step === 'making') {
    return (
      <Backdrop footer={<Button title="Continue" onPress={next} disabled={!draft.who} />}>
        {header}
        <Title sub="We’ll tune your cuts for it.">What are you making?</Title>
        <View style={{ gap: 10 }}>
          {MAKING.map((o) => (
            <Option key={o.value} label={o.label} icon={o.icon} selected={draft.who === o.value} onPress={() => updateDraft({ who: o.value })} />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (step === 'help') {
    return (
      <Backdrop footer={<Button title="Continue" onPress={next} disabled={!draft.goal} />}>
        {header}
        <Title>What would help you most?</Title>
        <View style={{ gap: 10 }}>
          {HELP.map((o) => (
            <Option key={o.value} label={o.label} icon={o.icon} selected={draft.goal === o.value} onPress={() => updateDraft({ goal: o.value })} />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (step === 'volume') {
    return (
      <Backdrop footer={<Button title="Continue" onPress={next} disabled={!draft.perWeek} />}>
        {header}
        <Title sub="Roughly is fine.">How many videos do you post a week?</Title>
        <View style={{ gap: 10 }}>
          {PER_WEEK.map((p) => (
            <Option
              key={p.value}
              label={p.label}
              detail={`About ${Math.round(p.count * 4.3)} a month`}
              selected={draft.perWeek === p.value}
              onPress={() => updateDraft({ perWeek: p.value })}
            />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (step === 'cost') {
    return (
      <Backdrop footer={<Button title="Continue" onPress={next} disabled={!draft.editorCost} />}>
        {header}
        <Title sub="Per month, for editing.">What do you spend on edits now?</Title>
        <View style={{ gap: 10 }}>
          {EDITOR_COSTS.map((c) => (
            <Option key={c.value} label={c.label} selected={draft.editorCost === c.value} onPress={() => updateDraft({ editorCost: c.value })} />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (step === 'time') return <TimeBack header={header} draft={draft} onNext={next} />;
  if (step === 'money') return <MoneyKept header={header} draft={draft} onNext={next} />;
  return <Save header={header} draft={draft} />;
}

/** Eases 0 → 1 over `ms` (after `delay`), for the bars and counters. */
function useProgress(ms: number, delay = 250) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const start = Date.now() + delay;
    let frame = 0;
    const tick = () => {
      const t = Math.max(0, Math.min(1, (Date.now() - start) / ms));
      setP(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ms, delay]);
  return p;
}

/** A labelled bar that grows to `fraction` of the track as `p` goes 0 → 1. */
function Bar({ label, value, fraction, p, strong }: { label: string; value: string; fraction: number; p: number; strong?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.between}>
        <Text style={[styles.barLabel, strong && { color: theme.ink, fontWeight: '700' }]}>{label}</Text>
        <Text style={[styles.barValue, strong && { color: theme.ink }]}>{value}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(2, fraction * p * 100)}%`, backgroundColor: strong ? theme.ink : '#C9C9CF' }]} />
      </View>
    </View>
  );
}

function TimeBack({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const p = useProgress(1300);
  const videos = videosPerWeek(draft.perWeek) || 2;
  const byHand = (videos * BY_HAND_MINUTES) / 60;
  const withAutocut = (videos * AUTOCUT_MINUTES) / 60;
  const saved = hoursBack(draft.perWeek) || byHand - withAutocut;
  return (
    <Backdrop footer={<Button title="Continue" onPress={onNext} disabled={p < 1} />}>
      {header}
      <Text style={styles.kicker}>Every week, you get back</Text>
      <Text style={styles.huge}>{duration(saved * p)}</Text>
      <Text style={styles.lede}>That’s the cutting you do now: pauses, ums, retakes. Autocut does it while you film the next one.</Text>
      <View style={styles.card}>
        <Bar label="Cutting by hand" value={duration(byHand)} fraction={1} p={p} />
        <Bar label="With Autocut" value={duration(withAutocut)} fraction={withAutocut / byHand} p={p} strong />
        <Text style={styles.note}>
          For about {Math.round(videos)} videos a week, at {BY_HAND_MINUTES} minutes each by hand.
        </Text>
      </View>
    </Backdrop>
  );
}

function MoneyKept({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const p = useProgress(1300);
  const plan = planFor(recommendedPlan(draft.editorCost, draft.perWeek));
  const editorYear = editorMonthly(draft.editorCost) * 12;
  const autocutYear = plan.monthly * 12;
  const kept = Math.max(0, editorYear - autocutYear);
  return (
    <Backdrop footer={<Button title="See my plan" onPress={onNext} disabled={p < 1} />}>
      {header}
      <Text style={styles.kicker}>Over a year, you keep</Text>
      <Text style={styles.huge}>{money(Math.round(kept * p))}</Text>
      <Text style={styles.lede}>From what you spend on edits now, next to Autocut {plan.name}.</Text>
      <View style={styles.receipt}>
        <View style={styles.between}>
          <Text style={styles.receiptLabel}>Editing now</Text>
          <Text style={styles.receiptValue}>{money(editorYear)} / yr</Text>
        </View>
        <View style={styles.between}>
          <Text style={styles.receiptLabel}>Autocut {plan.name}</Text>
          <Text style={styles.receiptValue}>{money(Math.round(autocutYear))} / yr</Text>
        </View>
        <View style={styles.perforation} />
        <View style={styles.between}>
          <Text style={[styles.receiptLabel, { color: theme.ink, fontWeight: '700' }]}>You keep</Text>
          <Text style={[styles.receiptValue, { color: theme.ink, fontWeight: '800' }]}>{money(Math.round(kept))}</Text>
        </View>
      </View>
    </Backdrop>
  );
}

/** Last step: what we set up from their answers, then an account to keep it. */
function Save({ header, draft }: { header: React.ReactNode; draft: Draft }) {
  const auth = useAuth();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState({ apple: false, google: false });
  const plan = planFor(recommendedPlan(draft.editorCost, draft.perWeek));
  const making = MAKING.find((m) => m.value === draft.who);
  const saved = hoursBack(draft.perWeek);

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
    { icon: 'scissors', text: making && making.value !== 'me' ? `Cuts tuned for ${making.label.toLowerCase()}` : 'Dead air, ums and retakes cut for you' },
    ...(saved ? [{ icon: 'clock' as SymbolName, text: `About ${duration(saved)} back every week` }] : []),
    { icon: 'captions.bubble', text: 'Captions on every word' },
    { icon: 'checkmark.seal', text: `${plan.name}: ${plan.edits.toLowerCase()}` },
  ];

  return (
    <Backdrop
      footer={
        <>
          <ErrorText>{error}</ErrorText>
          {providers.apple && (
            <Button title="Continue with Apple" icon={<AppleLogo />} loading={busy === 'apple'} onPress={() => go('apple')} />
          )}
          {providers.google && (
            <Button kind="outline" title="Continue with Google" icon={<GoogleLogo />} loading={busy === 'google'} onPress={() => go('google')} />
          )}
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
      {header}
      <Title sub="Create your account to keep it.">Your plan is ready</Title>
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
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  signIn: { fontSize: 15, fontWeight: '600', color: theme.ink, paddingLeft: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  kicker: { fontSize: 17, color: theme.muted, marginTop: 8 },
  huge: { fontSize: 52, fontWeight: '800', color: theme.ink, letterSpacing: -1.5, marginTop: 2, fontVariant: ['tabular-nums'] },
  lede: { fontSize: 15, color: theme.muted, lineHeight: 21, marginTop: 8 },
  card: { backgroundColor: theme.card, borderRadius: 22, padding: 18, gap: 18, marginTop: 26 },
  track: { height: 12, borderRadius: 6, backgroundColor: '#fff', overflow: 'hidden' },
  fill: { height: 12, borderRadius: 6 },
  barLabel: { fontSize: 14, color: theme.muted },
  barValue: { fontSize: 14, color: theme.muted, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, color: theme.muted, lineHeight: 17 },
  receipt: { backgroundColor: theme.card, borderRadius: 22, padding: 20, gap: 14, marginTop: 26 },
  receiptLabel: { fontSize: 15, color: theme.muted },
  receiptValue: { fontSize: 15, color: theme.muted, fontVariant: ['tabular-nums'] },
  perforation: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: '#D1D1D6', marginVertical: 2 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, fontSize: 15, color: theme.ink, lineHeight: 20 },
  have: { fontSize: 14, color: theme.muted },
  legal: { fontSize: 12, color: theme.muted, textAlign: 'center', lineHeight: 17, marginTop: 2 },
  legalLink: { color: theme.ink, fontWeight: '600', textDecorationLine: 'underline' },
});
