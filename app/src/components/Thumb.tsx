import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

const cache = new Map<string, string>();

/** After the thumbnail files are deleted (Settings › Cache), make them again when next shown. */
export const forgetThumbnails = () => cache.clear();

/** A still frame from a local video, generated once and cached for the session. */
export function useThumbnail(uri: string | undefined, seconds = 0.3) {
  const key = uri ? `${uri}@${seconds.toFixed(2)}` : '';
  const [thumb, setThumb] = useState<string | undefined>(() => cache.get(key));
  useEffect(() => {
    if (!uri || cache.has(key)) return;
    let alive = true;
    VideoThumbnails.getThumbnailAsync(uri, { time: Math.round(seconds * 1000), quality: 0.6 })
      .then((t) => {
        cache.set(key, t.uri);
        if (alive) setThumb(t.uri);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri, key, seconds]);
  return uri ? (thumb ?? cache.get(key)) : undefined;
}

export function Thumb({ uri, seconds, style, children, flip }: { uri?: string; seconds?: number; style?: StyleProp<ViewStyle>; children?: ReactNode; flip?: boolean }) {
  const thumb = useThumbnail(uri, seconds);
  // Frames made while this is on screen fade in; ones already made just appear.
  const [fresh] = useState(() => !thumb);
  return (
    <View style={[styles.box, style]}>
      {thumb && (
        <Animated.Image
          entering={fresh ? FadeIn.duration(220) : undefined}
          source={{ uri: thumb }}
          style={[StyleSheet.absoluteFill, flip && { transform: [{ scaleX: -1 }] }]}
          resizeMode="cover"
        />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ box: { backgroundColor: '#ECECEF', overflow: 'hidden' } });
