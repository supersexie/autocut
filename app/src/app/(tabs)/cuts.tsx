import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Thumb } from '../../components/Thumb';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { Button } from '../../components/ui';
import { editedDuration, cutFile, deleteCut, useCuts, type CutRecord } from '../../lib/store';
import { formatTime, theme } from '../../lib/theme';

export default function CutsScreen() {
  const cuts = useCuts();
  const insets = useSafeAreaInsets();
  const drafts = cuts.filter((c) => c.status !== 'ready');
  const done = cuts.filter((c) => c.status === 'ready');
  const attention = drafts.filter((c) => c.status === 'failed').length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: TAB_BAR_HEIGHT + 60, paddingHorizontal: 18 }}>
      <View style={styles.header}>
        <Text style={styles.h1}>Cuts</Text>
        <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel="Settings" style={styles.gear}>
          <SymbolView name="gearshape" tintColor={theme.ink} size={18} />
        </Pressable>
      </View>

      {cuts.length === 0 && (
        <View style={styles.empty}>
          <SymbolView name="film.stack" tintColor={theme.faint} size={40} />
          <Text style={styles.emptyBody}>Film or upload on the Create tab and your first cut will land here.</Text>
          <Button title="Start recording" onPress={() => router.navigate('/')} style={{ paddingHorizontal: 28 }} />
        </View>
      )}

      {drafts.length > 0 && (
        <>
          <Text style={styles.section}>
            Drafts {attention > 0 && <Text style={styles.attention}> · {attention} need{attention === 1 ? 's' : ''} attention</Text>}
          </Text>
          <Grid cuts={drafts} />
        </>
      )}
      {done.length > 0 && (
        <>
          <Text style={styles.section}>On this iPhone</Text>
          <Grid cuts={done} />
        </>
      )}
      {cuts.length > 0 && <Text style={styles.hint}>Tap to open · hold to delete</Text>}
    </ScrollView>
  );
}

function Grid({ cuts }: { cuts: CutRecord[] }) {
  return (
    <View style={styles.grid}>
      {cuts.map((c) => (
        <Card key={c.id} cut={c} />
      ))}
    </View>
  );
}

function Card({ cut }: { cut: CutRecord }) {
  const uri = cut.source ? cutFile(cut.source).uri : cut.previewUri;
  const flip = !cut.source && !!cut.previewFlip;
  const seconds = (cut.clips[0]?.[0] ?? 0) + 0.3;
  const open = () => router.push({ pathname: cut.status === 'ready' ? '/edit/[id]' : '/cut/[id]', params: { id: cut.id } });
  const remove = () =>
    Alert.alert('Delete this cut?', 'It is removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCut(cut.id) },
    ]);

  let status: string;
  if (cut.status === 'ready') status = `${formatTime(cut.duration)} → ${formatTime(editedDuration(cut))}`;
  else if (cut.status === 'failed') status = cut.error ?? "The edit didn't finish.";
  else if (cut.status === 'uploading') status = cut.stage === 'waiting' ? 'Waiting to upload' : `Uploading ${Math.round(cut.progress * 100)}%`;
  else if (cut.stage === 'queued') status = 'Waiting in line';
  else status = `Cutting ${Math.round(25 + 75 * cut.progress)}%`;

  return (
    <Pressable onPress={open} onLongPress={remove} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
      <Thumb uri={uri} seconds={seconds} style={styles.thumb} flip={flip}>
        {cut.status === 'failed' && (
          <View style={styles.badge}>
            <SymbolView name="exclamationmark" tintColor="#fff" size={10} weight="bold" />
          </View>
        )}
        {cut.status === 'ready' && <Text style={styles.duration}>{formatTime(editedDuration(cut))}</Text>}
        {(cut.status === 'uploading' || cut.status === 'processing') && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(100 * (cut.status === 'uploading' ? cut.progress * 0.25 : 0.25 + 0.75 * cut.progress))}%` }]} />
          </View>
        )}
      </Thumb>
      <Text style={styles.title} numberOfLines={1}>{cut.title}</Text>
      <Text style={[styles.status, cut.status === 'failed' && { color: '#D93B3B' }]} numberOfLines={2}>
        {status}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  h1: { fontSize: 32, fontWeight: '800', color: theme.ink },
  gear: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 17, fontWeight: '700', color: theme.ink, marginTop: 18, marginBottom: 10 },
  attention: { fontSize: 13, fontWeight: '600', color: '#D93B3B' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '30.5%', gap: 4 },
  thumb: { aspectRatio: 9 / 16, borderRadius: 12, justifyContent: 'flex-end' },
  duration: { color: '#fff', fontSize: 11, fontWeight: '700', margin: 6, alignSelf: 'flex-end', textShadowColor: '#000', textShadowRadius: 3, fontVariant: ['tabular-nums'] },
  badge: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#D93B3B', alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 4, margin: 6, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)', overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: theme.accent },
  title: { fontSize: 12, fontWeight: '600', color: theme.ink },
  status: { fontSize: 11, color: theme.muted, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: 14, paddingTop: 120, paddingHorizontal: 30 },
  emptyBody: { fontSize: 15, color: theme.muted, textAlign: 'center', lineHeight: 21 },
  hint: { fontSize: 12, color: theme.faint, textAlign: 'center', marginTop: 24 },
});
