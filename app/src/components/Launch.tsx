import { useFonts } from 'expo-font';
import { SplashScreen } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { APP_FONTS } from '../lib/fonts';

// Keep these in step with "expo-splash-screen" in app.json, so the hand-over from the system's
// launch screen to this one doesn't move: same colour, same mark, same size, in the middle.
const BG = '#E9EDFD';
const MARK_SIZE = 120;
const MARK = require('../../assets/splash-icon.png');
const WORDMARK = require('../../assets/wordmark.png');
const WORDMARK_W = 96;
/** The least time it shows, so it doesn't just flicker past on a fast start. */
const AT_LEAST = 700;

/**
 * The loading screen, like Instagram Edits': the mark in the middle of a light blue screen and the
 * "Autocut" wordmark at the bottom. It takes over from the system launch screen (which can only show
 * the mark), stays until the account and fonts are ready, then fades away over the app.
 */
export function Launch() {
  const insets = useSafeAreaInsets();
  const { loading } = useAuth();
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  const [waited, setWaited] = useState(false);
  const [gone, setGone] = useState(false);
  const opacity = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const done = waited && !loading && (fontsLoaded || !!fontError);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), AT_LEAST);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!done) return;
    opacity.set(withTiming(0, { duration: 320 }));
    const t = setTimeout(() => setGone(true), 340);
    return () => clearTimeout(t);
  }, [done, opacity]);

  if (gone) return null;
  return (
    <Animated.View style={[styles.screen, style]} pointerEvents={done ? 'none' : 'auto'} onLayout={() => SplashScreen.hide()}>
      <Image source={MARK} style={{ width: MARK_SIZE, height: MARK_SIZE }} accessibilityLabel="Autocut" />
      <Animated.Image
        entering={FadeIn.delay(120).duration(400)}
        source={WORDMARK}
        style={{ position: 'absolute', bottom: insets.bottom + 28, width: WORDMARK_W, height: WORDMARK_W * (90 / 451) }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
});
