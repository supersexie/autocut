import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { Platform, type ViewProps } from 'react-native';

/** A clip's colour grade: its LUT file (Float32 RGBA, size³) and effects, 0..1 (src/lib/gradeFiles.ts). */
export type CompositionGrade = { lut: string; size: number; sharpen: number; clarity: number; vignette: number; grain: number };
export type CompositionClip = { start: number; end: number; speed: number; volume: number; grade?: CompositionGrade };

export type CompositionPlayerProps = ViewProps & {
  /** file:// URI of the source video. */
  source: string;
  clips: CompositionClip[];
  muted?: boolean;
  /** Output time while playing, about 30 times a second. */
  onTime?: (e: { nativeEvent: { time: number } }) => void;
  onPlayingChange?: (e: { nativeEvent: { playing: boolean } }) => void;
  /** Reached the end; the player has gone back to the start. */
  onEnd?: () => void;
};

export type CompositionPlayerHandle = {
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Jump to an output time, in seconds. */
  seek(time: number): Promise<void>;
};

/**
 * True in builds that include the native player (development and App Store builds).
 * Expo Go doesn't have it, so the editor falls back to two expo-video players in relay.
 */
export const hasCompositionPlayer = Platform.OS === 'ios' && requireOptionalNativeModule('AutocutPlayer') != null;

export const CompositionPlayer = hasCompositionPlayer
  ? requireNativeView<CompositionPlayerProps & { ref?: React.Ref<CompositionPlayerHandle> }>('AutocutPlayer')
  : null;
