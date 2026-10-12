import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cutFile, deleteCut, useCuts, type CutRecord } from '../../lib/store';
import { formatTime, theme } from '../../lib/theme';

export default function CutsScreen() {
  const cuts = useCuts();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.h1}>Cuts</Text>
      {cuts.length === 0 ? (
        <View style={styles.empty}>
          <SymbolView name="film.stack" tintColor={theme.faint} size={40} />
          <Text style={styles.emptyTitle}>No cuts yet</Text>
          <Text style={styles.emptyBody}>Your finished cuts will show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={cuts}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.group}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => <CutRow cut={item} />}
        />
      )}
    </View>
  );
}

function CutRow({ cut }: { cut: CutRecord }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    const file = cutFile(cut.video);
    if (!file.exists) return;
    VideoThumbnails.getThumbnailAsync(file.uri, { time: 400 })
      .then((t) => setThumb(t.uri))
      .catch(() => {});
  }, [cut.video]);

  const confirmDelete = () =>
    Alert.alert('Delete this cut?', 'The edited video is removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCut(cut.id) },
    ]);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.line }]}
      onPress={() => router.push({ pathname: '/cut/[id]', params: { id: cut.id } })}
      onLongPress={confirmDelete}
    >
      <View style={styles.thumb}>{thumb && <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} />}</View>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={2}>{cut.title}</Text>
        <Text style={styles.meta}>
          {formatTime(cut.duration)} → {formatTime(cut.keptDuration)} · {cut.cuts.length} cuts
        </Text>
        <Text style={styles.date}>{new Date(cut.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 18 },
  h1: { fontSize: 32, fontWeight: '800', color: theme.ink, marginBottom: 16 },
  group: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  sep: { height: 1, backgroundColor: theme.line, marginLeft: 78 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12 },
  thumb: { width: 52, height: 78, borderRadius: 9, overflow: 'hidden', backgroundColor: '#D7E1F0' },
  rowText: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: '600', color: theme.ink },
  meta: { fontSize: 12, color: theme.muted, fontVariant: ['tabular-nums'] },
  date: { fontSize: 11, color: theme.faint },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.ink },
  emptyBody: { fontSize: 14, color: theme.muted },
});
