import * as Linking from 'expo-linking';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Backdrop, Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

const CONFIRMED = 'Your email is confirmed. Sign in with your email and password to continue.';

/** Reads a parameter from a link's query (?code=…) or fragment (#access_token=…). */
function param(url: string, name: string) {
  const match = new RegExp(`[?#&]${name}=([^&#]*)`).exec(url);
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
}

/**
 * Where the confirmation email lands. Supabase sends either a one-time `code` (PKCE) or the
 * tokens themselves in the fragment; either way, turn it into a session and go into the app.
 */
export default function AuthCallback() {
  const { account } = useAuth();
  const url = Linking.useLinkingURL();
  const [failed, setFailed] = useState<string | null>(null);

  const code = url ? param(url, 'code') : null;
  const accessToken = url ? param(url, 'access_token') : null;
  const refreshToken = url ? param(url, 'refresh_token') : null;
  const linkError = url ? param(url, 'error_description') : null;
  const canSignIn = !!supabase && !linkError && (!!code || (!!accessToken && !!refreshToken));

  useEffect(() => {
    if (!supabase || account || !canSignIn) return;
    const done = ({ error }: { error: unknown }) => error && setFailed(CONFIRMED);
    if (code) supabase.auth.exchangeCodeForSession(code).then(done);
    else supabase.auth.setSession({ access_token: accessToken!, refresh_token: refreshToken! }).then(done);
  }, [account, canSignIn, code, accessToken, refreshToken]);

  const message = failed ?? linkError ?? (canSignIn ? null : CONFIRMED);

  // Signed in (now or already): the root navigator takes it from here.
  if (account) return <Redirect href={account.profile.onboarded ? '/' : '/paywall'} />;

  return (
    <Backdrop>
      {message ? (
        <>
          <Text style={{ fontSize: 16, color: theme.ink, textAlign: 'center', marginTop: 120, lineHeight: 22, marginHorizontal: 12 }}>{message}</Text>
          <Button kind="text" title="Go to sign in" onPress={() => router.replace('/sign-in')} />
        </>
      ) : (
        <ActivityIndicator style={{ marginTop: 160 }} color={theme.accent} />
      )}
    </Backdrop>
  );
}
