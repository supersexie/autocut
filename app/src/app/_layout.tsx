import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { CAPTION_FONTS } from '../lib/fonts';
import { AuthProvider, useAuth } from '../lib/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

/** Signed out → welcome and setup questions. Signed in but no plan yet → paywall. Otherwise the app. */
function RootNavigator() {
  const { loading, account } = useAuth();
  // Caption and text styles preview in the same fonts the export uses.
  const [fontsLoaded, fontError] = useFonts(CAPTION_FONTS);
  const ready = !loading && (fontsLoaded || !!fontError);
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);
  if (!ready) return null;

  const signedIn = !!account;
  const onboarded = !!account?.profile.onboarded;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="paywall" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="review" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="cut/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        {/* A full-screen modal like "Cutting", so going from one to the other never shows the camera
            underneath, and no edge swipe fights the timeline. */}
        <Stack.Screen name="edit/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" />
    </Stack>
  );
}
