import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from 'react-native-svg';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo, PreAppFont, PressableScale, SOFT_WASH, Wash, type SymbolName } from './ui';
import { BRAND_FONT, JAKARTA } from '../lib/fonts';
import { column, theme } from '../lib/theme';

/** The answers' icons, in CutAI's blue on a pale blue tile (white on the blue when picked). */
const ICON_BLUE = '#228BE5';
const ICON_TILE = '#E0EEFA';

/** A highlighted word in a title ("Pro fits how you post.", "50% of your day"). */
export const HIGHLIGHT = theme.blue;

/** A setup screen: the soft blue wash, the header, scrolling content and a footer above the home indicator. */
export function OnbScreen({ header, children, footer, scroll = true }: { header: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <PreAppFont>
    <View style={{ flex: 1, backgroundColor: SOFT_WASH[1] }}>
      <Wash soft />
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
    </PreAppFont>
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
 * One answer: a white card with its icon on a tile like the Autocut logo's. Picked, it takes an outline
 * like the logo's too (graphite, silver at two corners) and a check. Cards slide in one after another when the question appears.
 */
export function Choice({ label, icon, bars, selected, onPress, index }: { label: string; icon?: SymbolName; bars?: number; selected: boolean; onPress: () => void; index: number }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <Animated.View entering={FadeInDown.delay(60 + index * 55).duration(320)} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <PressableScale onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} scaleTo={0.98} style={styles.choice}>
        {selected && size.w > 0 && <SilverOutline w={size.w} h={size.h} />}
        {bars != null ? (
          <View style={[styles.tile, selected && { backgroundColor: ICON_BLUE }]}>
            <Bars level={bars} on={selected} />
          </View>
        ) : (
          icon && <SilverTile icon={icon} />
        )}
        <Text style={styles.choiceLabel}>{label}</Text>
        {selected && <SymbolView name="checkmark" tintColor={GRAPHITE} size={15} weight="semibold" />}
      </PressableScale>
    </Animated.View>
  );
}

const GRAPHITE = '#1D1A23';

/** The picked answer's outline, like the logo: graphite, with silver catching the top-left and bottom-right corners. */
function SilverOutline({ w, h }: { w: number; h: number }) {
  return (
    // Drawn over the card's own (clear) border, so it lines up with the card's edge.
    <Animated.View entering={FadeIn.duration(160)} pointerEvents="none" style={{ position: 'absolute', top: -1.5, left: -1.5, width: w, height: h }}>
      <Svg width={w} height={h}>
        <Defs>
          <SvgGradient id="edge" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#A9A9B4" />
            <Stop offset="0.16" stopColor={GRAPHITE} />
            <Stop offset="0.84" stopColor={GRAPHITE} />
            <Stop offset="1" stopColor="#9A9AA5" />
          </SvgGradient>
        </Defs>
        <Rect x={1} y={1} width={w - 2} height={h - 2} rx={15} fill="none" stroke="url(#edge)" strokeWidth={2} />
      </Svg>
    </Animated.View>
  );
}

const TILE = 38;

/**
 * An answer's icon on a tile like the Autocut logo: the dark #1D1A23 tile, faded silver on the
 * top-left and bottom-right corners, and the white icon shading to soft grey towards the bottom right
 * (a soft shade over the tile, since symbols take one colour).
 */
function SilverTile({ icon }: { icon: SymbolName }) {
  return (
    <View style={styles.silverTile}>
      <SymbolView name={icon} tintColor="#FFFFFF" size={18} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(29,26,35,0)', 'rgba(29,26,35,0)', 'rgba(29,26,35,0.42)']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.2, y: 0.1 }}
        end={{ x: 0.85, y: 0.95 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg pointerEvents="none" width={TILE} height={TILE} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="rim" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
            <Stop offset="0.32" stopColor="#B9B9C2" stopOpacity="0" />
            <Stop offset="0.68" stopColor="#B9B9C2" stopOpacity="0" />
            <Stop offset="1" stopColor="#E6E6EC" stopOpacity="0.85" />
          </SvgGradient>
        </Defs>
        <Rect x={0.75} y={0.75} width={TILE - 1.5} height={TILE - 1.5} rx={10.25} fill="none" stroke="url(#rim)" strokeWidth={1.5} />
      </Svg>
    </View>
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

const KNOB = 30;

/**
 * A slider that snaps to `stops` places, like CutAI's: a dotted track, filled in blue up to a white
 * knob. Drag anywhere on it or tap a spot; each new stop gives a light tick.
 */
export function StepSlider({ stops, index, onChange, left, right }: { stops: number; index: number; onChange: (i: number) => void; left: string; right: string }) {
  const [w, setW] = useState(0);
  const usable = Math.max(1, w - KNOB);
  const move = (x: number) => {
    const i = Math.round(Math.max(0, Math.min(1, (x - KNOB / 2) / usable)) * (stops - 1));
    if (i !== index) {
      Haptics.selectionAsync();
      onChange(i);
    }
  };
  // On the JS thread: it only sets state, a few times per drag.
  const drag = Gesture.Pan().runOnJS(true).minDistance(0).onBegin((e) => move(e.x)).onUpdate((e) => move(e.x));
  const knobX = (index / (stops - 1)) * usable;
  return (
    <View>
      <GestureDetector gesture={drag}>
        <View
          style={styles.track}
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onChange(Math.max(0, Math.min(stops - 1, index + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
        >
          <View pointerEvents="none" style={[styles.rail, { left: KNOB / 2, right: KNOB / 2 }]}>
            <View style={[styles.railFill, { width: w ? knobX : 0 }]} />
            {w > 0 &&
              Array.from({ length: stops }, (_, i) => (
                <View key={i} style={[styles.tick, { left: (i / (stops - 1)) * usable - 2, backgroundColor: i <= index ? '#fff' : 'rgba(17,17,20,0.18)' }]} />
              ))}
          </View>
          {w > 0 && <View pointerEvents="none" style={[styles.knob, { left: knobX }]} />}
        </View>
      </GestureDetector>
      <View style={styles.ends}>
        <Text style={styles.end}>{left}</Text>
        <Text style={styles.end}>{right}</Text>
      </View>
    </View>
  );
}

/** A short, true note under a question, where CutAI shows a review (Autocut has none to show yet). */
export function Tip({ icon, children }: { icon: SymbolName; children: ReactNode }) {
  return (
    <View style={styles.tipCard}>
      <View style={styles.tipIcon}>
        <SymbolView name={icon} tintColor={theme.blue} size={15} />
      </View>
      <Text style={styles.tipText}>{children}</Text>
    </View>
  );
}

/** The white card a setup screen's numbers sit on. */
export const onbCard = {
  backgroundColor: '#fff', borderRadius: 20, padding: 18,
  shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
} as const;

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', height: 48 },
  side: { width: 80 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(17,17,20,0.06)', alignItems: 'center', justifyContent: 'center' },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  brandText: { fontSize: 21, fontFamily: BRAND_FONT, color: theme.ink, letterSpacing: -0.4 },
  segments: { flexDirection: 'row', gap: 6, marginTop: 10 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(17,17,20,0.1)', overflow: 'hidden' },
  segmentFill: { height: 5, borderRadius: 3, backgroundColor: theme.ink },
  title: { fontSize: 32, fontFamily: JAKARTA.bold, color: theme.ink, letterSpacing: -0.9, lineHeight: 38 },
  sub: { fontSize: 16, fontFamily: JAKARTA.medium, color: theme.muted },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: 14, paddingVertical: 13,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  tile: { width: 38, height: 38, borderRadius: 11, backgroundColor: ICON_TILE, alignItems: 'center', justifyContent: 'center' },
  choiceLabel: { flex: 1, fontSize: 17, fontFamily: JAKARTA.bold, color: theme.ink, letterSpacing: -0.2 },
  silverTile: { width: TILE, height: TILE, borderRadius: 11, backgroundColor: '#1D1A23', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 },
  bar: { width: 3.5, borderRadius: 1.5 },
  track: { height: KNOB + 8, justifyContent: 'center' },
  rail: { position: 'absolute', height: 8, borderRadius: 4, backgroundColor: '#EEF0F6', top: (KNOB + 8) / 2 - 4 },
  railFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: theme.blue },
  tick: { position: 'absolute', top: 2, width: 4, height: 4, borderRadius: 2 },
  knob: {
    position: 'absolute', top: 4, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(17,17,20,0.08)',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  end: { fontSize: 12, fontFamily: JAKARTA.medium, color: theme.muted },
  tipCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 16, padding: 14, marginTop: 16,
  },
  tipIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(61,107,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, fontSize: 14, fontFamily: JAKARTA.medium, lineHeight: 19, color: theme.ink },
});
