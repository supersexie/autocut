import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppleLogo, Backdrop, Button, ErrorText, GoogleLogo, Option, StepHeader, Title, type SymbolName } from '../components/ui';
import { openLegal } from '../lib/api';
import { socialOptions, useAuth } from '../lib/auth';
import { updateDraft, useDraft, type Draft } from '../lib/draft';
import {
  AUTOCUT_MINUTES, BY_HAND_MINUTES, EDITOR_COSTS, editorMonthly, hoursBack, money, PER_WEEK, planFor, pricePerMonth, recommendedPlan, videosPerWeek,
} from '../lib/plans';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
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
      <Backdrop footer={<Button title="Next" onPress={next} disabled={!draft.goal} />}>
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
      <Backdrop footer={<Button title="Next" onPress={next} disabled={!draft.perWeek} />}>
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
      <Backdrop footer={<Button title="Next" onPress={next} disabled={!draft.editorCost} />}>
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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Two columns side by side, like Cal AI's "Without / With": the hours cutting by hand fill a tall
 * grey column, the time with Autocut a short black one. They rise one after the other.
 */
function Columns({ byHand, withAutocut, p }: { byHand: number; withAutocut: number; p: number }) {
  const H = 230; // column height
  const TOP = 64; // room for the label and value
  const MIN = 58; // a fill never gets too small to hold its icon
  const fillH = (fraction: number, q: number) => (MIN + (H - TOP - MIN) * fraction) * q;
  const hand = clamp01(p * 1.6);
  const auto = clamp01((p - 0.35) * 1.6);
  const column = (label: string, value: string, fraction: number, q: number, strong: boolean) => (
    <View style={[styles.column, { height: H }]}>
      <Text style={styles.columnLabel}>{label}</Text>
      <Text style={[styles.columnValue, { opacity: q }]}>{value}</Text>
      <View style={[styles.columnFill, { height: fillH(fraction, q), backgroundColor: strong ? theme.ink : '#E4E4E8' }]}>
        {q > 0.6 && <SymbolView name={strong ? 'bolt.fill' : 'clock'} tintColor={strong ? '#fff' : theme.ink} size={20} style={{ opacity: (q - 0.6) / 0.4 }} />}
      </View>
    </View>
  );
  return (
    <View style={styles.columns}>
      {column('Cutting by hand', duration(byHand), 1, hand, false)}
      {column('With Autocut', duration(withAutocut), withAutocut / byHand, auto, true)}
    </View>
  );
}

function TimeBack({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const p = useProgress(1500);
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
        <Columns byHand={byHand} withAutocut={withAutocut} p={p} />
        <Text style={[styles.note, { textAlign: 'center' }]}>
          For about {Math.round(videos)} videos a week, at {BY_HAND_MINUTES} minutes each by hand.
        </Text>
      </View>
    </Backdrop>
  );
}

/**
 * What a year of editing costs, month by month, like Cal AI's trend chart: the editor's bill
 * climbs, Autocut stays low, and the gap between them (what you keep) fills in as they draw.
 */
function SpendChart({ editorYear, autocutYear, kept, p }: { editorYear: number; autocutYear: number; kept: number; p: number }) {
  const [w, setW] = useState(0);
  const H = 170;
  const PAD = 10; // room for the end dots
  const x = (f: number) => PAD + f * (w - PAD * 2);
  const top = Math.max(1, editorYear, autocutYear);
  const y = (amount: number) => PAD + (1 - amount / top) * (H - PAD * 2);
  // Both start at nothing in month 1 and add up over the year; drawn as far as p.
  const steps = 24;
  const pts = (yearly: number) => Array.from({ length: Math.max(2, Math.ceil(steps * p) + 1) }, (_, i) => Math.min(p, i / steps)).map((f) => [x(f), y(yearly * f)] as const);
  const line = (yearly: number) => pts(yearly).map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join(' ');
  const editor = pts(editorYear);
  const autocut = pts(autocutYear);
  // The gap between the two lines: what you keep.
  const gap = `${editor.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join(' ')} ${[...autocut].reverse().map(([a, b]) => `L${a.toFixed(1)} ${b.toFixed(1)}`).join(' ')} Z`;
  const done = clamp01((p - 0.85) / 0.15);
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.chartTitle}>What a year of edits costs</Text>
      <View style={{ height: H }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="kept" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={theme.cut} stopOpacity="0.22" />
                <Stop offset="1" stopColor={theme.cut} stopOpacity="0.04" />
              </LinearGradient>
            </Defs>
            {[0.33, 0.66].map((f) => (
              <Line key={f} x1={PAD} x2={w - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="#D1D1D6" strokeWidth={1} strokeDasharray="3 4" />
            ))}
            <Line x1={PAD} x2={w - PAD} y1={H - PAD} y2={H - PAD} stroke={theme.ink} strokeWidth={1.5} />
            <Path d={gap} fill="url(#kept)" />
            <Path d={line(editorYear)} stroke={theme.cut} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={line(autocutYear)} stroke={theme.ink} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={x(0)} cy={y(0)} r={6} fill="#fff" stroke={theme.ink} strokeWidth={2.5} />
            {done > 0 && (
              <>
                <Circle cx={x(1)} cy={y(editorYear)} r={6 * done} fill="#fff" stroke={theme.cut} strokeWidth={2.5} />
                <Circle cx={x(1)} cy={y(autocutYear)} r={6 * done} fill="#fff" stroke={theme.ink} strokeWidth={2.5} />
              </>
            )}
          </Svg>
        )}
        {w > 0 && done > 0 && (
          <>
            {/* Above the red line (top left is clear of it), just above the black one, and the pill in the gap. */}
            <Text style={[styles.chartTag, { left: PAD + 2, top: PAD, opacity: done, color: theme.cut }]}>Editing now · {money(editorYear)}</Text>
            <Text style={[styles.chartTag, { right: PAD + 2, top: y(autocutYear) - 24, opacity: done }]}>Autocut · {money(Math.round(autocutYear))}</Text>
            {kept > 0 && (
              <View style={[styles.keptPill, { left: x(0.45) - 62, top: (y(editorYear * 0.45) + y(autocutYear * 0.45)) / 2 - 12, opacity: done }]}>
                <Text style={styles.keptText}>You keep {money(Math.round(kept))}</Text>
              </View>
            )}
          </>
        )}
      </View>
      <View style={styles.between}>
        <Text style={styles.axis}>Month 1</Text>
        <Text style={styles.axis}>Month 12</Text>
      </View>
    </View>
  );
}

const ODO_H = 76; // one digit's height in the odometer

/**
 * The amount spins into place like an odometer: every digit rolls, the right-hand ones fastest,
 * and they land one after another, left to right, with a tick for each.
 */
function Odometer({ text, p }: { text: string; p: number }) {
  const digits = [...text].filter((c) => /\d/.test(c)).length;
  let seen = 0;
  return (
    <View style={styles.odometer} accessibilityLabel={text}>
      {[...text].map((c, i) => {
        if (!/\d/.test(c)) return <Text key={i} style={styles.odoChar}>{c}</Text>;
        const k = seen++;
        // Each digit finishes a little after the one before it, and spins more turns the further right it is.
        const q = clamp01((p - (k / Math.max(1, digits)) * 0.25) / 0.75);
        const turns = 1 + (digits - k);
        const at = q * (turns * 10 + Number(c));
        return (
          <View key={i} style={styles.odoDigit}>
            <View style={{ transform: [{ translateY: -(at % 10) * ODO_H }] }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, j) => (
                <Text key={j} style={styles.odoChar}>{d}</Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function MoneyKept({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const p = useProgress(2200);
  const plan = planFor(recommendedPlan(draft.editorCost, draft.perWeek));
  const editorYear = editorMonthly(draft.editorCost) * 12;
  // Autocut at its yearly price: the cheaper way to pay, and one they can pick on the next screen.
  const autocutYear = pricePerMonth(plan.monthly, 'yearly') * 12;
  const kept = Math.max(0, Math.round(editorYear - autocutYear));
  // A tick as each digit lands, and a thud when the whole amount is in.
  const landed = Math.floor(clamp01(p) * 6);
  useEffect(() => {
    if (landed > 0 && landed < 6) Haptics.selectionAsync();
    if (landed === 6) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [landed]);
  // A little bump as the last digit lands.
  const pop = Math.sin(clamp01((p - 0.88) / 0.12) * Math.PI);
  return (
    <Backdrop footer={<Button title="See my plan" onPress={onNext} disabled={p < 1} />}>
      {header}
      <Text style={styles.kicker}>Over a year, you keep</Text>
      <View style={{ transform: [{ scale: 1 + 0.05 * pop }], transformOrigin: 'left' }}>
        <Odometer text={money(kept)} p={p} />
      </View>
      <Text style={[styles.monthly, { opacity: clamp01((p - 0.8) / 0.2) }]}>That’s {money(Math.round(kept / 12))} back in your pocket every month.</Text>
      <Text style={styles.lede}>From what you spend on edits now, next to Autocut {plan.name} billed yearly.</Text>
      <View style={styles.card}>
        <SpendChart editorYear={editorYear} autocutYear={autocutYear} kept={kept} p={p} />
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
  odometer: { flexDirection: 'row', height: ODO_H, overflow: 'hidden', marginTop: 2 },
  odoDigit: { height: ODO_H, overflow: 'hidden' },
  odoChar: { fontSize: 68, lineHeight: ODO_H, height: ODO_H, fontWeight: '800', color: theme.ink, letterSpacing: -2, fontVariant: ['tabular-nums'] },
  monthly: { fontSize: 17, fontWeight: '700', color: theme.ink, marginTop: 4 },
  lede: { fontSize: 15, color: theme.muted, lineHeight: 21, marginTop: 8 },
  card: { backgroundColor: theme.card, borderRadius: 22, padding: 18, gap: 18, marginTop: 26 },
  columns: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  column: { flex: 1, maxWidth: 150, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', paddingTop: 14, overflow: 'hidden' },
  columnLabel: { fontSize: 14, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  columnValue: { fontSize: 13, color: theme.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  columnFill: { position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: 22, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 18 },
  chartTitle: { fontSize: 17, fontWeight: '600', color: theme.ink },
  chartTag: { position: 'absolute', fontSize: 12, fontWeight: '700', color: theme.ink },
  keptPill: { position: 'absolute', width: 124, alignItems: 'center', backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  keptText: { color: '#fff', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  axis: { fontSize: 13, color: theme.muted },
  note: { fontSize: 12, color: theme.muted, lineHeight: 17 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, fontSize: 15, color: theme.ink, lineHeight: 20 },
  have: { fontSize: 14, color: theme.muted },
  legal: { fontSize: 12, color: theme.muted, textAlign: 'center', lineHeight: 17, marginTop: 2 },
  legalLink: { color: theme.ink, fontWeight: '600', textDecorationLine: 'underline' },
});
