import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming, type AnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

/** A plain white screen with an optional footer pinned above the home indicator; a centred column on iPad. */
export function Backdrop({ children, scroll = true, footer }: { children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
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

const MARK = require('../../assets/logo-mark.png');

/** The Autocut mark (two trim handles with a cut between them) on its dark tile. */
export function Logo({ size = 56 }: { size?: number }) {
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size * 0.225 }]}>
      <Image source={MARK} style={{ width: size, height: size }} accessibilityLabel="Autocut" />
    </View>
  );
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

/** Full-width pill. Primary is near-black and greys out until it can be used. */
export function Button({ title, onPress, kind = 'primary', disabled, loading, icon, style }: ButtonProps) {
  const off = disabled || loading;
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
          <Text style={[styles.buttonText, kind === 'primary' ? { color: '#fff' } : kind === 'outline' ? { color: theme.ink } : { color: theme.muted, fontWeight: '500' }]}>
            {title}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

/** A tappable grey card with an optional icon and a radio (single choice) or check (multi). */
export function Option({ label, detail, icon, selected, onPress, multi }: { label: string; detail?: string; icon?: SymbolName; selected: boolean; onPress: () => void; multi?: boolean }) {
  // The card fills in dark (and back) over a moment rather than flipping.
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: 180, easing: EASE_OUT });
  }, [selected, on]);
  const fill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.value, [0, 1], [theme.card, theme.ink]) }));
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      scaleTo={0.98}
      style={[styles.option, fill]}
    >
      {icon && (
        <View style={[styles.optionIcon, selected && { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <SymbolView name={icon} tintColor={selected ? '#fff' : theme.ink} size={17} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, selected && { color: '#fff' }]}>{label}</Text>
        {detail && <Text style={[styles.optionDetail, selected && { color: 'rgba(255,255,255,0.7)' }]}>{detail}</Text>}
      </View>
      <View style={[styles.radio, multi && { borderRadius: 6 }, selected && styles.radioOn]}>
        {selected && <SymbolView name="checkmark" tintColor={theme.ink} size={11} weight="bold" />}
      </View>
    </PressableScale>
  );
}

export function Field({ label, prefix, ...input }: TextInputProps & { label?: string; prefix?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputWrap}>
        {prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput placeholderTextColor={theme.faint} style={styles.input} {...input} />
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
          <Text style={[styles.segmentText, o.value === value && { color: theme.ink }]}>
            {o.label}
            {o.badge && <Text style={styles.segmentBadge}>{`  ${o.badge}`}</Text>}
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
  return (
    <View style={{ gap: 8, marginBottom: 26 }}>
      <Text style={styles.title}>{children}</Text>
      {sub && <Text style={styles.sub}>{sub}</Text>}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

const styles = StyleSheet.create({
  logo: { backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  button: { minHeight: 56, borderRadius: 28, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  primary: { backgroundColor: theme.ink },
  primaryOff: { backgroundColor: theme.disabled },
  outline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E3E8' },
  textButton: { minHeight: 40 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16 },
  optionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  optionLabel: { fontSize: 16, fontWeight: '600', color: theme.ink },
  optionDetail: { fontSize: 13, color: theme.muted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#D1D1D6', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: '#fff', borderColor: '#fff' },
  label: { fontSize: 13, color: theme.muted, fontWeight: '500' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, paddingHorizontal: 16 },
  prefix: { fontSize: 17, color: theme.faint, marginRight: 4 },
  input: { flex: 1, fontSize: 17, color: theme.ink, paddingVertical: 16 },
  segmented: { flexDirection: 'row', backgroundColor: theme.card, borderRadius: 999, padding: 4 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  thumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontSize: 14, fontWeight: '600', color: theme.muted },
  segmentBadge: { fontSize: 12, color: theme.ok, fontWeight: '700' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24, height: 40 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  progress: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden', marginRight: 8 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: theme.ink },
  title: { fontSize: 30, fontWeight: '700', color: theme.ink, letterSpacing: -0.6, lineHeight: 36 },
  sub: { fontSize: 15, color: theme.muted, lineHeight: 21 },
  error: { fontSize: 14, color: theme.danger, lineHeight: 20 },
});
