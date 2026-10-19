import * as Sharing from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportFile, type CutRecord } from '../lib/store';
import { UI_FONT } from '../lib/fonts';
import { theme } from '../lib/theme';
import { Thumb } from './Thumb';

const COLS = 3;
const GAP = 8;

/**
 * The finished videos on this phone, newest first: a still of each, tap to watch it (and share it).
 * Cuts exported before the file was kept, or whose file was cleared, don't show.
 */
export function ExportedVideos({ cuts }: { cuts: CutRecord[] }) {
  const [open, setOpen] = useState<CutRecord | null>(null);
  const [width, setWidth] = useState(0);
  const list = cuts
    .filter((c) => c.exports > 0 && exportFile(c).exists)
    .sort((a, b) => (b.exportedAt ?? b.createdAt).localeCompare(a.exportedAt ?? a.createdAt));
  if (!list.length) return null;
  const tile = (width - GAP * (COLS - 1)) / COLS;
  return (
    <View style={{ marginTop: 18 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text style={styles.title}>
        Your <Text style={{ color: theme.blue }}>exports</Text>
      </Text>
      <View style={[styles.grid, !width && { opacity: 0 }]}>
        {list.map((c) => (
          <Pressable key={c.id} onPress={() => setOpen(c)} accessibilityLabel={`Watch ${c.title}`} style={{ width: tile }}>
            <Thumb uri={exportFile(c).uri} seconds={0.5} style={[styles.tile, { width: tile, height: tile * (16 / 9) }]}>
              <View style={styles.play}>
                <SymbolView name="play.fill" tintColor="#fff" size={12} />
              </View>
            </Thumb>
            <Text style={styles.name} numberOfLines={1}>
              {c.title}
            </Text>
          </Pressable>
        ))}
      </View>
      {open && <Watch cut={open} onClose={() => setOpen(null)} />}
    </View>
  );
}

/** One export full screen, playing on a loop, with Share. */
function Watch({ cut, onClose }: { cut: CutRecord; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const uri = exportFile(cut).uri;
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait']}>
      <View style={[styles.watch, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.watchHead}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <SymbolView name="xmark" tintColor="#fff" size={17} weight="semibold" />
          </Pressable>
          <Text style={styles.watchTitle} numberOfLines={1}>
            {cut.title}
          </Text>
          <View style={{ width: 17 }} />
        </View>
        <View style={{ flex: 1, width }}>
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        </View>
        <Pressable onPress={() => Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' })} style={styles.share}>
          <SymbolView name="square.and.arrow.up" tintColor={theme.ink} size={15} weight="semibold" />
          <Text style={styles.shareText}>Share</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, ...UI_FONT.extrabold, color: theme.ink, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#E3E6EE' },
  play: { position: 'absolute', left: 8, bottom: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(17,17,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 12, ...UI_FONT.semibold, color: theme.ink, marginTop: 6 },
  watch: { flex: 1, backgroundColor: '#000', alignItems: 'center', gap: 12 },
  watchHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 20, height: 40, gap: 12 },
  watchTitle: { flex: 1, textAlign: 'center', fontSize: 16, ...UI_FONT.semibold, color: '#fff' },
  share: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 28, height: 50 },
  shareText: { fontSize: 16, ...UI_FONT.bold, color: theme.ink },
});
