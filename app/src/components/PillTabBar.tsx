import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { theme } from '../lib/theme';
import { TAB_BAR_HEIGHT, tabBarStyle } from './tabBar';
import type { SymbolName } from './ui';
import { JAKARTA } from '../lib/fonts';

type Props = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Each tab's symbol, by route name. */
export const TAB_ICONS: Record<string, SymbolName> = {
  index: 'camera.fill',
  cuts: 'film.stack',
  batch: 'square.stack.3d.down.right.fill',
  you: 'person.fill',
};

const EASE = Easing.out(Easing.cubic);
const PAD = 6;

/**
 * The floating tab bar: a highlight slides to the tab you pick, the bar turns dark over the
 * camera and light everywhere else, and it slides away while a take is being recorded. All of
 * it animates on the UI thread, so switching tabs feels smooth.
 */
export function PillTabBar({ state, descriptors, navigation }: Props) {
  const { width } = useWindowDimensions();
  const frame = tabBarStyle(width);
  const [barWidth, setBarWidth] = useState(0);
  const route = state.routes[state.index];
  const overCamera = route.name === 'index';
  const hidden = (descriptors[route.key].options.tabBarStyle as { display?: string } | undefined)?.display === 'none';

  const at = useSharedValue(state.index);
  const dark = useSharedValue(overCamera ? 1 : 0);
  const away = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    at.value = withTiming(state.index, { duration: 280, easing: EASE });
    dark.value = withTiming(overCamera ? 1 : 0, { duration: 260, easing: EASE });
  }, [state.index, overCamera, at, dark]);
  useEffect(() => {
    away.value = withTiming(hidden ? 1 : 0, { duration: 240, easing: EASE });
  }, [hidden, away]);

  const slot = barWidth ? (barWidth - PAD * 2) / state.routes.length : 0;
  const bar = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(dark.value, [0, 1], ['rgba(255,255,255,0.96)', 'rgba(28,28,30,0.94)']),
    transform: [{ translateY: away.value * (TAB_BAR_HEIGHT + 40) }],
    opacity: 1 - away.value,
  }));
  const pill = useAnimatedStyle(() => ({
    width: slot,
    transform: [{ translateX: PAD + at.value * slot }],
    backgroundColor: interpolateColor(dark.value, [0, 1], [theme.line, 'rgba(255,255,255,0.14)']),
  }));

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'auto'}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      style={[styles.bar, { bottom: frame.bottom, left: frame.marginHorizontal, right: frame.marginHorizontal }, bar]}
    >
      {slot > 0 && <Animated.View style={[styles.pill, pill]} />}
      {state.routes.map((r, i) => {
        const focused = i === state.index;
        const { options } = descriptors[r.key];
        const color = focused ? (overCamera ? '#fff' : theme.ink) : overCamera ? 'rgba(255,255,255,0.55)' : '#8A94A6';
        const label = typeof options.title === 'string' ? options.title : r.name;
        return (
          <Pressable
            key={r.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                Haptics.selectionAsync();
                navigation.navigate(r.name, r.params);
              }
            }}
            style={styles.tab}
          >
            <SymbolView name={TAB_ICONS[r.name] ?? 'circle'} tintColor={color} size={22} />
            <Animated.Text style={[styles.label, { color }]}>{label}</Animated.Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', height: TAB_BAR_HEIGHT, borderRadius: 32, flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD,
    shadowColor: '#14284f', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  pill: { position: 'absolute', left: 0, top: PAD, bottom: PAD, borderRadius: 26 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, height: '100%' },
  label: { fontSize: 10, fontFamily: JAKARTA.semibold },
});
