import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Sheet } from '../Sheet';
import { Button } from '../ui';
import { UI_FONT } from '../../lib/fonts';
import { theme } from '../../lib/theme';

// The Adjust tool's own windows (instead of the system's alerts): pick a clip to match, name a look,
// and a short note when something's done.

/** "Match this clip to…": a still of every other clip; tapping one matches to it. */
export function MatchSheet({ visible, clips, current, sourceUri, onPick, onClose }: {
  visible: boolean;
  clips: { start: number; end: number }[];
  current: number;
  sourceUri: string;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const [stills, setStills] = useState<Record<string, string>>({});
  const keyOf = (c: { start: number; end: number }) => `${c.start}-${c.end}`;
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    for (const c of clips) {
      VideoThumbnails.getThumbnailAsync(sourceUri, { time: Math.round(((c.start + c.end) / 2) * 1000), quality: 0.5 })
        .then((t) => alive && setStills((m) => ({ ...m, [keyOf(c)]: t.uri })))
        .catch(() => {}); // no still: the tile shows its number only
    }
    return () => {
      alive = false;
    };
  }, [visible, clips, sourceUri]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Match this clip to…</Text>
      <Text style={styles.sub}>Its light and colour change to look like the clip you pick.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
        {clips.map((c, i) =>
          i === current ? null : (
            <Pressable
              key={keyOf(c) + i}
              onPress={() => {
                Haptics.selectionAsync();
                onPick(i);
              }}
              style={styles.tileWrap}
              accessibilityLabel={`Clip ${i + 1}`}
            >
              <View style={styles.tile}>
                {stills[keyOf(c)] ? <Image source={{ uri: stills[keyOf(c)] }} style={StyleSheet.absoluteFill} /> : null}
              </View>
              <Text style={styles.tileText}>Clip {i + 1}</Text>
            </Pressable>
          )
        )}
      </ScrollView>
      <Pressable onPress={onClose} hitSlop={8} style={styles.cancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

/** "Save this look": a name for it (filled in for them), then Save. */
export function SaveLookSheet({ visible, suggested, onSave, onClose }: { visible: boolean; suggested: string; onSave: (name: string) => void; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Save this look</Text>
      <Text style={styles.sub}>It shows up first in Filters, ready for your next videos.</Text>
      {/* A fresh name field each time it opens. */}
      <LookName key={visible ? 'open' : 'shut'} suggested={suggested} onSave={onSave} />
    </Sheet>
  );
}

function LookName({ suggested, onSave }: { suggested: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(suggested);
  const save = () => onSave(name.trim() || suggested);
  return (
    <View style={{ gap: 12, marginTop: 14 }}>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        autoFocus
        selectTextOnFocus
        maxLength={18}
        returnKeyType="done"
        onSubmitEditing={save}
        placeholder="Look name"
        placeholderTextColor={theme.faint}
      />
      <Button title="Save look" onPress={save} icon={<SymbolView name="bookmark.fill" tintColor="#fff" size={14} />} />
    </View>
  );
}

/** A short dark note over the panel ("Look copied"), fading in and out. */
export function ColorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Animated.View key={text} entering={FadeIn.duration(160)} exiting={FadeOut.duration(200)} style={styles.note} pointerEvents="none">
      <SymbolView name="checkmark.circle.fill" tintColor="#fff" size={14} />
      <Text style={styles.noteText}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, ...UI_FONT.bold, color: theme.ink },
  sub: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted, marginTop: 4, lineHeight: 19 },
  tiles: { gap: 10, paddingVertical: 16 },
  tileWrap: { alignItems: 'center', gap: 6 },
  tile: { width: 72, height: 128, borderRadius: 12, overflow: 'hidden', backgroundColor: '#E3E6EE' },
  tileText: { fontSize: 12, ...UI_FONT.semibold, color: theme.ink },
  input: { backgroundColor: '#F2F3F7', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, fontSize: 17, ...UI_FONT.semibold, color: theme.ink },
  cancel: { alignSelf: 'center', paddingVertical: 6 },
  cancelText: { fontSize: 15, ...UI_FONT.semibold, color: theme.muted },
  note: {
    position: 'absolute', bottom: 8, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(17,17,20,0.88)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  noteText: { fontSize: 13, ...UI_FONT.semibold, color: '#fff' },
});
