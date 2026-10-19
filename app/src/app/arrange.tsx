import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReorderRow } from '../components/ReorderRow';
import { Thumb } from '../components/Thumb';
import { Button, Wash } from '../components/ui';
import { MAX_CLIPS, removeVideo, updateVideo, useBatch } from '../lib/batch';
import { startCut, type Take } from '../lib/jobs';
import { useUsage } from '../lib/usage';
import { formatTime, theme } from '../lib/theme';
import { CuttingView } from './cut/[id]';
import { JAKARTA } from '../lib/fonts';

const TILE_W = 104;
const TILE_H = 170;
const GAP = 12;

/**
 * "Arrange your clips": several videos picked from Photos, put in order (hold and drag), trimmed
 * of any that don't belong, then combined into one video and cut like a single take.
 * With `video`, it arranges that video of the batch being put together instead (changes save as you go).
 */
export default function Arrange() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ takes?: string; video?: string }>();
  const batch = useBatch();
  const inBatch = !!params.video;
  const video = batch.find((v) => v.key === params.video);
  const [own, setOwn] = useState<Take[]>(() => {
    try {
      return JSON.parse(params.takes ?? '[]') as Take[];
    } catch {
      return [];
    }
  });
  const [ownBlend, setOwnBlend] = useState(true);
  const takes = inBatch ? (video?.takes ?? []) : own;
  const blend = inBatch ? (video?.blend ?? true) : ownBlend;
  const setTakes = (change: (list: Take[]) => Take[]) => (video ? updateVideo(video.key, (v) => ({ ...v, takes: change(v.takes) })) : setOwn(change));
  const setBlend = (on: boolean) => (video ? updateVideo(video.key, (v) => ({ ...v, blend: on })) : setOwnBlend(on));
  const [sending, setSending] = useState(false);
  const [cutId, setCutId] = useState<string | null>(null);
  const usage = useUsage();
  const total = takes.reduce((t, k) => t + k.duration, 0);

  const move = (from: number, to: number) =>
    setTakes((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  async function addMore() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1, allowsMultipleSelection: true, selectionLimit: MAX_CLIPS - takes.length, orderedSelection: true });
    if (result.canceled) return;
    setTakes((list) => [...list, ...result.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }))].slice(0, MAX_CLIPS));
  }

  function remove(i: number) {
    Haptics.selectionAsync();
    if (takes.length === 1) {
      if (video) removeVideo(video.key);
      return router.back();
    }
    setTakes((list) => list.filter((_, k) => k !== i));
  }

  function combine() {
    if (!takes.length || !usage.room(1)) return;
    setSending(true);
    setCutId(startCut(takes, 'en', { blend }));
  }

  // Sent: this screen becomes the cutting screen, then the editor (see CuttingView).
  if (cutId) {
    return <CuttingView id={cutId} />; // straight swap: a fade would blink white
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 12 }]}>
      <Wash />
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <SymbolView name="chevron.left" tintColor={theme.ink} size={17} weight="semibold" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headTitle}>{inBatch ? `Video ${batch.findIndex((v) => v.key === params.video) + 1}` : 'New cut'}</Text>
        <View style={{ width: 70 }} />
      </View>

      <View style={styles.intro}>
        <Text style={styles.title}>Arrange your <Text style={{ color: theme.blue }}>clips</Text></Text>
        <Text style={styles.sub}>
          {inBatch
            ? 'Hold and drag to set the order. When you edit the batch, these are combined in order into one video.'
            : 'Hold and drag to set the order. We’ll combine them in order, then cut out retakes and dead air.'}
        </Text>
      </View>

      <ReorderRow
        items={takes}
        keyOf={(t, i) => `${t.uri}-${i}`}
        width={TILE_W}
        height={TILE_H}
        gap={GAP}
        onMove={move}
        tileStyle={styles.tile}
        contentStyle={styles.row}
        render={(t, i) => (
          <>
            <Thumb uri={t.uri} seconds={0.5} style={StyleSheet.absoluteFill} flip={t.flip} />
            <View style={styles.number}>
              <Text style={styles.numberText}>{i + 1}</Text>
            </View>
            <Pressable onPress={() => remove(i)} hitSlop={8} style={styles.remove} accessibilityLabel={`Remove clip ${i + 1}`}>
              <SymbolView name="xmark" tintColor="#fff" size={11} weight="bold" />
            </Pressable>
            <View style={styles.length}>
              <Text style={styles.lengthText}>{formatTime(t.duration)}</Text>
            </View>
          </>
        )}
        trailing={
          takes.length < MAX_CLIPS && (
            <Pressable onPress={() => addMore().catch((e) => Alert.alert('Couldn’t add videos', String(e)))} style={styles.add} accessibilityLabel="Add more clips">
              <SymbolView name="plus" tintColor={theme.muted} size={26} />
            </Pressable>
          )
        }
      />

      <View style={{ flex: 1 }} />

      <View style={styles.option}>
        <SymbolView name="waveform" tintColor={theme.ink} size={20} />
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>Blend audio between clips</Text>
          <Text style={styles.optionSub}>Soften each join so the sound doesn’t jump.</Text>
        </View>
        <Switch value={blend} onValueChange={setBlend} trackColor={{ true: theme.ink }} />
      </View>
      <Text style={styles.summary}>
        {takes.length} clip{takes.length === 1 ? '' : 's'} · {formatTime(total)} total
      </Text>
      {inBatch ? (
        <Button title="Done" onPress={() => router.back()} style={{ marginHorizontal: 20 }} />
      ) : (
        <Button title="Combine & edit" onPress={combine} loading={sending} disabled={!takes.length} style={{ marginHorizontal: 20 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 44 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 70 },
  backText: { fontSize: 16, fontFamily: JAKARTA.medium, color: theme.ink },
  headTitle: { fontSize: 17, fontFamily: JAKARTA.bold, color: theme.ink },
  intro: { paddingHorizontal: 20, marginTop: 8, gap: 6 },
  title: { fontSize: 28, fontFamily: JAKARTA.extrabold, color: theme.ink, letterSpacing: -0.5 },
  sub: { fontSize: 15, fontFamily: JAKARTA.medium, color: theme.muted, lineHeight: 21 },
  row: { gap: GAP, paddingHorizontal: 20, paddingVertical: 22 },
  tile: { borderRadius: 16, overflow: 'hidden', backgroundColor: theme.card },
  number: { position: 'absolute', top: 7, left: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  numberText: { color: '#fff', fontSize: 13, fontFamily: JAKARTA.bold },
  remove: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  length: { position: 'absolute', bottom: 7, right: 7, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  lengthText: { color: '#fff', fontSize: 12, fontFamily: JAKARTA.bold, fontVariant: ['tabular-nums'] },
  add: { width: TILE_W - 20, height: TILE_H, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 18, padding: 16, marginHorizontal: 20 },
  optionTitle: { fontSize: 16, fontFamily: JAKARTA.bold, color: theme.ink },
  optionSub: { fontSize: 13, fontFamily: JAKARTA.medium, color: theme.muted, marginTop: 2 },
  summary: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted, textAlign: 'center', marginVertical: 14, fontVariant: ['tabular-nums'] },
});
