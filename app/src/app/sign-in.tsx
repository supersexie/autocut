import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { agreed, ConsentChecks, type Agreement } from '../components/ConsentChecks';
import { AppleLogo, Backdrop, Button, ErrorText, Field, GoogleLogo, StepHeader, Title, PreAppFont } from '../components/ui';
import { openLegal } from '../lib/api';
import { NOT_CONFIGURED, socialOptions, useAuth } from '../lib/auth';
import { holdAgreement, TERMS_VERSION } from '../lib/consent';
import { theme } from '../lib/theme';
import { JAKARTA } from '../lib/fonts';

type Mode = 'sign-in' | 'sign-up';

/** Email sign-in for returning users, or account creation at the end of setup (mode=sign-up). */
export default function SignIn() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ mode?: Mode }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'sign-up' ? 'sign-up' : 'sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providers, setProviders] = useState({ apple: false, google: false });
  const [agreement, setAgreement] = useState<Agreement>({ terms: false, ai: false });
  const signingUp = mode === 'sign-up';
  // Creating an account needs the terms agreed first (signing in to an existing one doesn't).
  const blocked = signingUp && !agreed(agreement);
  const terms = { termsVersion: TERMS_VERSION, aiConsent: agreement.ai };

  useEffect(() => {
    socialOptions().then(setProviders);
  }, []);

  async function run(kind: 'email' | 'apple' | 'google', action: () => Promise<unknown>) {
    setError(null);
    setNotice(null);
    setBusy(kind);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const submit = () =>
    run('email', async () => {
      if (!signingUp) return auth.signInWithEmail(email, password);
      const result = await auth.signUpWithEmail(email, password, terms);
      if (result === 'check-email') {
        setNotice(`We sent a link to ${email.trim()}. Open it on this device to finish, or confirm it and sign in here.`);
        setMode('sign-in');
      }
    });

  const forgot = () =>
    run('email', async () => {
      if (!email.includes('@')) throw new Error('Enter your email first, then tap Forgot password.');
      await auth.resetPassword(email);
      setNotice(`Password reset link sent to ${email.trim()}.`);
    });

  const canSubmit = email.includes('@') && password.length >= 6 && !blocked;
  // The buttons always look ready. Tapped before the Terms are agreed: point at the box instead.
  const [nudge, setNudge] = useState(false);
  const social_ = (kind: 'apple' | 'google', action: () => Promise<void>) => {
    if (blocked) {
      Keyboard.dismiss();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setNudge(true);
      setError('Tick the box below to agree to the Terms first.');
      return;
    }
    return run(kind, async () => {
      holdAgreement(signingUp ? terms : null);
      await action();
    });
  };
  const agree = (a: Agreement) => {
    setAgreement(a);
    if (agreed(a) && nudge) {
      setNudge(false);
      setError(null);
    }
  };
  const social = providers.apple || providers.google;

  return (
    <PreAppFont>
    <Backdrop>
      <StepHeader />
      <Title sub={signingUp ? 'Use at least 6 characters for your password.' : 'Welcome back.'}>
        {signingUp ? 'Create your account' : 'Sign in'}
      </Title>

      {social && (
        <View style={{ gap: 12, marginBottom: 18 }}>
          {providers.apple && (
            <Button title="Continue with Apple" icon={<AppleLogo />} loading={busy === 'apple'} onPress={() => social_('apple', auth.signInWithApple)} />
          )}
          {providers.google && (
            <Button kind="outline" title="Continue with Google" icon={<GoogleLogo />} loading={busy === 'google'} onPress={() => social_('google', auth.signInWithGoogle)} />
          )}
          <View style={styles.divider}>
            <View style={styles.rule} />
            <Text style={styles.or}>or with email</Text>
            <View style={styles.rule} />
          </View>
        </View>
      )}

      <View style={{ gap: 12 }}>
        <Field
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          autoFocus
        />
        <Field
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          textContentType={signingUp ? 'newPassword' : 'password'}
          onSubmitEditing={() => canSubmit && submit()}
          returnKeyType="go"
        />
        {!signingUp && (
          <Pressable onPress={forgot} style={{ alignSelf: 'flex-end' }} hitSlop={8}>
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>
        )}
        <ErrorText>{error}</ErrorText>
        {notice && <Text style={styles.notice}>{notice}</Text>}
        <Button title={signingUp ? 'Create account' : 'Sign in'} onPress={submit} disabled={!canSubmit} loading={busy === 'email'} style={{ marginTop: 6 }} />
        {signingUp ? (
          <ConsentChecks value={agreement} onChange={agree} highlight={nudge && !agreed(agreement)} />
        ) : (
          <Text style={styles.terms}>
            By continuing, you agree to our{' '}
            <Text style={styles.termsLink} onPress={() => openLegal('terms')}>
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text style={styles.termsLink} onPress={() => openLegal('privacy')}>
              Privacy Policy
            </Text>
            .
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        {signingUp ? (
          <Text style={styles.switch}>
            Already have an account?{' '}
            <Text style={styles.link} onPress={() => setMode('sign-in')}>
              Sign in
            </Text>
          </Text>
        ) : (
          <Text style={styles.switch}>
            New to Autocut?{' '}
            <Text style={styles.link} onPress={() => router.replace('/setup')}>
              Get started
            </Text>
          </Text>
        )}
        {!auth.configured && (
          <View style={styles.devBox}>
            <Text style={styles.devText}>{NOT_CONFIGURED}</Text>
            {__DEV__ && <Button kind="text" title="Continue without an account" onPress={auth.continueWithoutAccount} />}
          </View>
        )}
      </View>
    </Backdrop>
    </PreAppFont>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  rule: { flex: 1, height: 1, backgroundColor: theme.line },
  terms: { fontSize: 13, fontFamily: JAKARTA.medium, lineHeight: 18, color: theme.muted, textAlign: 'center' },
  termsLink: { color: theme.ink, fontFamily: JAKARTA.bold },
  or: { fontSize: 13, fontFamily: JAKARTA.medium, color: theme.faint },
  link: { fontSize: 14, color: theme.ink, fontFamily: JAKARTA.bold },
  notice: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.ink, lineHeight: 20, backgroundColor: theme.card, padding: 14, borderRadius: 14 },
  footer: { marginTop: 'auto', paddingTop: 28, gap: 14, alignItems: 'center' },
  switch: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted },
  devBox: { alignSelf: 'stretch', borderRadius: 14, backgroundColor: '#FFF7E0', padding: 12, gap: 4 },
  devText: { fontSize: 13, fontFamily: JAKARTA.medium, color: '#7A5B00', textAlign: 'center' },
});
