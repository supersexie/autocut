import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../lib/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}

/** Signed out → sign-in. Signed in but new → onboarding. Otherwise the app. */
function RootNavigator() {
  const { loading, account } = useAuth();
  useEffect(() => {
    if (!loading) SplashScreen.hide();
  }, [loading]);
  if (loading) return null;

  const signedIn = !!account;
  const onboarded = !!account?.profile.onboarded;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="review" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="cut/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="edit/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}
