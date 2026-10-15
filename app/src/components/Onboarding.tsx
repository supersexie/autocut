import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo, PressableScale, type SymbolName } from './ui';
import { BRAND_FONT } from '../lib/fonts';
import { column, theme } from '../lib/theme';

/** The soft grey wash behind every setup screen (CutAI's blue, in Cal AI greys). */
const WASH = ['#FAFAFB', '#ECECEF', '#DCDCE1'] as const;

/** A highlighted word in a title ("Pro fits how you post.", "15 months"). */
export const HIGHLIGHT = '#8E8E95';

/** A setup screen: grey wash, the header, scrolling content and a footer above the home indicator. */
export function OnbScreen({ header, children, footer, scroll = true }: { header: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: WASH[1] }}>
      <LinearGradient colors={WASH} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 22 }}>
        <View style={column()}>{header}</View>
      </View>
      {scroll ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
          <View style={[column(), { flexGrow: 1 }]}>{children}</View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 22 }}>
          <View style={[column(), { flex: 1 }]}>{children}</View>
        </View>
      )}
      {footer && (
        <View style={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 10, paddingTop: 8 }}>
          <View style={[column(), { gap: 10 }]}>{footer}</View>
        </View>
      )}
    </View>
  );
}

/** Back (round, hidden on the first step), the logo in the middle, an optional link on the right, and the step bar under them. */
export function OnbHeader({ step, steps, onBack, right }: { step: number; steps: number; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={{ marginBottom: 26 }}>
      <View style={styles.headRow}>
        <View style={styles.side}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back" style={styles.back}>
              <SymbolView name="chevron.left" tintColor={theme.ink} size={16} weight="semibold" />
            </Pressable>
          )}
        </View>
        <View style={styles.brand}>
          <Logo size={24} />
          <Text style={styles.brandText}>Autocut</Text>
        </View>
        <View style={[styles.side, { alignItems: 'flex-end' }]}>{right}</View>
      </View>
      <View style={styles.segments}>
        {Array.from({ length: steps }, (_, i) => (
          <Segment key={i} on={i <= step} />
        ))}
      </View>
    </View>
  );
}

function Segment({ on }: { on: boolean }) {
  const fill = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(on ? 1 : 0, { duration: 320 });
  }, [on, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, style]} />
    </View>
  );
}

export function OnbTitle({ children, sub, center }: { children: ReactNode; sub?: string; center?: boolean }) {
  return (
    <View style={{ gap: 6, marginBottom: 24 }}>
      <Text style={[styles.title, center && { textAlign: 'center' }]}>{children}</Text>
      {sub && <Text style={[styles.sub, center && { textAlign: 'center' }]}>{sub}</Text>}
    </View>
  );
}

/**
 * One answer: a white card with an icon tile. Picked, it takes a dark outline, a dark icon tile and a
 * check. Cards slide in one after another when the question appears.
 */
export function Choice({ label, icon, bars, selected, onPress, index }: { label: string; icon?: SymbolName; bars?: number; selected: boolean; onPress: () => void; index: number }) {
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: 160 });
  }, [selected, on]);
  const card = useAnimatedStyle(() => ({ borderColor: interpolateColor(on.value, [0, 1], ['rgba(17,17,20,0)', theme.ink]) }));
  return (
    <Animated.View entering={FadeInDown.delay(60 + index * 55).duration(320)}>
      <PressableScale onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} scaleTo={0.98} style={[styles.choice, card]}>
        <View style={[styles.tile, selected && { backgroundColor: theme.ink }]}>
          {bars != null ? <Bars level={bars} on={selected} /> : icon && <SymbolView name={icon} tintColor={selected ? '#fff' : theme.ink} size={18} />}
        </View>
        <Text style={styles.choiceLabel}>{label}</Text>
        {selected && <SymbolView name="checkmark" tintColor={theme.ink} size={15} weight="semibold" />}
      </PressableScale>
    </Animated.View>
  );
}

/** A signal-strength icon: more bars lit for a bigger bill. */
function Bars({ level, on }: { level: number; on: boolean }) {
  const lit = on ? '#fff' : theme.ink;
  const dim = on ? 'rgba(255,255,255,0.3)' : 'rgba(17,17,20,0.18)';
  return (
    <View style={styles.bars}>
      {[1, 2, 3, 4, 5].map((b) => (
        <View key={b} style={[styles.bar, { height: 3 + b * 3, backgroundColor: b <= level ? lit : dim }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', height: 48 },
  side: { width: 80 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(17,17,20,0.06)', alignItems: 'center', justifyContent: 'center' },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  brandText: { fontSize: 21, fontFamily: BRAND_FONT, color: theme.ink, letterSpacing: -0.4 },
  segments: { flexDirection: 'row', gap: 6, marginTop: 10 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(17,17,20,0.1)', overflow: 'hidden' },
  segmentFill: { height: 5, borderRadius: 3, backgroundColor: theme.ink },
  title: { fontSize: 32, fontWeight: '800', color: theme.ink, letterSpacing: -1, lineHeight: 37 },
  sub: { fontSize: 16, color: theme.muted },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 13,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  tile: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#F1F1F4', alignItems: 'center', justifyContent: 'center' },
  choiceLabel: { flex: 1, fontSize: 17, fontWeight: '600', color: theme.ink, letterSpacing: -0.2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 },
  bar: { width: 3.5, borderRadius: 1.5 },
});
