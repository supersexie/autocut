import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CuttingSettings } from '../components/CuttingSettings';
import { Wash } from '../components/ui';
import { theme } from '../lib/theme';
import { UI_FONT } from '../lib/fonts';

/** "More options" on the review screen: how this and later takes get cut. */
export default function CutOptions() {
  return (
    <View style={styles.sheet}>
      <Wash />
      <View style={styles.head}>
        <View style={{ width: 50 }} />
        <Text style={styles.title}>Cutting <Text style={{ color: theme.blue }}>options</Text></Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 50, alignItems: 'flex-end' }}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 18 }}>
        <CuttingSettings />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: theme.page },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 18 },
  title: { fontSize: 17, ...UI_FONT.semibold, color: theme.ink },
  done: { fontSize: 16, ...UI_FONT.bold, color: theme.ink },
});
