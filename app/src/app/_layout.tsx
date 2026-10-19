import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { APP_FONTS } from '../lib/fonts';
import { useBackgroundUpdates } from '../lib/updates';
import { ConsentGate } from '../components/ConsentGate';
import { Launch } from '../components/Launch';
import { PlanSync } from '../components/PlanSync';
import { AuthProvider, useAuth } from '../lib/auth';
import { reportAs, withCrashReports } from '../lib/crashes';

SplashScreen.preventAutoHideAsync();

export default withCrashReports(RootLayout);

function RootLayout() {
  useBackgroundUpdates();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
        <ConsentGate />
        <PlanSync />
        <Launch />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

/** Signed out → welcome and setup questions. Signed in but no plan yet → paywall. Otherwise the app. */
function RootNavigator() {
  const { loading, account } = useAuth();
  useEffect(() => {
    reportAs(account?.id ?? null);
  }, [account?.id]);
  // Caption and text styles preview in the same fonts the export uses.
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  // The loading screen (components/Launch) covers this until it's ready, and hides the system one.
  const ready = !loading && (fontsLoaded || !!fontError);
  if (!ready) return null;

  const signedIn = !!account;
  // Each screen opens once: a double tap (or a tap that lands twice) shows the one already open
  // instead of stacking a second copy on top. The cutting screen and editor are one per cut.
  const perCut = (_name: string, params: Record<string, unknown>) => String(params.id ?? '');
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
        <Stack.Screen name="review" options={{ presentation: 'fullScreenModal' }} dangerouslySingular />
        <Stack.Screen name="arrange" options={{ presentation: 'fullScreenModal' }} dangerouslySingular />
        <Stack.Screen name="cut/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} dangerouslySingular={perCut} />
        {/* A full-screen modal like "Cutting", so going from one to the other never shows the camera
            underneath, and no edge swipe fights the timeline. */}
        <Stack.Screen name="edit/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} dangerouslySingular={perCut} />
        <Stack.Screen name="settings" dangerouslySingular />
        <Stack.Screen name="plan" dangerouslySingular />
        <Stack.Screen name="change-plan" dangerouslySingular />
        <Stack.Screen name="cut-options" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.55, 1], sheetGrabberVisible: true }} dangerouslySingular />
        <Stack.Screen name="edit-profile" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} dangerouslySingular />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" />
    </Stack>
  );
}
