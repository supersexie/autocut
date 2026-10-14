import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../../components/list';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { Thumb } from '../../components/Thumb';
import { Button } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { startCut } from '../../lib/jobs';
import { cutFile, cutProgress, cutStatus, useCuts, type CutRecord } from '../../lib/store';
import { COLUMN, theme } from '../../lib/theme';

const MAX = 10;

export default function BatchScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { account } = useAuth();
  const cuts = useCuts();
  const [started, setStarted] = useState<string[]>([]);
  const batch = started.map((id) => cuts.find((c) => c.id === id)).filter((c): c is CutRecord => !!c);
  const ready = batch.filter((c) => c.status === 'ready').length;
  const busy = batch.some((c) => c.status === 'uploading' || c.status === 'processing');

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: true, selectionLimit: MAX, quality: 1 });
    if (result.canceled || !result.assets.length) return;
    const language = account?.profile.language ?? 'en';
    const ids = result.assets.slice(0, MAX).map((a) =>
      startCut([{ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }], language)
    );
    setStarted(ids);
  }

  const side = Math.max(18, (width - COLUMN) / 2);
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: TAB_BAR_HEIGHT + 44 }]}>
      <Text style={[styles.h1, { marginHorizontal: side }]}>Batch</Text>
      {batch.length === 0 ? (
        <View style={[styles.center, { marginHorizontal: side }]}>
          <View style={styles.icon}>
            <SymbolView name="square.stack.3d.down.right" tintColor={theme.ink} size={28} />
          </View>
          <Text style={styles.title}>Cut up to {MAX} videos at once</Text>
          <Text style={styles.body}>Pick your videos and Autocut cuts them one after another. They land in Cuts when they’re ready.</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: side, paddingTop: 16, paddingBottom: 16 }}>
          <Text style={styles.summary}>
            {ready} of {batch.length} ready{busy ? ' · you can leave this screen' : ''}
          </Text>
          <Card>
            {batch.map((c, i) => (
              <BatchRow key={c.id} cut={c} n={i + 1} last={i === batch.length - 1} />
            ))}
          </Card>
        </ScrollView>
      )}
      <View style={{ marginHorizontal: side }}>
        <Button title={batch.length ? 'Start another batch' : 'Start a batch'} onPress={pick} />
      </View>
    </View>
  );
}

function BatchRow({ cut, n, last }: { cut: CutRecord; n: number; last: boolean }) {
  const ready = cut.status === 'ready';
  const failed = cut.status === 'failed';
  const uri = cut.source ? cutFile(cut.source).uri : cut.previewUri;
  return (
    <Pressable
      onPress={() => router.push({ pathname: ready ? '/edit/[id]' : '/cut/[id]', params: { id: cut.id } })}
      style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && { backgroundColor: theme.card }]}
    >
      <Thumb uri={uri} seconds={(cut.clips[0]?.[0] ?? 0) + 0.3} style={styles.thumb} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {ready ? cut.title : `Video ${n}`}
        </Text>
        <Text style={[styles.rowStatus, failed && { color: theme.danger }]} numberOfLines={1}>
          {cutStatus(cut)}
        </Text>
        {!ready && !failed && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(3, Math.round(cutProgress(cut) * 100))}%` }]} />
          </View>
        )}
      </View>
      {ready ? (
        <SymbolView name="chevron.right" tintColor={theme.faint} size={12} weight="semibold" />
      ) : failed ? (
        <SymbolView name="exclamationmark.circle.fill" tintColor={theme.danger} size={18} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  h1: { fontSize: 34, fontWeight: '800', color: theme.ink, letterSpacing: -0.6, marginTop: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.3 },
  body: { fontSize: 15, color: theme.muted, textAlign: 'center', lineHeight: 21 },
  summary: { fontSize: 13, color: theme.muted, marginBottom: 10, marginLeft: 4, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  thumb: { width: 40, height: 60, borderRadius: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: theme.ink },
  rowStatus: { fontSize: 13, color: theme.muted, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden', marginTop: 3 },
  fill: { height: 3, borderRadius: 2, backgroundColor: theme.ink },
});
