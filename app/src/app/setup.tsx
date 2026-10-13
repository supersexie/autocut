import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Backdrop, Button, ErrorText, Field, Option, StepHeader, Title, type SymbolName } from '../components/ui';
import { enabledProviders, useAuth } from '../lib/auth';
import { updateDraft, useDraft, type Draft } from '../lib/draft';
import { updateSettings, useSettings } from '../lib/store';
import { theme } from '../lib/theme';

type Choice = { value: string; label: string; detail?: string; icon?: SymbolName };
type Step =
  | { kind: 'choice'; key: keyof Draft; title: string; sub?: string; options: Choice[] }
  | { kind: 'multi'; key: 'blockers'; title: string; sub?: string; options: Choice[] }
  | { kind: 'compare' | 'name' | 'handle' | 'loading' | 'result' | 'save' };

const STEPS: Step[] = [
  {
    kind: 'choice', key: 'creates', title: 'What do you film?', sub: 'Autocut tunes its cuts to the kind of videos you make.',
    options: [
      { value: 'ugc', label: 'UGC ads', icon: 'bag.fill' },
      { value: 'shortform', label: 'TikToks and Reels', icon: 'play.rectangle.fill' },
      { value: 'youtube', label: 'YouTube videos', icon: 'play.tv.fill' },
      { value: 'talking', label: 'Podcasts and talking heads', icon: 'mic.fill' },
    ],
  },
  {
    kind: 'choice', key: 'perWeek', title: 'How many videos do you film per week?', sub: 'This sets up your plan.',
    options: [
      { value: '0-2', label: '0–2', detail: 'Now and then', icon: 'circle.fill' },
      { value: '3-5', label: '3–5', detail: 'A few every week', icon: 'circle.grid.2x1.fill' },
      { value: '6+', label: '6+', detail: 'Almost every day', icon: 'circle.grid.3x3.fill' },
    ],
  },
  {
    kind: 'choice', key: 'heardFrom', title: 'Where did you hear about us?',
    options: [
      { value: 'tiktok', label: 'TikTok', icon: 'music.note' },
      { value: 'instagram', label: 'Instagram', icon: 'camera.fill' },
      { value: 'youtube', label: 'YouTube', icon: 'play.rectangle.fill' },
      { value: 'friend', label: 'Friend or family', icon: 'person.2.fill' },
      { value: 'appstore', label: 'App Store', icon: 'apps.iphone' },
      { value: 'other', label: 'Somewhere else', icon: 'ellipsis' },
    ],
  },
  {
    kind: 'choice', key: 'editTime', title: 'How long does editing one video take you now?', sub: 'Cutting out the pauses, flubs and retakes by hand.',
    options: [
      { value: '15', label: 'Under 15 minutes', icon: 'hare.fill' },
      { value: '40', label: '15 minutes to an hour', icon: 'clock.fill' },
      { value: '75', label: 'More than an hour', icon: 'tortoise.fill' },
    ],
  },
  { kind: 'compare' },
  {
    kind: 'multi', key: 'blockers', title: 'What slows you down the most?', sub: 'Pick all that apply.',
    options: [
      { value: 'time', label: 'Editing takes too long', icon: 'clock.fill' },
      { value: 'retakes', label: 'Flubbed lines and retakes', icon: 'arrow.counterclockwise' },
      { value: 'pauses', label: 'Awkward pauses', icon: 'pause.fill' },
      { value: 'captions', label: 'Adding captions', icon: 'captions.bubble.fill' },
      { value: 'consistency', label: 'Posting consistently', icon: 'calendar' },
    ],
  },
  {
    kind: 'choice', key: 'language', title: 'What language do you record in?', sub: 'Autocut listens for every word, so it needs to know.',
    options: [
      { value: 'en', label: 'English', icon: 'textformat' },
      { value: 'es', label: 'Español', icon: 'textformat' },
    ],
  },
  { kind: 'name' },
  { kind: 'handle' },
  { kind: 'loading' },
  { kind: 'result' },
  { kind: 'save' },
];

// Steps that show the progress line (everything before the "setting up" screen).
const QUESTIONS = STEPS.findIndex((s) => s.kind === 'loading');
const minutesFor = (editTime?: string) => Number(editTime ?? 40);
const videosFor = (perWeek?: string) => (perWeek === '6+' ? 7 : perWeek === '3-5' ? 4 : 1);

export default function Setup() {
  const draft = useDraft();
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => (step === 0 ? router.back() : setStep(step - 1));
  const header = current.kind === 'loading' ? null : <StepHeader progress={step < QUESTIONS ? (step + 1) / QUESTIONS : undefined} onBack={back} />;

  if (current.kind === 'choice' || current.kind === 'multi') {
    const multi = current.kind === 'multi';
    const single = draft[current.key];
    const picked: string[] = multi ? draft.blockers ?? [] : typeof single === 'string' ? [single] : [];
    const toggle = (v: string) => {
      if (!multi) return updateDraft({ [current.key]: v } as Draft);
      updateDraft({ blockers: picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v] });
    };
    return (
      <Backdrop footer={<Button title="Continue" onPress={next} disabled={!picked.length} />}>
        {header}
        <Title sub={current.sub}>{current.title}</Title>
        <View style={{ gap: 10 }}>
          {current.options.map((o) => (
            <Option key={o.value} label={o.label} detail={o.detail} icon={o.icon} multi={multi} selected={picked.includes(o.value)} onPress={() => toggle(o.value)} />
          ))}
        </View>
      </Backdrop>
    );
  }

  if (current.kind === 'compare') return <Compare header={header} minutes={minutesFor(draft.editTime)} onNext={next} />;
  if (current.kind === 'name') return <NameStep header={header} onNext={next} />;
  if (current.kind === 'handle') return <HandleStep header={header} onNext={next} />;
  if (current.kind === 'loading') return <Loading onDone={next} />;
  if (current.kind === 'result') return <Result header={header} draft={draft} onNext={next} />;
  return <Save header={header} />;
}

function Compare({ header, minutes, onNext }: { header: React.ReactNode; minutes: number; onNext: () => void }) {
  return (
    <Backdrop footer={<Button title="Continue" onPress={onNext} />}>
      {header}
      <Title sub="Autocut finds the dead air, ums and retakes for you, so you only check the cut.">Spend your time filming, not trimming</Title>
      <View style={styles.chart}>
        <Text style={styles.chartTitle}>Time to edit one video</Text>
        <View style={styles.bars}>
          <Bar label="By hand" value={`${minutes} min`} height={1} dark={false} />
          <Bar label="With Autocut" value="~1 min" height={Math.max(0.08, 1 / minutes)} dark />
        </View>
        <Text style={styles.chartNote}>Based on your answer. Autocut timing depends on the length of your take.</Text>
      </View>
    </Backdrop>
  );
}

function Bar({ label, value, height, dark }: { label: string; value: string; height: number; dark: boolean }) {
  return (
    <View style={styles.barCol}>
      <Text style={styles.barValue}>{value}</Text>
      <View style={[styles.bar, { height: `${height * 100}%`, backgroundColor: dark ? theme.ink : '#E4E4E8' }]} />
      <Text style={styles.barLabel}>{label}</Text>
    </View>
  );
}

function NameStep({ header, onNext }: { header: React.ReactNode; onNext: () => void }) {
  const draft = useDraft();
  return (
    <Backdrop footer={<Button title="Continue" onPress={onNext} disabled={!draft.firstName?.trim()} />}>
      {header}
      <Title sub="So your cuts land with your name on them.">What should we call you?</Title>
      <View style={{ gap: 14 }}>
        <Field placeholder="First name" value={draft.firstName ?? ''} onChangeText={(firstName) => updateDraft({ firstName })} autoComplete="given-name" textContentType="givenName" autoFocus />
        <Field placeholder="Last name (optional)" value={draft.lastName ?? ''} onChangeText={(lastName) => updateDraft({ lastName })} autoComplete="family-name" textContentType="familyName" />
      </View>
    </Backdrop>
  );
}

function HandleStep({ header, onNext }: { header: React.ReactNode; onNext: () => void }) {
  const draft = useDraft();
  const clean = (s: string) => s.replace(/^@+/, '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 24);
  return (
    <Backdrop
      footer={
        <>
          <Button title="Continue" onPress={onNext} disabled={(draft.handle ?? '').length < 2} />
          <Button kind="text" title="Skip for now" onPress={onNext} />
        </>
      }
    >
      {header}
      <Title sub="Your TikTok handle. It's how your studio signs its work.">Your @handle</Title>
      <Field prefix="@" placeholder="yourhandle" value={draft.handle ?? ''} onChangeText={(t) => updateDraft({ handle: clean(t) })} autoCapitalize="none" autoCorrect={false} autoFocus accessibilityLabel="TikTok handle" />
    </Backdrop>
  );
}

const SETUP_ITEMS = ['Dead air', 'Retakes', 'Ums and uhs', 'Captions', 'Your pace'];
const SETUP_STATUS = ['Learning your style…', 'Tuning pause length…', 'Setting up retakes…', 'Finalizing results…'];

function Loading({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (pct >= 100) {
      const t = setTimeout(onDone, 500);
      return () => clearTimeout(t);
    }
    // Uneven steps so it reads as work being done rather than a timer.
    const t = setTimeout(() => setPct((p) => Math.min(100, p + 3 + Math.round(Math.random() * 6))), 90);
    return () => clearTimeout(t);
  }, [pct, onDone]);
  return (
    <Backdrop scroll={false}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 18 }}>
        <Text style={styles.pct}>{pct}%</Text>
        <Text style={styles.loadingTitle}>We’re setting everything up for you</Text>
        <View style={styles.loadTrack}>
          <View style={[styles.loadFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.loadStatus}>{SETUP_STATUS[Math.min(SETUP_STATUS.length - 1, Math.floor(pct / 26))]}</Text>
        <View style={styles.checklist}>
          <Text style={styles.checkTitle}>Your cut style for</Text>
          {SETUP_ITEMS.map((item, i) => {
            const done = pct >= ((i + 1) / SETUP_ITEMS.length) * 100 - 4;
            return (
              <View key={item} style={styles.checkRow}>
                <Text style={styles.checkItem}>• {item}</Text>
                {done && <SymbolView name="checkmark.circle.fill" tintColor={theme.ink} size={18} />}
              </View>
            );
          })}
        </View>
      </View>
    </Backdrop>
  );
}

function Result({ header, draft, onNext }: { header: React.ReactNode; draft: Draft; onNext: () => void }) {
  const settings = useSettings();
  const hours = Math.round((videosFor(draft.perWeek) * Math.max(0, minutesFor(draft.editTime) - 1) * 4.3) / 60);
  return (
    <Backdrop footer={<Button title="Let’s get started!" onPress={onNext} />}>
      {header}
      <View style={{ alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <View style={styles.okBadge}>
          <SymbolView name="checkmark" tintColor="#fff" size={14} weight="bold" />
        </View>
        <Text style={styles.resultTitle}>
          {draft.firstName ? `${draft.firstName}, your` : 'Your'} cut style is ready
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Time you could get back</Text>
        <Text style={styles.big}>~{Math.max(1, hours)} hours</Text>
        <Text style={styles.cardSub}>a month, from your answers ({videosFor(draft.perWeek)} video{videosFor(draft.perWeek) === 1 ? '' : 's'} a week). An estimate.</Text>
      </View>

      <View style={[styles.card, { marginTop: 12 }]}>
        <Text style={styles.cardTitle}>Your cut settings</Text>
        <Text style={styles.cardSub}>You can change these anytime.</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Longest pause</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => updateSettings({ maxGap: Math.max(0.15, +(settings.maxGap - 0.05).toFixed(2)) })} hitSlop={8} accessibilityLabel="Shorter pauses">
              <SymbolView name="minus" tintColor={theme.ink} size={14} />
            </Pressable>
            <Text style={styles.stepValue}>{settings.maxGap.toFixed(2)}s</Text>
            <Pressable onPress={() => updateSettings({ maxGap: Math.min(0.8, +(settings.maxGap + 0.05).toFixed(2)) })} hitSlop={8} accessibilityLabel="Longer pauses">
              <SymbolView name="plus" tintColor={theme.ink} size={14} />
            </Pressable>
          </View>
        </View>
        <SettingSwitch label="Remove ums and uhs" value={settings.removeFillers} onChange={(v) => updateSettings({ removeFillers: v })} />
        <SettingSwitch label="Keep only my last take" value={settings.removeRetakes} onChange={(v) => updateSettings({ removeRetakes: v })} />
        <SettingSwitch label="Captions" value={settings.captions} onChange={(v) => updateSettings({ captions: v })} />
      </View>
    </Backdrop>
  );
}

function SettingSwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.ink }} />
    </View>
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

  return (
    <Backdrop>
      {header}
      <Title>Save your progress</Title>
      <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
        {providers.apple && (
          <Button title="Sign in with Apple" icon={<SymbolView name="apple.logo" tintColor="#fff" size={18} />} loading={busy === 'apple'} onPress={() => go('apple')} />
        )}
        {providers.google && (
          <Button kind="outline" title="Sign in with Google" icon={<Text style={styles.g}>G</Text>} loading={busy === 'google'} onPress={() => go('google')} />
        )}
        <Button
          kind={providers.apple || providers.google ? 'outline' : 'primary'}
          title="Continue with email"
          icon={<SymbolView name="envelope" tintColor={providers.apple || providers.google ? theme.ink : '#fff'} size={17} />}
          onPress={() => go('email')}
        />
        <Pressable style={styles.agree} onPress={() => setAgreed(!agreed)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
          <View style={[styles.box, agreed && styles.boxOn]}>{agreed && <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />}</View>
          <Text style={styles.agreeText}>I agree to Autocut’s Terms and Conditions and Privacy Policy</Text>
        </Pressable>
        {tried && !agreed && <Text style={styles.mustAgree}>Accept the Terms and Privacy Policy to continue.</Text>}
        <ErrorText>{error}</ErrorText>
      </View>
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  chart: { backgroundColor: theme.card, borderRadius: 22, padding: 20, gap: 14 },
  chartTitle: { fontSize: 15, fontWeight: '600', color: theme.ink },
  bars: { flexDirection: 'row', height: 220, gap: 22, alignItems: 'flex-end', paddingHorizontal: 20 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 8, height: '100%' },
  bar: { width: '100%', borderRadius: 14, maxHeight: '78%' },
  barValue: { fontSize: 15, fontWeight: '700', color: theme.ink },
  barLabel: { fontSize: 13, color: theme.muted },
  chartNote: { fontSize: 12, color: theme.faint, textAlign: 'center' },
  pct: { fontSize: 56, fontWeight: '700', color: theme.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  loadingTitle: { fontSize: 26, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.4 },
  loadTrack: { height: 6, borderRadius: 3, backgroundColor: theme.line, overflow: 'hidden', marginHorizontal: 10 },
  loadFill: { height: 6, borderRadius: 3, backgroundColor: theme.ink },
  loadStatus: { fontSize: 14, color: theme.muted, textAlign: 'center' },
  checklist: { backgroundColor: theme.card, borderRadius: 18, padding: 18, gap: 10, marginTop: 8 },
  checkTitle: { fontSize: 15, fontWeight: '600', color: theme.ink, marginBottom: 2 },
  checkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 22 },
  checkItem: { fontSize: 15, color: theme.ink },
  okBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 26, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.4 },
  card: { backgroundColor: theme.card, borderRadius: 20, padding: 18, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: theme.ink },
  cardSub: { fontSize: 13, color: theme.muted, lineHeight: 18 },
  big: { fontSize: 36, fontWeight: '800', color: theme.ink, marginTop: 4, fontVariant: ['tabular-nums'] },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8 },
  settingLabel: { fontSize: 15, color: theme.ink, fontWeight: '500' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepValue: { fontSize: 15, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'], minWidth: 48, textAlign: 'center' },
  g: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  agree: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  agreeText: { flex: 1, fontSize: 13, color: theme.muted, lineHeight: 18 },
  mustAgree: { fontSize: 13, color: '#E0811E' },
});
