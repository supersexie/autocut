import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Backdrop, Button } from '../components/ui';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

/** Where the confirmation email lands: swap the one-time code for a session, then into the app. */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(params.error_description ?? null);

  useEffect(() => {
    if (!params.code || !supabase) return;
    supabase.auth.exchangeCodeForSession(params.code).then(({ error: e }) => {
      if (e) setError('Your email is confirmed. Sign in with your email and password to continue.');
      else router.replace('/');
    });
  }, [params.code]);

  if (!params.code && !error) {
    return (
      <Backdrop>
        <Text style={{ fontSize: 16, color: theme.ink, textAlign: 'center', marginTop: 120 }}>Your email is confirmed.</Text>
        <Button kind="text" title="Sign in" onPress={() => router.replace('/')} />
      </Backdrop>
    );
  }

  return (
    <Backdrop>
      {error ? (
        <>
          <Text style={{ fontSize: 16, color: theme.ink, textAlign: 'center', marginTop: 120, lineHeight: 22 }}>{error}</Text>
          <Button kind="text" title="Go to sign in" onPress={() => router.replace('/')} />
        </>
      ) : (
        <ActivityIndicator style={{ marginTop: 160 }} color={theme.accent} />
      )}
    </Backdrop>
  );
}
