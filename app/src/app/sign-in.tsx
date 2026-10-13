import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Backdrop, Button, ErrorText, Field, Logo } from '../components/ui';
import { enabledProviders, NOT_CONFIGURED, useAuth } from '../lib/auth';
import { theme } from '../lib/theme';

type Mode = 'sign-in' | 'sign-up';

export default function SignIn() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    enabledProviders().then(async ({ google, apple }) => {
      setGoogleAvailable(google);
      setAppleAvailable(apple && Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync()));
    });
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
      if (mode === 'sign-in') return auth.signInWithEmail(email, password);
      const result = await auth.signUpWithEmail(email, password);
      if (result === 'check-email') {
        setNotice(`We sent a confirmation link to ${email.trim()}. Open it, then sign in here.`);
        setMode('sign-in');
      }
    });

  const forgot = () =>
    run('email', async () => {
      if (!email.includes('@')) throw new Error('Enter your email above first, then tap Forgot password.');
      await auth.resetPassword(email);
      setNotice(`Password reset link sent to ${email.trim()}.`);
    });

  const canSubmit = email.includes('@') && password.length >= 6;
  const signingUp = mode === 'sign-up';

  return (
    <Backdrop>
      <View style={styles.header}>
        <Logo />
        <Text style={styles.brand}>Autocut</Text>
        <Text style={styles.title}>{signingUp ? 'Create your account' : 'Sign in'}</Text>
        <Text style={styles.subtitle}>Drop a take, get the cut.</Text>
      </View>

      <View style={styles.stack}>
        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
            cornerRadius={14}
            style={{ height: 50, opacity: busy ? 0.5 : 1 }}
            onPress={() => !busy && run('apple', auth.signInWithApple)}
          />
        )}
        {googleAvailable && (
          <Button
            kind="outline"
            title="Continue with Google"
            icon={<Text style={styles.g}>G</Text>}
            loading={busy === 'google'}
            disabled={!!busy && busy !== 'google'}
            onPress={() => run('google', auth.signInWithGoogle)}
          />
        )}
      </View>

      {(appleAvailable || googleAvailable) && (
        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text style={styles.or}>or with email</Text>
          <View style={styles.rule} />
        </View>
      )}

      <View style={styles.stack}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <Field
          label="Password"
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
        <Button
          title={signingUp ? 'Create account' : 'Sign in'}
          onPress={submit}
          disabled={!canSubmit || (!!busy && busy !== 'email')}
          loading={busy === 'email'}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.legal}>
          By continuing, you agree to our <Text style={styles.legalLink}>Terms of Service</Text> and{' '}
          <Text style={styles.legalLink}>Privacy Policy</Text>.
        </Text>
        <Text style={styles.switch}>
          {signingUp ? 'Already have an account? ' : "Don't have an account? "}
          <Text
            style={styles.link}
            onPress={() => {
              setMode(signingUp ? 'sign-in' : 'sign-up');
              setError(null);
              setNotice(null);
            }}
          >
            {signingUp ? 'Sign in' : 'Create one'}
          </Text>
        </Text>

        {!auth.configured && (
          <View style={styles.devBox}>
            <Text style={styles.devText}>{NOT_CONFIGURED}</Text>
            {__DEV__ && <Button kind="text" title="Continue without an account" onPress={auth.continueWithoutAccount} />}
          </View>
        )}
      </View>
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 6, marginTop: 28, marginBottom: 28 },
  brand: { fontSize: 20, fontWeight: '800', color: theme.ink, marginTop: 6 },
  title: { fontSize: 24, fontWeight: '700', color: theme.ink, marginTop: 14 },
  subtitle: { fontSize: 14, color: theme.muted },
  stack: { gap: 12 },
  g: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 20 },
  rule: { flex: 1, height: 1, backgroundColor: '#D5DBE5' },
  or: { fontSize: 13, color: theme.faint },
  link: { fontSize: 14, color: theme.accent, fontWeight: '600' },
  notice: { fontSize: 14, color: theme.ink, lineHeight: 20, backgroundColor: 'rgba(61,133,245,0.1)', padding: 12, borderRadius: 12 },
  footer: { marginTop: 'auto', paddingTop: 28, gap: 14, alignItems: 'center' },
  legal: { fontSize: 12, color: theme.faint, textAlign: 'center', lineHeight: 18 },
  legalLink: { textDecorationLine: 'underline', color: theme.muted },
  switch: { fontSize: 14, color: theme.muted },
  devBox: { alignSelf: 'stretch', borderRadius: 12, borderWidth: 1, borderColor: '#F2C94C', backgroundColor: '#FFF9E6', padding: 12, gap: 4 },
  devText: { fontSize: 13, color: '#7A5B00', textAlign: 'center' },
});
