import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../lib/theme';

/** Soft blue-to-lilac backdrop used across sign-in and onboarding. */
export function Backdrop({ children, scroll = true, footer }: { children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <LinearGradient colors={['#E3EDFF', '#F7F9FF', '#EEEAFE']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, paddingTop: insets.top + 12, paddingHorizontal: 22 }}>{children}</View>
        )}
        {footer && <View style={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 12, gap: 10 }}>{footer}</View>}
      </KeyboardAvoidingView>
    </View>
  );
}

export function Logo({ size = 56 }: { size?: number }) {
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <SymbolView name="scissors" tintColor="#fff" size={size * 0.48} weight="bold" />
    </View>
  );
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

export function Button({ title, onPress, kind = 'primary', disabled, loading, icon, style }: ButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && styles.primary,
        kind === 'primary' && off && styles.primaryOff,
        kind === 'outline' && styles.outline,
        kind === 'text' && styles.textButton,
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? '#fff' : theme.accent} />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonText, kind === 'primary' ? { color: '#fff' } : kind === 'outline' ? { color: theme.ink } : { color: theme.accent }]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
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
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          style={[styles.segment, o.value === value && styles.segmentOn]}
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

/** Back chevron + thin progress bar across the top of onboarding. */
export function StepHeader({ step, of, canGoBack = true }: { step: number; of: number; canGoBack?: boolean }) {
  return (
    <View style={styles.stepHeader}>
      <Pressable
        onPress={() => router.back()}
        disabled={!canGoBack}
        hitSlop={12}
        accessibilityLabel="Back"
        style={{ width: 28, opacity: canGoBack ? 1 : 0 }}
      >
        <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
      </Pressable>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${(step / of) * 100}%` }]} />
      </View>
      <View style={{ width: 28 }} />
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

const styles = StyleSheet.create({
  logo: { backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 50, borderRadius: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primary: { backgroundColor: theme.accent },
  primaryOff: { backgroundColor: '#A9C8F8' },
  outline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D5DBE5' },
  textButton: { minHeight: 36 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, color: theme.muted, fontWeight: '500' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#D5DBE5', borderRadius: 12, paddingHorizontal: 14 },
  prefix: { fontSize: 16, color: theme.faint, marginRight: 4 },
  input: { flex: 1, fontSize: 16, color: theme.ink, paddingVertical: 13 },
  segmented: { flexDirection: 'row', backgroundColor: 'rgba(118,128,150,0.14)', borderRadius: 12, padding: 3 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segmentOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontSize: 14, fontWeight: '600', color: theme.muted },
  segmentBadge: { fontSize: 12, color: theme.accent, fontWeight: '700' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28, height: 32 },
  progress: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(61,133,245,0.18)', overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: theme.accent },
  error: { fontSize: 14, color: '#D93B3B', lineHeight: 20 },
});
