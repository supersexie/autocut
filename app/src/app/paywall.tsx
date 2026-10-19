import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { OnbHeader, OnbScreen, OnbTitle } from '../components/Onboarding';
import { PlanPicker } from '../components/PlanPicker';
import { Button, ErrorText, Field, Logo, Segmented } from '../components/ui';
import { displayName, useAuth, type Language } from '../lib/auth';
import { clearDraft, getDraft, profileFromDraft, updateDraft } from '../lib/draft';
import { updateSettings } from '../lib/store';
import { PAYMENTS_ON } from '../lib/billing';
import { theme } from '../lib/theme';
import { JAKARTA } from '../lib/fonts';

type Step = 'plan' | 'name' | 'handle' | 'ready' | 'help';

/**
 * Signed in, not set up yet: the plan (unless one was picked during setup), then the studio's
 * name, @handle, "your studio is ready" and an offer to show them around. Finishing saves it all
 * to the account and opens the app.
 */
export default function Paywall() {
  const { account, updateProfile, signOut } = useAuth();
  const draft = getDraft();
  // With payments on, the plan chosen during setup is bought here, once the account exists.
  const steps: Step[] = draft.plan && !PAYMENTS_ON ? ['name', 'handle', 'ready', 'help'] : ['plan', 'name', 'handle', 'ready', 'help'];
  const [step, setStep] = useState<Step>(steps[0]);
  const index = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(steps.length - 1, index + 1)]);
  const back = index > 0 && step !== 'ready' && step !== 'help' ? () => setStep(steps[index - 1]) : undefined;

  // The name a sign-in provider shared (or one made from the email) as a starting point.
  const suggested = displayName(account) === 'Creator' ? [] : displayName(account).split(' ');
  const [firstName, setFirstName] = useState(draft.firstName ?? account?.profile.firstName ?? suggested[0] ?? '');
  const [lastName, setLastName] = useState(draft.lastName ?? account?.profile.lastName ?? suggested.slice(1).join(' '));
  const [language, setLanguage] = useState<Language>(draft.language ?? account?.profile.language ?? 'en');
  const [handle, setHandle] = useState(draft.handle ?? account?.profile.handle ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(showAround: boolean) {
    setSaving(true);
    setError(null);
    // The tour of the main sections, and the editor's, unless they'd rather explore; either way,
    // once seen (or turned down) they don't come back on this account.
    try {
      const d = getDraft();
      await updateProfile({
        ...profileFromDraft(d),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        handle: handle.trim().replace(/^@/, '') || undefined,
        language,
        plan: d.plan,
        billing: d.billing ?? 'yearly',
        tour: !showAround,
        editorTour: !showAround,
        onboarded: true,
      });
      updateSettings({ cameraTourDone: !showAround, tourDone: !showAround });
      clearDraft(); // the app opens from here
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (step === 'plan') return <PlanPicker mode="onboarding" onDone={next} />;

  const header = <OnbHeader step={index} steps={steps.length} onBack={back} />;
  const hint = <Text style={styles.hint}>Change it anytime in Settings.</Text>;

  if (step === 'name') {
    const keep = () => {
      updateDraft({ firstName: firstName.trim(), lastName: lastName.trim(), language });
      next();
    };
    return (
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <OnbScreen header={header} footer={<><Button title="Continue" onPress={keep} disabled={!firstName.trim()} />{hint}</>}>
          <Animated.View entering={FadeIn.duration(260)} style={{ gap: 16 }}>
            <OnbTitle sub="So your cuts land with your name on them.">Who runs this studio?</OnbTitle>
            <Field label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" textContentType="givenName" returnKeyType="next" />
            <Field label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" textContentType="familyName" returnKeyType="done" />
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>I record in</Text>
              <Segmented value={language} onChange={setLanguage} options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }]} />
            </View>
            <Text style={styles.small}>
              Rather not say?{' '}
              <Text style={styles.link} onPress={next}>
                Skip for now
              </Text>
            </Text>
            {account?.email && (
              <Text style={styles.small}>
                Signed in as {account.email}.{' '}
                <Text style={styles.link} onPress={signOut}>
                  Sign out
                </Text>
              </Text>
            )}
          </Animated.View>
        </OnbScreen>
      </KeyboardAvoidingView>
    );
  }

  if (step === 'handle') {
    const keep = () => {
      updateDraft({ handle: handle.trim().replace(/^@/, '') });
      next();
    };
    return (
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <OnbScreen header={header} footer={<><Button title="Continue" onPress={keep} disabled={!handle.trim().replace(/^@/, '')} />{hint}</>}>
          <Animated.View entering={FadeIn.duration(260)} style={{ gap: 16 }}>
            <OnbTitle sub="Your TikTok handle. It’s how your studio signs its work.">Your @handle</OnbTitle>
            <Field prefix="@" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} autoFocus returnKeyType="done" onSubmitEditing={() => handle.trim() && keep()} />
            <Text style={styles.small}>
              No TikTok yet?{' '}
              <Text style={styles.link} onPress={next}>
                Skip for now
              </Text>
            </Text>
          </Animated.View>
        </OnbScreen>
      </KeyboardAvoidingView>
    );
  }

  if (step === 'ready') {
    const name = firstName.trim();
    return (
      <OnbScreen header={header} footer={<Button title="Start creating" onPress={next} />}>
        <View style={styles.center}>
          <Animated.View entering={FadeIn.duration(400).delay(100)}>
            <Logo size={96} />
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(300).duration(400)} style={styles.ready}>
            {name ? `${name}, your studio\nis ready.` : 'Your studio\nis ready.'}
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(550).duration(400)} style={styles.note}>
            <SymbolView name="video.fill" tintColor={theme.ink} size={16} />
            <Text style={styles.noteText}>Your setup is ready. Record a video or choose one from your library.</Text>
          </Animated.View>
        </View>
      </OnbScreen>
    );
  }

  return (
    <OnbScreen
      header={header}
      footer={
        <>
          <ErrorText>{error}</ErrorText>
          <Pressable onPress={() => finish(false)} disabled={saving} hitSlop={8} style={styles.own}>
            <Text style={styles.ownText}>I’ll explore on my own</Text>
          </Pressable>
          <Button title="Show me around" onPress={() => finish(true)} loading={saving} />
        </>
      }
    >
      <Animated.View entering={FadeIn.duration(260)}>
        <OnbTitle sub="Quick tips appear right where you need them while you record, send, and edit.">Want a hand with your first cut?</OnbTitle>
      </Animated.View>
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: theme.muted, fontFamily: JAKARTA.medium },
  small: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted },
  link: { color: theme.ink, fontFamily: JAKARTA.bold },
  hint: { fontSize: 12, fontFamily: JAKARTA.medium, color: theme.muted, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingBottom: 40 },
  ready: { fontSize: 30, fontFamily: JAKARTA.extrabold, color: theme.ink, textAlign: 'center', letterSpacing: -0.8, lineHeight: 35 },
  note: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, maxWidth: 340,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  noteText: { flex: 1, fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted, lineHeight: 19 },
  own: { alignSelf: 'center', paddingVertical: 10 },
  ownText: { fontSize: 15, fontFamily: JAKARTA.semibold, color: theme.ink },
});
