import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { Button } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { startCut } from '../../lib/jobs';
import { useCuts } from '../../lib/store';
import { theme } from '../../lib/theme';

const MAX = 10;

export default function BatchScreen() {
  const insets = useSafeAreaInsets();
  const { account } = useAuth();
  const cuts = useCuts();
  const [started, setStarted] = useState<string[]>([]);
  const running = cuts.filter((c) => started.includes(c.id) && (c.status === 'uploading' || c.status === 'processing')).length;
  const finished = cuts.filter((c) => started.includes(c.id) && c.status === 'ready').length;

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: true, selectionLimit: MAX, quality: 1 });
    if (result.canceled || !result.assets.length) return;
    const language = account?.profile.language ?? 'en';
    const ids = result.assets.slice(0, MAX).map((a) =>
      startCut([{ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }], language)
    );
    setStarted(ids);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: TAB_BAR_HEIGHT + 44 }]}>
      <Text style={styles.h1}>Batch</Text>
      <View style={styles.center}>
        <SymbolView name="square.stack.3d.down.right" tintColor={theme.accent} size={40} />
        <Text style={styles.title}>Cut up to {MAX} videos at once</Text>
        <Text style={styles.body}>Pick your videos and Autocut cuts them one after another. They land in Cuts when they’re ready.</Text>
        {started.length > 0 && (
          <View style={styles.status}>
            <Text style={styles.statusText}>
              {running > 0 ? `${running} cutting · ` : ''}
              {finished} of {started.length} ready
            </Text>
            <Button kind="text" title="See them in Cuts" onPress={() => router.navigate('/cuts')} />
          </View>
        )}
      </View>
      <Button title={started.length ? 'Start another batch' : 'Start a batch'} onPress={pick} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 18 },
  h1: { fontSize: 32, fontWeight: '800', color: theme.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  title: { fontSize: 18, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  body: { fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20 },
  status: { marginTop: 16, alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 18 },
  statusText: { fontSize: 14, fontWeight: '600', color: theme.ink, fontVariant: ['tabular-nums'] },
});
