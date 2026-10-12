import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect } from 'react';
import type { ColorValue } from 'react-native';
import { resumeJobs } from '../../lib/jobs';
import { tabBarStyle } from '../../components/tabBar';
import { theme } from '../../lib/theme';

const icon = (name: SymbolViewProps['name']) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <SymbolView name={name} tintColor={color} size={22} />;
  };

export default function TabLayout() {
  useEffect(resumeJobs, []);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: '#8A94A6',
        tabBarStyle,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Create', tabBarIcon: icon('camera.fill') }} />
      <Tabs.Screen name="cuts" options={{ title: 'Cuts', tabBarIcon: icon('film.stack') }} />
      <Tabs.Screen name="batch" options={{ title: 'Batch', tabBarIcon: icon('square.stack.3d.down.right.fill') }} />
      <Tabs.Screen name="you" options={{ title: 'You', tabBarIcon: icon('person.fill') }} />
    </Tabs>
  );
}
