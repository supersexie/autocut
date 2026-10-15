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
        // No fade between tabs: started while the editor (a full-screen cover) was closing, it could
        // get stuck, leaving the tab blank.
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Create' }} />
      <Tabs.Screen name="cuts" options={{ title: 'Cuts' }} />
      <Tabs.Screen name="batch" options={{ title: 'Batch' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
    </Tabs>
  );
}
