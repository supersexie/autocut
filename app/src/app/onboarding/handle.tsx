import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Backdrop, Button, ErrorText, Field, StepHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { onboarding as styles } from '../../components/onboarding';

const clean = (s: string) => s.replace(/^@+/, '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 24);

export default function HandleStep() {
  const { account, updateProfile } = useAuth();
  const [handle, setHandle] = useState(account?.profile.handle ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next(skip = false) {
    setSaving(true);
    setError(null);
    try {
      if (!skip) await updateProfile({ handle });
      router.push('/onboarding/tour');
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
          <Button title="Continue" onPress={() => next()} disabled={handle.length < 2} loading={saving} />
          <Text style={styles.hint}>Change it anytime in You.</Text>
        </>
      }
    >
      <StepHeader step={2} of={3} />
      <Text style={styles.title}>Your @handle</Text>
      <Text style={styles.subtitle}>Your TikTok handle. It’s how your studio signs its work.</Text>
      <View style={styles.form}>
        <Field
          prefix="@"
          value={handle}
          onChangeText={(t) => setHandle(clean(t))}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="next"
          onSubmitEditing={() => handle.length >= 2 && next()}
          accessibilityLabel="TikTok handle"
        />
        <Text style={styles.small}>
          No TikTok yet? <Text style={styles.link} onPress={() => next(true)}>Skip for now</Text>
        </Text>
        <ErrorText>{error}</ErrorText>
      </View>
    </Backdrop>
  );
}
