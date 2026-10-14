import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { PillTabBar } from '../../components/PillTabBar';
import { resumeJobs } from '../../lib/jobs';

export default function TabLayout() {
  useEffect(resumeJobs, []);
  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Screens fade into each other instead of swapping in a single frame.
        animation: 'fade',
        transitionSpec: { animation: 'timing', config: { duration: 200 } },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Create' }} />
      <Tabs.Screen name="cuts" options={{ title: 'Cuts' }} />
      <Tabs.Screen name="batch" options={{ title: 'Batch' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
    </Tabs>
  );
}
