import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type AnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgLinear, RadialGradient, Rect, Stop as SvgStop } from 'react-native-svg';
import { JAKARTA } from '../lib/fonts';
import { column, theme } from '../lib/theme';

export type SymbolName = ComponentProps<typeof SymbolView>['name'];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const EASE_OUT = Easing.out(Easing.cubic);

/**
 * A Pressable that eases down a touch when pressed and eases back when let go, on the UI thread,
 * so taps feel soft instead of snapping. Use it for anything tappable that isn't a list row.
 */
export function PressableScale({ scaleTo = 0.97, style, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & { scaleTo?: number; style?: StyleProp<AnimatedStyle<ViewStyle>> }) {
  const pressed = useSharedValue(0);
  const feel = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }],
    opacity: 1 - 0.12 * pressed.value,
  }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: 90, easing: EASE_OUT });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: 180, easing: EASE_OUT });
        onPressOut?.(e);
      }}
      style={[style, feel]}
    />
  );
}

/** The soft blue wash behind the app's screens: the same tint as the website's hero panel. */
export const WASH = ['#E3E8FC', '#EBEEFD', '#F2F4FE'] as const;

/** A paler blue for the welcome and setup screens, where the video and numbers should lead. */
export const SOFT_WASH = ['#F0F3FE', '#F4F6FF', '#F8F9FF'] as const;

/**
 * The wash, filling its parent. Put it first inside a screen's root view. Drawn like the website's hero
 * panel (site/index.html, .hero::before): the blue running top to bottom, a white glow up on the left
 * and a smaller one down on the right, and a touch of lavender at the top right. `soft`: the paler
 * blue, for onboarding.
 */
export function Wash({ soft = false }: { soft?: boolean }) {
  const [top, mid, bottom] = soft ? SOFT_WASH : WASH;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <SvgLinear id="washBase" x1="0" y1="0" x2="0" y2="1">
            <SvgStop offset="0" stopColor={top} />
            <SvgStop offset="0.55" stopColor={mid} />
            <SvgStop offset="1" stopColor={bottom} />
          </SvgLinear>
          <RadialGradient id="washGlowA" cx="18%" cy="28%" rx="55%" ry="45%" fx="18%" fy="28%">
            <SvgStop offset="0" stopColor="#FFFFFF" stopOpacity={0.75} />
            <SvgStop offset="0.7" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="washGlowB" cx="82%" cy="72%" rx="45%" ry="40%" fx="82%" fy="72%">
            <SvgStop offset="0" stopColor="#FFFFFF" stopOpacity={0.6} />
            <SvgStop offset="0.7" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="washLavender" cx="70%" cy="18%" rx="40%" ry="35%" fx="70%" fy="18%">
            <SvgStop offset="0" stopColor="#CDD6FA" stopOpacity={soft ? 0.3 : 0.55} />
            <SvgStop offset="0.7" stopColor="#CDD6FA" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#washBase)" />
        <Rect width="100%" height="100%" fill="url(#washGlowA)" />
        <Rect width="100%" height="100%" fill="url(#washGlowB)" />
        <Rect width="100%" height="100%" fill="url(#washLavender)" />
      </Svg>
    </View>
  );
}

/** A screen on the blue wash with an optional footer pinned above the home indicator; a centred column on iPad. */
export function Backdrop({ children, scroll = true, footer }: { children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: WASH[1] }}>
      <Wash />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 10, paddingHorizontal: 22, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[column(), { flexGrow: 1 }]}>{children}</View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, paddingTop: insets.top + 10, paddingHorizontal: 22 }}>
            <View style={[column(), { flex: 1 }]}>{children}</View>
          </View>
        )}
        {footer && (
          <View style={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 10, paddingTop: 8 }}>
            <View style={[column(), { gap: 10 }]}>{footer}</View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const TILE = require('../../assets/logo-tile.png');

/** The Autocut logo: the mark (two trim handles with a cut between them) on its silver-edged dark tile. */
export function Logo({ size = 56 }: { size?: number }) {
  return <Image source={TILE} style={{ width: size, height: size }} accessibilityLabel="Autocut" />;
}

const GOOGLE = require('../../assets/google-logo.png');
const APPLE = require('../../assets/apple-logo.png');

/** The sign-in providers' own marks, for the Continue with… buttons. */
export function GoogleLogo({ size = 19 }: { size?: number }) {
  return <Image source={GOOGLE} style={{ width: size * (250 / 256), height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

export function AppleLogo({ size = 19, color = '#fff' }: { size?: number; color?: string }) {
  return <Image source={APPLE} style={{ width: size, height: size, tintColor: color, marginTop: -2 }} resizeMode="contain" />;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'outline' | 'text';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// Text across the app is set in Plus Jakarta Sans (CutAI's typeface). The shared pieces below
// (buttons, fields, titles, segmented controls, errors) take it from here; <PreAppFont> is kept so a
// screen can still opt in explicitly, and it's on everywhere by default.
const PreApp = createContext(true);
export function PreAppFont({ children }: { children: ReactNode }) {
  return <PreApp.Provider value>{children}</PreApp.Provider>;
}
type Weight = keyof typeof JAKARTA;
/** The font for a weight, in Plus Jakarta Sans on the pre-app screens (nothing changes elsewhere). */
function useFace() {
  const on = useContext(PreApp);
  return (weight: Weight) => (on ? { fontFamily: JAKARTA[weight], fontWeight: 'normal' as const } : null);
}

/** Full-width pill. Primary is near-black and fades until it can be used. */
export function Button({ title, onPress, kind = 'primary', disabled, loading, icon, style }: ButtonProps) {
  const off = disabled || loading;
  const face = useFace();
  return (
    <PressableScale
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      scaleTo={0.98}
      style={[
        styles.button,
        kind === 'primary' && styles.primary,
        kind === 'primary' && disabled && styles.primaryOff,
        kind === 'outline' && styles.outline,
        kind === 'text' && styles.textButton,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? '#fff' : theme.ink} />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonText, kind === 'primary' ? { color: disabled ? 'rgba(255,255,255,0.55)' : '#fff' } : kind === 'outline' ? { color: theme.ink } : { color: theme.muted, fontFamily: JAKARTA.medium }, face(kind === 'text' ? 'medium' : 'bold')]}>
            {title}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

/** A tappable white card with a blue icon on a pale tile, and a radio (single choice) or check (multi). Picked: a thin light blue line and a blue radio. */
export function Option({ label, detail, icon, selected, onPress, multi }: { label: string; detail?: string; icon?: SymbolName; selected: boolean; onPress: () => void; multi?: boolean }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      scaleTo={0.98}
      style={[styles.option, selected && { borderColor: theme.blueLine }]}
    >
      {icon && (
        <View style={[styles.optionIcon, selected && { backgroundColor: theme.blueTileOn }]}>
          <SymbolView name={icon} tintColor={theme.blue} size={17} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel}>{label}</Text>
        {detail && <Text style={styles.optionDetail}>{detail}</Text>}
      </View>
      <View style={[styles.radio, multi && { borderRadius: 6 }, selected && styles.radioOn]}>
        {selected && <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />}
      </View>
    </PressableScale>
  );
}

export function Field({ label, prefix, ...input }: TextInputProps & { label?: string; prefix?: string }) {
  const face = useFace();
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={[styles.label, face('medium')]}>{label}</Text>}
      <View style={styles.inputWrap}>
        {prefix && <Text style={[styles.prefix, face('medium')]}>{prefix}</Text>}
        <TextInput placeholderTextColor={theme.faint} style={[styles.input, face('medium')]} {...input} />
      </View>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string; badge?: string }[]; value: T; onChange: (v: T) => void }) {
  // One white thumb that slides to the chosen segment.
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const at = useSharedValue(index);
  useEffect(() => {
    at.value = withTiming(index, { duration: 240, easing: EASE_OUT });
  }, [index, at]);
  const segment = (width - 8) / options.length;
  const thumb = useAnimatedStyle(() => ({ width: segment, transform: [{ translateX: at.value * segment }] }));
  const face = useFace();
  return (
    <View style={styles.segmented} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && <Animated.View style={[styles.thumb, thumb]} />}
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          style={styles.segment}
        >
          <Text style={[styles.segmentText, face('semibold'), o.value === value && { color: theme.ink }]}>
            {o.label}
            {o.badge && <Text style={[styles.segmentBadge, face('bold')]}>{`  ${o.badge}`}</Text>}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Round back button + thin progress line, as used across the setup questions. */
export function StepHeader({ progress, onBack, right }: { progress?: number; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.stepHeader}>
      <Pressable onPress={onBack ?? (() => router.back())} hitSlop={10} accessibilityLabel="Back" style={styles.back}>
        <SymbolView name="arrow.left" tintColor={theme.ink} size={15} weight="semibold" />
      </Pressable>
      {progress != null && (
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${Math.max(4, Math.min(100, progress * 100))}%` }]} />
        </View>
      )}
      {progress == null && <View style={{ flex: 1 }} />}
      {right}
    </View>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  const face = useFace();
  return (
    <View style={{ gap: 8, marginBottom: 26 }}>
      <Text style={[styles.title, face('bold')]}>{children}</Text>
      {sub && <Text style={[styles.sub, face('medium')]}>{sub}</Text>}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const face = useFace();
  return children ? <Text style={[styles.error, face('medium')]}>{children}</Text> : null;
}

const styles = StyleSheet.create({
  button: { minHeight: 56, borderRadius: 28, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  primary: { backgroundColor: theme.ink },
  primaryOff: { backgroundColor: 'rgba(17,17,20,0.8)' }, // near the same black, with a dimmed label, until it can be used (not a flat grey)
  outline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E3E8' },
  textButton: { minHeight: 40 },
  buttonText: { fontSize: 16, fontFamily: JAKARTA.semibold },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 16, paddingVertical: 16 },
  optionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.blueTile, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { fontSize: 16, fontFamily: JAKARTA.semibold, color: theme.ink },
  optionDetail: { fontSize: 13, fontFamily: JAKARTA.medium, color: theme.muted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#D1D1D6', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: theme.blue, borderColor: theme.blue },
  label: { fontSize: 13, color: theme.muted, fontFamily: JAKARTA.medium },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 16 },
  prefix: { fontSize: 17, fontFamily: JAKARTA.medium, color: theme.faint, marginRight: 4 },
  input: { flex: 1, fontSize: 17, fontFamily: JAKARTA.medium, color: theme.ink, paddingVertical: 16 },
  segmented: { flexDirection: 'row', backgroundColor: theme.card, borderRadius: 999, padding: 4 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  thumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontSize: 14, fontFamily: JAKARTA.semibold, color: theme.muted },
  segmentBadge: { fontSize: 12, color: theme.ok, fontFamily: JAKARTA.bold },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24, height: 40 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  progress: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden', marginRight: 8 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: theme.ink },
  title: { fontSize: 30, fontFamily: JAKARTA.bold, color: theme.ink, letterSpacing: -0.6, lineHeight: 36 },
  sub: { fontSize: 15, fontFamily: JAKARTA.medium, color: theme.muted, lineHeight: 21 },
  error: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.danger, lineHeight: 20 },
});
