import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { theme } from '../../lib/theme';

const icon = (name: SymbolViewProps['name']) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <SymbolView name={name} tintColor={color} size={24} />;
  };

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: theme.accent }}>
      <Tabs.Screen name="index" options={{ title: 'Create', tabBarIcon: icon('camera.fill') }} />
      <Tabs.Screen name="cuts" options={{ title: 'Cuts', tabBarIcon: icon('film.stack') }} />
      <Tabs.Screen name="you" options={{ title: 'You', tabBarIcon: icon('person.fill') }} />
    </Tabs>
  );
}
