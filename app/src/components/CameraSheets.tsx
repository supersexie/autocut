import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createFolder, updateSettings, useFolders, useSettings } from '../lib/store';
import { theme } from '../lib/theme';
import { Sheet } from './Sheet';
import { PressableScale, type SymbolName } from './ui';
import { UI_FONT } from '../lib/fonts';

/** "Save new videos to": the main Cuts page or a folder, and making a new folder. */
export function FolderSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const folders = useFolders();
  const { saveFolder } = useSettings();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const pick = (id: string) => {
    updateSettings({ saveFolder: id });
    onClose();
  };
  const create = () => {
    if (!name.trim()) return;
    pick(createFolder(name));
  };
  const reset = () => {
    setNaming(false);
    setName('');
  };

  return (
    <Sheet visible={visible} onClose={onClose} onDismissed={reset}>
      {naming ? (
        <>
          <View style={styles.head}>
            <Pressable onPress={() => setNaming(false)} hitSlop={10}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
            <Text style={styles.title}>New <Text style={{ color: theme.blue }}>folder</Text></Text>
            <Pressable onPress={create} disabled={!name.trim()} hitSlop={10}>
              <Text style={[styles.link, styles.strong, !name.trim() && { color: theme.faint }]}>Create</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Folder name"
            placeholderTextColor={theme.faint}
            autoFocus
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={create}
          />
        </>
      ) : (
        <>
          <View style={styles.head}>
            <Text style={[styles.title, { textAlign: 'left' }]}>Save new <Text style={{ color: theme.blue }}>videos</Text> to</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.list}>
            <Choice icon="film.stack" label="Cuts" detail="Main page, no folder" on={!saveFolder} onPress={() => pick('')} />
            {folders.map((f) => (
              <Choice key={f.id} icon="folder.fill" label={f.name} on={saveFolder === f.id} onPress={() => pick(f.id)} strong />
            ))}
          </View>
          <PressableScale onPress={() => setNaming(true)} scaleTo={0.98} style={styles.newFolder}>
            <SymbolView name="folder.badge.plus" tintColor={theme.blue} size={20} />
            <Text style={styles.newFolderText}>New folder</Text>
          </PressableScale>
        </>
      )}
    </Sheet>
  );
}

function Choice({ icon, label, detail, on, strong, onPress }: { icon: SymbolName; label: string; detail?: string; on: boolean; strong?: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={styles.choice} accessibilityState={{ selected: on }}>
      <View style={[styles.choiceIcon, strong && { backgroundColor: theme.blueTileOn }]}>
        <SymbolView name={icon} tintColor={theme.blue} size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceLabel} numberOfLines={1}>
          {label}
        </Text>
        {detail && <Text style={styles.choiceDetail}>{detail}</Text>}
      </View>
      {on && <SymbolView name="checkmark" tintColor={theme.blue} size={18} weight="semibold" />}
    </PressableScale>
  );
}

/** "Add video" from the camera: one video to cut, or several to combine into one. */
export function AddVideoSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (kind: 'single' | 'multiple') => void }) {
  const [chosen, setChosen] = useState<'single' | 'multiple' | null>(null);
  const choose = (kind: 'single' | 'multiple') => {
    setChosen(kind);
    onClose();
  };
  return (
    // The photo picker opens once this has slid away, or iOS refuses to show it.
    <Sheet
      visible={visible}
      onClose={onClose}
      onDismissed={() => {
        if (chosen) onPick(chosen);
        setChosen(null);
      }}
    >
      <Text style={[styles.title, { textAlign: 'left', marginBottom: 14 }]}>Add <Text style={{ color: theme.blue }}>video</Text></Text>
      <View style={{ gap: 10 }}>
        <Option icon="play.rectangle.fill" dark label="Single clip" detail="Quickly cut one video" onPress={() => choose('single')} />
        <Option icon="square.stack.3d.up.fill" label="Multiple clips" detail="Combine your takes into one video" onPress={() => choose('multiple')} />
      </View>
    </Sheet>
  );
}

function Option({ icon, label, detail, dark, onPress }: { icon: SymbolName; label: string; detail: string; dark?: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={styles.option}>
      <View style={[styles.optionIcon, dark && { backgroundColor: theme.blueTileOn }]}>
        <SymbolView name={icon} tintColor={theme.blue} size={22} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionDetail}>{detail}</Text>
      </View>
      <SymbolView name="chevron.right" tintColor={theme.faint} size={14} weight="semibold" />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, minHeight: 32 },
  title: { fontSize: 20, ...UI_FONT.bold, color: theme.ink, flex: 1, textAlign: 'center' },
  link: { fontSize: 16, ...UI_FONT.semibold, color: theme.muted, minWidth: 56 },
  strong: { color: theme.ink, ...UI_FONT.bold, textAlign: 'right' },
  list: { marginBottom: 16 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  choiceIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: theme.blueTile, alignItems: 'center', justifyContent: 'center' },
  choiceLabel: { fontSize: 17, ...UI_FONT.semibold, color: theme.ink },
  choiceDetail: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, marginTop: 2 },
  newFolder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 16, paddingVertical: 15, backgroundColor: theme.card },
  newFolderText: { fontSize: 17, ...UI_FONT.semibold, color: theme.ink },
  input: { fontSize: 17, ...UI_FONT.semibold, color: theme.ink, borderWidth: 2, borderColor: theme.ink, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: theme.card, borderRadius: 18, padding: 14 },
  optionIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: theme.blueTile, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { fontSize: 18, ...UI_FONT.bold, color: theme.ink },
  optionDetail: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted },
});
