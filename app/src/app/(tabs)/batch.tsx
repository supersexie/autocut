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
import { coverSource } from '../../lib/edit';
import { startCut } from '../../lib/jobs';
import { BATCH } from '../../lib/plans';
import { askToUpgrade, useUsage } from '../../lib/usage';
import { cutFile, cutProgress, cutStatus, useCuts, type CutRecord } from '../../lib/store';
import { COLUMN, theme } from '../../lib/theme';

const MAX = 10;

export default function BatchScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cuts = useCuts();
  const usage = useUsage();
  const locked = !usage.allows(BATCH);
  const [started, setStarted] = useState<string[]>([]);
  const batch = started.map((id) => cuts.find((c) => c.id === id)).filter((c): c is CutRecord => !!c);
  const ready = batch.filter((c) => c.status === 'ready').length;
  const busy = batch.some((c) => c.status === 'uploading' || c.status === 'processing');

  async function pick() {
    if (locked) return askToUpgrade('Batch cuts are on Pro and Ultimate', `You're on ${usage.plan.name}. Upgrade to cut up to ${MAX} videos at once.`);
    if (!usage.left) return usage.room(1);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: true, selectionLimit: Math.min(MAX, usage.left), quality: 1 });
    if (result.canceled || !result.assets.length) return;
    const fits = usage.room(result.assets.length); // says so if only some fit
    const language = 'en';
    const ids = result.assets.slice(0, Math.min(MAX, fits)).map((a) =>
      startCut([{ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }], language, { batch: true })
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
          {locked && (
            <View style={styles.lockPill}>
              <SymbolView name="lock.fill" tintColor={theme.ink} size={12} />
              <Text style={styles.lockText}>Pro and Ultimate</Text>
            </View>
          )}
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
        <Button title={locked ? 'See plans' : batch.length ? 'Start another batch' : 'Start a batch'} onPress={locked ? () => router.push('/change-plan') : pick} />
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
      <Thumb uri={uri} seconds={cut.edit ? coverSource(cut.edit) : (cut.clips[0]?.[0] ?? 0) + 0.3} style={styles.thumb} />
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
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  lockText: { fontSize: 13, fontWeight: '700', color: theme.ink },
  summary: { fontSize: 13, color: theme.muted, marginBottom: 10, marginLeft: 4, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  thumb: { width: 40, height: 60, borderRadius: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: theme.ink },
  rowStatus: { fontSize: 13, color: theme.muted, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden', marginTop: 3 },
  fill: { height: 3, borderRadius: 2, backgroundColor: theme.ink },
});
