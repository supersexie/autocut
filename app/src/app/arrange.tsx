import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Thumb } from '../components/Thumb';
import { Button } from '../components/ui';
import { startCut, type Take } from '../lib/jobs';
import { formatTime, theme } from '../lib/theme';

const TILE_W = 104;
const TILE_H = 170;
const GAP = 12;
const STEP = TILE_W + GAP;
const MAX = 20;

/**
 * "Arrange your clips": several videos picked from Photos, put in order (hold and drag), trimmed
 * of any that don't belong, then combined into one video and cut like a single take.
 */
export default function Arrange() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ takes?: string }>();
  const [takes, setTakes] = useState<Take[]>(() => {
    try {
      return JSON.parse(params.takes ?? '[]') as Take[];
    } catch {
      return [];
    }
  });
  const [blend, setBlend] = useState(true);
  const [drag, setDrag] = useState<{ from: number; dx: number } | null>(null);
  const [sending, setSending] = useState(false);
  const total = takes.reduce((t, k) => t + k.duration, 0);
  const target = drag ? Math.max(0, Math.min(takes.length - 1, drag.from + Math.round(drag.dx / STEP))) : -1;

  const move = (from: number, to: number) =>
    setTakes((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  async function addMore() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1, allowsMultipleSelection: true, selectionLimit: MAX - takes.length, orderedSelection: true });
    if (result.canceled) return;
    setTakes((list) => [...list, ...result.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'video/quicktime', duration: (a.duration ?? 0) / 1000 }))].slice(0, MAX));
  }

  function remove(i: number) {
    Haptics.selectionAsync();
    const next = takes.filter((_, k) => k !== i);
    if (!next.length) return router.back();
    setTakes(next);
  }

  function combine() {
    if (!takes.length) return;
    setSending(true);
    const id = startCut(takes, 'en', { blend });
    router.replace({ pathname: '/cut/[id]', params: { id } });
  }

  const drop = (from: number, dx: number) => {
    const to = Math.max(0, Math.min(takes.length - 1, from + Math.round(dx / STEP)));
    if (to !== from) {
      Haptics.selectionAsync();
      move(from, to);
    }
    setDrag(null);
  };

  const shift = (k: number) => {
    if (!drag || k === drag.from) return 0;
    if (drag.from < k && k <= target) return -STEP;
    if (target <= k && k < drag.from) return STEP;
    return 0;
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <SymbolView name="chevron.left" tintColor={theme.ink} size={17} weight="semibold" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headTitle}>New cut</Text>
        <View style={{ width: 70 }} />
      </View>

      <View style={styles.intro}>
        <Text style={styles.title}>Arrange your clips</Text>
        <Text style={styles.sub}>Hold and drag to set the order. We’ll combine them in order, then cut out retakes and dead air.</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!drag} contentContainerStyle={styles.row} style={{ flexGrow: 0 }}>
        {takes.map((t, i) => (
          <ClipTile
            key={`${t.uri}-${i}`}
            take={t}
            index={i}
            dx={drag?.from === i ? drag.dx : null}
            shift={shift(i)}
            onDrag={(dx) => setDrag({ from: i, dx })}
            onDrop={(dx) => drop(i, dx)}
            onRemove={() => remove(i)}
          />
        ))}
        {takes.length < MAX && (
          <Pressable onPress={() => addMore().catch((e) => Alert.alert('Couldn’t add videos', String(e)))} style={styles.add} accessibilityLabel="Add more clips">
            <SymbolView name="plus" tintColor={theme.muted} size={26} />
          </Pressable>
        )}
      </ScrollView>

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
      <Button title="Combine & edit" onPress={combine} loading={sending} disabled={!takes.length} style={{ marginHorizontal: 20 }} />
    </View>
  );
}

type TileProps = {
  take: Take;
  index: number;
  /** How far it's being dragged, or null when it isn't. */
  dx: number | null;
  /** How far it slides aside for the one being dragged. */
  shift: number;
  onDrag: (dx: number) => void;
  onDrop: (dx: number) => void;
  onRemove: () => void;
};

/** One clip in the row. Hold it, then drag it along the row to move it. */
function ClipTile({ take, index, dx, shift, onDrag, onDrop, onRemove }: TileProps) {
  const latest = useRef({ onDrag, onDrop });
  const active = useRef(false);
  useEffect(() => {
    latest.current = { onDrag, onDrop };
  });
  // Made once: a gesture rebuilt on every render (and this re-renders as the finger moves) would
  // be re-attached, and the drag cancelled, mid-way. The handlers read the latest callbacks from a ref.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    Gesture.Pan()
      .activateAfterLongPress(220)
      .runOnJS(true)
      .onStart(() => {
        active.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        latest.current.onDrag(0);
      })
      .onUpdate((e) => latest.current.onDrag(e.translationX))
      .onEnd((e) => {
        active.current = false;
        latest.current.onDrop(e.translationX);
      })
      // Cancelled part-way (a call, the screen closing): put it back where it was.
      .onFinalize(() => {
        if (!active.current) return;
        active.current = false;
        latest.current.onDrop(0);
      })
  );
  return (
    <GestureDetector gesture={pan}>
      <View
        style={[
          styles.tile,
          dx !== null ? { transform: [{ translateX: dx }, { scale: 1.06 }], zIndex: 2, shadowOpacity: 0.25 } : { transform: [{ translateX: shift }] },
        ]}
      >
        <Thumb uri={take.uri} seconds={0.5} style={StyleSheet.absoluteFill} flip={take.flip} />
        <View style={styles.number}>
          <Text style={styles.numberText}>{index + 1}</Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={8} style={styles.remove} accessibilityLabel={`Remove clip ${index + 1}`}>
          <SymbolView name="xmark" tintColor="#fff" size={11} weight="bold" />
        </Pressable>
        <View style={styles.length}>
          <Text style={styles.lengthText}>{formatTime(take.duration)}</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 44 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 70 },
  backText: { fontSize: 16, color: theme.ink },
  headTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  intro: { paddingHorizontal: 20, marginTop: 8, gap: 6 },
  title: { fontSize: 28, fontWeight: '800', color: theme.ink, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: theme.muted, lineHeight: 21 },
  row: { gap: GAP, paddingHorizontal: 20, paddingVertical: 22 },
  tile: {
    width: TILE_W, height: TILE_H, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.card,
    shadowColor: '#000', shadowOpacity: 0, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  number: { position: 'absolute', top: 7, left: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  numberText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  remove: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  length: { position: 'absolute', bottom: 7, right: 7, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  lengthText: { color: '#fff', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  add: { width: TILE_W - 20, height: TILE_H, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 18, padding: 16, marginHorizontal: 20 },
  optionTitle: { fontSize: 16, fontWeight: '700', color: theme.ink },
  optionSub: { fontSize: 13, color: theme.muted, marginTop: 2 },
  summary: { fontSize: 14, color: theme.muted, textAlign: 'center', marginVertical: 14, fontVariant: ['tabular-nums'] },
});
