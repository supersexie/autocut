import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Backdrop, Button, ErrorText, Field, Segmented, StepHeader } from '../../components/ui';
import { useAuth, type Language } from '../../lib/auth';
import { onboarding as styles } from '../../components/onboarding';

export default function NameStep() {
  const { account, updateProfile, signOut } = useAuth();
  const profile = account?.profile ?? {};
  const [first, setFirst] = useState(profile.firstName ?? '');
  const [last, setLast] = useState(profile.lastName ?? '');
  const [language, setLanguage] = useState<Language>(profile.language ?? 'en');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next(skip = false) {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(skip ? { language } : { firstName: first.trim(), lastName: last.trim(), language });
      router.push('/onboarding/handle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Backdrop
      footer={
        <>
          <Button title="Continue" onPress={() => next()} disabled={!first.trim()} loading={saving} />
          <Text style={styles.hint}>Change it anytime in You.</Text>
        </>
      }
    >
      <StepHeader step={1} of={3} canGoBack={false} />
      <Text style={styles.title}>Who runs this studio?</Text>
      <Text style={styles.subtitle}>So your cuts land with your name on them.</Text>

      <View style={styles.form}>
        <Field label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" textContentType="givenName" autoFocus />
        <Field label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" textContentType="familyName" />
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>I record in</Text>
          <Segmented
            value={language}
            onChange={setLanguage}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
          />
        </View>
        <Text style={styles.small}>
          Rather not say? <Text style={styles.link} onPress={() => next(true)}>Skip for now</Text>
        </Text>
        <ErrorText>{error}</ErrorText>
      </View>

      <Text style={[styles.small, { marginTop: 'auto', paddingTop: 24 }]}>
        Signed in as {account?.email ?? 'a guest (dev mode)'}. <Text style={styles.link} onPress={signOut}>Sign out</Text>
      </Text>
    </Backdrop>
  );
}
