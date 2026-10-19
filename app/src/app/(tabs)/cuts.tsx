import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RoundButton } from '../../components/list';
import { Thumb } from '../../components/Thumb';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { Button, PressableScale, Wash } from '../../components/ui';
import * as Sharing from 'expo-sharing';
import { coverSource } from '../../lib/edit';
import { canRetry, retryCut } from '../../lib/jobs';
import {
  createFolder, cutFile, cutProgress, cutStatus, deleteCut, deleteFolder, duplicateCut, editedDuration, exportFile, getFolders, moveCuts, renameFolder, updateCut,
  useCuts, useFolders, type CutRecord, type Folder,
} from '../../lib/store';
import { column, formatTime, theme, WIDE_COLUMN } from '../../lib/theme';
import { JAKARTA } from '../../lib/fonts';

const DEVICE = Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone';
const GAP = 12;

type Sort = 'newest' | 'oldest' | 'longest';
type Filter = 'all' | 'ready' | 'exported';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'longest', label: 'Longest first' },
];
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All cuts' },
  { value: 'ready', label: 'Ready to edit' },
  { value: 'exported', label: 'Exported' },
];

/** Asks which folder to file `ids` in (or a new one), then moves them. */
function moveToFolder(ids: string[], folders: Folder[]) {
  const choices = ['Cuts (no folder)', ...folders.map((f) => f.name), 'New folder…'];
  sheet(ids.length === 1 ? 'Move to folder' : `Move ${ids.length} cuts to`, choices, (i) => {
    if (i === 0) moveCuts(ids, undefined);
    else if (i <= folders.length) moveCuts(ids, folders[i - 1].id);
    else Alert.prompt('New folder', undefined, (name) => name.trim() && moveCuts(ids, createFolder(name)), 'plain-text');
  });
}

/** A menu of options as an iOS action sheet; `onPick` gets the chosen index. */
const sheet = (title: string | undefined, options: string[], onPick: (i: number) => void, destructive?: number) =>
  ActionSheetIOS.showActionSheetWithOptions({ title, options: [...options, 'Cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: destructive }, (i) => {
    if (i < options.length) onPick(i);
  });

export default function CutsScreen() {
  const all = useCuts();
  const folders = useFolders();
  const [folder, setFolder] = useState<string>('all'); // 'all' or a folder id
  const current = folders.find((f) => f.id === folder);
  // A deleted folder falls back to showing everything.
  const cuts = current ? all.filter((c) => c.folderId === current.id) : all;
  const insets = useSafeAreaInsets();
  const [sort, setSort] = useState<Sort>('newest');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const drafts = cuts.filter((c) => c.status !== 'ready');
  const attention = drafts.filter((c) => c.status === 'failed').length;
  const done = cuts
    .filter((c) => c.status === 'ready' && (filter === 'all' || (filter === 'exported' ? c.exports > 0 : c.exports === 0)))
    .sort((a, b) =>
      sort === 'longest' ? editedDuration(b) - editedDuration(a) : (Date.parse(b.createdAt) - Date.parse(a.createdAt)) * (sort === 'newest' ? 1 : -1)
    );

  function menu() {
    sheet(undefined, ['Select', 'New folder', 'Sort by…', 'Filter…'], (i) => {
      if (i === 0) setSelecting(true);
      else if (i === 1) Alert.prompt('New folder', 'Group cuts by product, brand or series.', (name) => name.trim() && setFolder(createFolder(name)), 'plain-text');
      else if (i === 2) sheet('Sort by', SORTS.map((s) => (s.value === sort ? `✓ ${s.label}` : s.label)), (k) => setSort(SORTS[k].value));
      else sheet('Show', FILTERS.map((f) => (f.value === filter ? `✓ ${f.label}` : f.label)), (k) => setFilter(FILTERS[k].value));
    });
  }

  function folderActions(f: Folder) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    sheet(
      f.name,
      ['Rename', 'Delete folder'],
      (i) => {
        if (i === 0) Alert.prompt('Rename folder', undefined, (name) => renameFolder(f.id, name), 'plain-text', f.name);
        else
          Alert.alert(`Delete “${f.name}”?`, 'The folder goes; its cuts move back to the main Cuts page.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete folder',
              style: 'destructive',
              onPress: () => {
                deleteFolder(f.id);
                setFolder('all');
              },
            },
          ]);
      },
      1
    );
  }

  function endSelecting() {
    setSelecting(false);
    setSelected([]);
  }

  function deleteSelected() {
    const n = selected.length;
    Alert.alert(`Delete ${n} cut${n === 1 ? '' : 's'}?`, `They’re removed from this ${DEVICE}. Videos you saved to Photos stay there.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          selected.forEach(deleteCut);
          endSelecting();
        },
      },
    ]);
  }

  const toggle = (id: string) => {
    Haptics.selectionAsync();
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <View style={styles.screen}>
      <Wash />
      <ScrollView contentContainerStyle={[{ paddingTop: insets.top + 6, paddingBottom: TAB_BAR_HEIGHT + 80, paddingHorizontal: 18 }, column(WIDE_COLUMN + 36)]}>
        <View style={styles.top}>
          {selecting ? (
            <Pressable onPress={endSelecting} hitSlop={10} style={styles.textButton}>
              <Text style={styles.textButtonLabel}>Done</Text>
            </Pressable>
          ) : (
            all.length > 0 && <RoundButton icon="ellipsis" label="More" onPress={menu} />
          )}
        </View>
        <Text style={styles.h1}>{selecting ? (selected.length ? `${selected.length} selected` : 'Select cuts') : 'Cuts'}</Text>

        {folders.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folders} contentContainerStyle={{ gap: 8 }}>
            <Pressable onPress={() => setFolder('all')} style={[styles.folderChip, !current && styles.folderChipOn]}>
              <Text style={[styles.folderChipText, !current && { color: '#fff' }]}>All</Text>
            </Pressable>
            {folders.map((f) => (
              <Pressable key={f.id} onPress={() => setFolder(f.id)} onLongPress={() => folderActions(f)} style={[styles.folderChip, current?.id === f.id && styles.folderChipOn]}>
                <SymbolView name="folder.fill" tintColor={current?.id === f.id ? '#fff' : theme.ink} size={13} />
                <Text style={[styles.folderChipText, current?.id === f.id && { color: '#fff' }]}>{f.name}</Text>
                <Text style={[styles.folderCount, current?.id === f.id && { color: 'rgba(255,255,255,0.7)' }]}>{all.filter((c) => c.folderId === f.id).length}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {cuts.length === 0 && current && (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <SymbolView name="folder" tintColor={theme.muted} size={26} />
            </View>
            <Text style={styles.emptyTitle}>Nothing in <Text style={{ color: theme.blue }}>{current.name}</Text> yet</Text>
            <Text style={styles.emptyBody}>Hold a cut and choose Move to folder, or pick this folder on the camera before you record.</Text>
          </View>
        )}

        {cuts.length === 0 && !current && (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <SymbolView name="film.stack" tintColor={theme.muted} size={26} />
            </View>
            <Text style={styles.emptyTitle}>No <Text style={{ color: theme.blue }}>cuts</Text> yet</Text>
            <Text style={styles.emptyBody}>Film or upload on the Create tab and your first cut lands here.</Text>
            <Button kind="outline" title="Start recording" onPress={() => router.navigate('/')} style={{ paddingHorizontal: 26, minHeight: 46 }} />
          </View>
        )}

        {drafts.length > 0 && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>In progress</Text>
              {attention > 0 && <Text style={styles.attention}>{attention} need{attention === 1 ? 's' : ''} attention</Text>}
            </View>
            <Grid cuts={drafts} selecting={selecting} selected={selected} onToggle={toggle} />
          </>
        )}

        {cuts.some((c) => c.status === 'ready') && (
          <>
            <Pressable onPress={() => setOpen(!open)} style={styles.section} accessibilityRole="button" accessibilityState={{ expanded: open }}>
              <Text style={styles.sectionTitle} numberOfLines={1}>
                {current ? current.name : `On this ${DEVICE}`}
              </Text>
              <View style={styles.count}>
                <Text style={styles.countText}>{done.length}</Text>
              </View>
              <SymbolView name={open ? 'chevron.down' : 'chevron.right'} tintColor={theme.ink} size={13} weight="semibold" />
              {filter !== 'all' && (
                <Pressable onPress={() => setFilter('all')} hitSlop={8} style={styles.filterChip}>
                  <Text style={styles.filterText}>{FILTERS.find((f) => f.value === filter)?.label}</Text>
                  <SymbolView name="xmark" tintColor={theme.muted} size={9} weight="bold" />
                </Pressable>
              )}
            </Pressable>
            {open && (done.length ? <Grid cuts={done} selecting={selecting} selected={selected} onToggle={toggle} /> : <Text style={styles.none}>No cuts match this filter.</Text>)}
          </>
        )}
      </ScrollView>

      {selecting && (
        <View style={[styles.selectBar, { bottom: TAB_BAR_HEIGHT + 34 }]}>
          <Pressable
            onPress={() => setSelected(selected.length === cuts.length ? [] : cuts.map((c) => c.id))}
            hitSlop={8}
            style={styles.selectAll}
          >
            <Text style={styles.selectAllText}>{selected.length === cuts.length ? 'Select none' : 'Select all'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              moveToFolder(selected, folders);
              endSelecting();
            }}
            disabled={!selected.length}
            style={[styles.moveButton, !selected.length && { opacity: 0.4 }]}
          >
            <SymbolView name="folder" tintColor={theme.ink} size={15} />
            <Text style={styles.moveText}>Move</Text>
          </Pressable>
          <Pressable onPress={deleteSelected} disabled={!selected.length} style={[styles.deleteButton, !selected.length && { opacity: 0.4 }]}>
            <SymbolView name="trash" tintColor="#fff" size={15} />
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Three thumbnails a row on iPhone, more on iPad. */
function Grid({ cuts, selecting, selected, onToggle }: { cuts: CutRecord[]; selecting: boolean; selected: string[]; onToggle: (id: string) => void }) {
  const { width } = useWindowDimensions();
  const inner = Math.min(width, WIDE_COLUMN + 36) - 36;
  const columns = Math.max(3, Math.floor((inner + GAP) / 150));
  const cardW = Math.floor((inner - GAP * (columns - 1)) / columns);
  return (
    <View style={styles.grid}>
      {cuts.map((c) => (
        <Card key={c.id} cut={c} width={cardW} selecting={selecting} selected={selected.includes(c.id)} onToggle={() => onToggle(c.id)} />
      ))}
    </View>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

function Card({ cut, width, selecting, selected, onToggle }: { cut: CutRecord; width: number; selecting: boolean; selected: boolean; onToggle: () => void }) {
  const uri = cut.source ? cutFile(cut.source).uri : cut.previewUri;
  const flip = !cut.source && !!cut.previewFlip;
  const seconds = cut.edit ? coverSource(cut.edit) : (cut.clips[0]?.[0] ?? 0) + 0.3;
  const open = () => {
    // A failed cut: straight to what can be done about it.
    if (cut.status === 'failed') {
      const retry = canRetry(cut);
      return sheet(
        cut.error ?? "The edit didn't finish.",
        [...(retry ? ['Try again'] : []), 'Delete'],
        (i) => (retry && i === 0 ? retryCut(cut.id) : deleteCut(cut.id)),
        retry ? 1 : 0
      );
    }
    router.push({ pathname: cut.status === 'ready' ? '/edit/[id]' : '/cut/[id]', params: { id: cut.id } });
  };

  function actions() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const exported = exportFile(cut);
    const choices: { label: string; run: () => void }[] = [
      { label: 'Rename', run: () => Alert.prompt('Rename cut', undefined, (title) => title.trim() && updateCut(cut.id, { title: title.trim() }), 'plain-text', cut.title) },
      ...(exported.exists ? [{ label: 'Share', run: () => Sharing.shareAsync(exported.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' }) }] : []),
      ...(cut.status === 'ready' && cut.source ? [{ label: 'Duplicate', run: () => duplicateCut(cut.id) }] : []),
      ...(canRetry(cut) ? [{ label: 'Try again', run: () => retryCut(cut.id) }] : []),
      { label: 'Move to folder…', run: () => moveToFolder([cut.id], getFolders()) },
      {
        label: 'Delete',
        run: () =>
          Alert.alert('Delete this cut?', `It’s removed from this ${DEVICE}. Videos you saved to Photos stay there.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteCut(cut.id) },
          ]),
      },
    ];
    sheet(cut.title, choices.map((c) => c.label), (i) => choices[i].run(), choices.length - 1);
  }

  const status = cutStatus(cut);

  return (
    <PressableScale
      scaleTo={0.96}
      onPress={selecting ? onToggle : open}
      onLongPress={selecting ? undefined : actions}
      style={[styles.card, { width }]}
    >
      <Thumb uri={uri} seconds={seconds} style={[styles.thumb, selected && styles.thumbOn]} flip={flip}>
        {cut.status === 'failed' && (
          <View style={styles.badge}>
            <SymbolView name="exclamationmark" tintColor="#fff" size={10} weight="bold" />
          </View>
        )}
        {cut.status === 'ready' && <Text style={styles.duration}>{formatTime(editedDuration(cut))}</Text>}
        {(cut.status === 'uploading' || cut.status === 'processing') && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(100 * cutProgress(cut))}%` }]} />
          </View>
        )}
        {selecting && (
          <View style={[styles.check, selected && styles.checkOn]}>
            {selected && <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />}
          </View>
        )}
      </Thumb>
      <Text style={styles.title} numberOfLines={1}>
        {cut.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {when(cut.createdAt)}
      </Text>
      <Text style={[styles.meta, cut.status === 'failed' && { color: theme.danger }]} numberOfLines={2}>
        {status}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  top: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', height: 44 },
  textButton: { height: 40, justifyContent: 'center', paddingHorizontal: 6 },
  textButtonLabel: { fontSize: 16, fontFamily: JAKARTA.bold, color: theme.ink },
  h1: { fontSize: 34, fontFamily: JAKARTA.extrabold, color: theme.ink, letterSpacing: -0.6 },
  section: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 12 },
  sectionTitle: { fontSize: 22, fontFamily: JAKARTA.bold, color: theme.ink, letterSpacing: -0.3 },
  count: { backgroundColor: theme.line, borderRadius: 999, minWidth: 24, height: 24, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 13, fontFamily: JAKARTA.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
  attention: { fontSize: 13, fontFamily: JAKARTA.semibold, color: theme.danger },
  filterChip: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  filterText: { fontSize: 12, fontFamily: JAKARTA.semibold, color: theme.ink },
  none: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: { gap: 2 },
  thumb: { aspectRatio: 9 / 16, borderRadius: 14, justifyContent: 'flex-end', marginBottom: 6, borderWidth: 2.5, borderColor: 'transparent' },
  thumbOn: { borderColor: theme.ink },
  duration: { color: '#fff', fontSize: 11, fontFamily: JAKARTA.bold, margin: 7, alignSelf: 'flex-end', textShadowColor: '#000', textShadowRadius: 3, fontVariant: ['tabular-nums'] },
  badge: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  progressTrack: { height: 4, margin: 7, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)', overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: '#fff' },
  title: { fontSize: 13, fontFamily: JAKARTA.semibold, color: theme.ink },
  meta: { fontSize: 12, fontFamily: JAKARTA.medium, color: theme.muted, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: 8, paddingTop: 110, paddingHorizontal: 30 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 18, fontFamily: JAKARTA.bold, color: theme.ink },
  emptyBody: { fontSize: 14, fontFamily: JAKARTA.medium, color: theme.muted, textAlign: 'center', lineHeight: 20, marginBottom: 10 },
  selectBar: {
    position: 'absolute', left: 18, right: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 20, padding: 8, paddingLeft: 16,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  selectAll: { paddingVertical: 8, marginRight: 'auto' },
  moveButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  moveText: { color: theme.ink, fontSize: 15, fontFamily: JAKARTA.bold },
  folders: { marginTop: 14, marginHorizontal: -18, paddingHorizontal: 18, flexGrow: 0 },
  folderChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  folderChipOn: { backgroundColor: theme.ink },
  folderChipText: { fontSize: 14, fontFamily: JAKARTA.semibold, color: theme.ink },
  folderCount: { fontSize: 12, fontFamily: JAKARTA.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
  selectAllText: { fontSize: 15, fontFamily: JAKARTA.semibold, color: theme.ink },
  deleteButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.danger, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  deleteText: { color: '#fff', fontSize: 15, fontFamily: JAKARTA.bold },
});
