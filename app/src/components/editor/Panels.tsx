import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import type { Caps, CaptionLine, CaptionSettings } from '../../lib/edit';
import { theme } from '../../lib/theme';
import { CAPTION_STYLES, captionStyle, frameOf, lookFor, StyledText, TEXT_STYLES, type Frame, type StylePreset } from './StyledText';
import type { SymbolName } from '../ui';

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Bottom panel that slides up over the timeline, with a header like CutAI's. */
export function Panel({ title, value, onClose, onDone, children, footer }: { title: string; value?: ReactNode; onClose?: () => void; onDone: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <Animated.View entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))} exiting={SlideOutDown.duration(200).easing(Easing.in(Easing.cubic))} style={styles.panel}>
      <View style={styles.head}>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={styles.headSide}>
            <SymbolView name="xmark" tintColor={theme.ink} size={15} weight="semibold" />
          </Pressable>
        ) : (
          <View style={styles.headSide}>
            <Text style={styles.titleLeft}>{title}</Text>
          </View>
        )}
        {onClose ? <Text style={styles.title}>{title}</Text> : <View style={{ flex: 1 }} />}
        <View style={[styles.headSide, { flexDirection: 'row', justifyContent: 'flex-end', gap: 14, alignItems: 'center' }]}>
          {value}
          <Pressable onPress={onDone} hitSlop={10} accessibilityLabel="Done">
            <SymbolView name="checkmark" tintColor={theme.ink} size={17} weight="bold" />
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1 }}>{children}</View>
      {footer}
    </Animated.View>
  );
}

function BottomBar({ items, onBack }: { items: { icon: SymbolName; label: string; onPress: () => void; disabled?: boolean }[]; onBack?: () => void }) {
  return (
    <View style={styles.bottomBar}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={10} style={styles.barBack} accessibilityLabel="Back">
          <SymbolView name="chevron.left" tintColor={theme.ink} size={16} weight="semibold" />
        </Pressable>
      )}
      <View style={styles.barItems}>
        {items.map((it) => (
          <Pressable key={it.label} onPress={it.onPress} disabled={it.disabled} style={[styles.barItem, it.disabled && { opacity: 0.35 }]}>
            <SymbolView name={it.icon} tintColor={theme.ink} size={18} />
            <Text style={styles.barText}>{it.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function CaptionsPanel({
  settings, lines, time, total, focusKey, onChange, onSeek, onStyle, onFormat, onDone,
}: {
  settings: CaptionSettings; lines: CaptionLine[]; time: number; total: number; focusKey?: string;
  onChange: (s: CaptionSettings) => void; onSeek: (t: number) => void; onStyle: () => void; onFormat: () => void; onDone: () => void;
}) {
  const list = useRef<FlatList<CaptionLine>>(null);
  const focusIndex = Math.max(0, lines.findIndex((l) => l.key === focusKey));
  const edited = Object.keys(settings.edits).length > 0;
  return (
    <Panel
      title="Captions"
      value={
        <>
          <Text style={styles.value}>
            {mmss(time)} / {mmss(total)}
          </Text>
          <Switch value={settings.enabled} onValueChange={(enabled) => onChange({ ...settings, enabled })} trackColor={{ true: theme.ink }} />
        </>
      }
      onDone={onDone}
      footer={
        <BottomBar
          items={[
            { icon: 'textformat.size', label: 'Style', onPress: onStyle, disabled: !settings.enabled },
            { icon: 'textformat.abc', label: 'Format', onPress: onFormat, disabled: !settings.enabled },
            { icon: 'arrow.counterclockwise', label: 'Reset', onPress: () => onChange({ ...settings, edits: {} }), disabled: !edited },
          ]}
          onBack={onDone}
        />
      }
    >
      {settings.enabled ? (
        <FlatList
          ref={list}
          data={lines}
          keyExtractor={(l) => `${l.key}-${l.start}-${l.text}`}
          initialScrollIndex={lines.length ? Math.min(focusIndex, lines.length - 1) : undefined}
          getItemLayout={(_, i) => ({ length: 46, offset: 46 * i, index: i })}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable style={styles.lineRow} onPress={() => onSeek(item.start)}>
              <Text style={styles.lineTime}>{mmss(item.start)}</Text>
              <TextInput
                style={styles.lineInput}
                defaultValue={item.text}
                onFocus={() => onSeek(item.start)}
                onEndEditing={(e) => {
                  const text = e.nativeEvent.text.trim();
                  if (text !== item.text) onChange({ ...settings, edits: { ...settings.edits, [item.key]: text } });
                }}
                returnKeyType="done"
                blurOnSubmit
              />
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Captions are off. Turn them on to add them to every word.</Text>
        </View>
      )}
    </Panel>
  );
}

export function StylePicker({ kind, value, onPick, onClose, onDone }: { kind: 'captions' | 'texts'; value: string; onPick: (id: string) => void; onClose: () => void; onDone: () => void }) {
  const styles_ = kind === 'captions' ? CAPTION_STYLES : TEXT_STYLES;
  const groups = kind === 'captions' ? ['Simple', 'Word by word', 'Fun'] : [''];
  return (
    <Panel title="Style" onClose={onClose} onDone={onDone}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        {groups.map((g) => (
          <View key={g} style={{ marginBottom: 6 }}>
            {g ? <Text style={styles.group}>{g}</Text> : null}
            <View style={styles.grid}>
              {styles_.filter((s) => !g || s.group === g).map((s) => (
                <StyleCard key={s.id} preset={s} on={s.id === value} onPress={() => onPick(s.id)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Panel>
  );
}

function StyleCard({ preset, on, onPress }: { preset: StylePreset; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && { transform: [{ scale: 0.97 }] }]}
    >
      <View style={styles.cardPreview}>
        <StyledText preset={preset} words={['Make', 'it', 'pop']} active={1} frameWidth={150} scale={1.05} />
      </View>
      <Text style={styles.cardName}>{preset.name}</Text>
    </Pressable>
  );
}

const CAPS: { value: Caps; label: string; icon?: SymbolName }[] = [
  { value: 'none', label: '', icon: 'nosign' },
  { value: 'upper', label: 'TT' },
  { value: 'lower', label: 'tt' },
  { value: 'title', label: 'Tt' },
];

export function FormatPanel({ settings, onChange, onClose, onDone }: { settings: CaptionSettings; onChange: (s: CaptionSettings) => void; onClose: () => void; onDone: () => void }) {
  return (
    <Panel title="Format" onClose={onClose} onDone={onDone}>
      <View style={{ padding: 16, gap: 22 }}>
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Capitalization</Text>
          <View style={styles.capsRow}>
            {CAPS.map((c) => (
              <Pressable key={c.value} onPress={() => onChange({ ...settings, caps: c.value })} style={[styles.capsBtn, settings.caps === c.value && styles.capsOn]} accessibilityLabel={c.value === 'none' ? 'As spoken' : c.label}>
                {c.icon ? <SymbolView name={c.icon} tintColor={settings.caps === c.value ? '#fff' : theme.ink} size={15} /> : <Text style={[styles.capsText, settings.caps === c.value && { color: '#fff' }]}>{c.label}</Text>}
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Look</Text>
          <View style={styles.capsRow}>
            {(['outline', 'box', 'plain'] as Frame[]).map((f) => {
              const on = frameOf(captionStyle(settings.style), settings) === f;
              return (
                <Pressable key={f} onPress={() => onChange({ ...settings, ...lookFor(f) })} style={[styles.capsBtn, on && styles.capsOn]}>
                  <Text style={[styles.lookText, on && { color: '#fff' }]}>{f === 'outline' ? 'Outline' : f === 'box' ? 'Background' : 'Plain'}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.between}>
          <Text style={styles.label}>Show punctuation</Text>
          <Switch value={settings.punctuation} onValueChange={(punctuation) => onChange({ ...settings, punctuation })} trackColor={{ true: theme.ink }} />
        </View>
        <View style={{ gap: 4 }}>
          <View style={styles.between}>
            <Text style={styles.label}>Words at a time</Text>
            <Text style={styles.value}>
              {settings.wordsPerLine} word{settings.wordsPerLine === 1 ? '' : 's'} at a time
            </Text>
          </View>
          <Slider
            minimumValue={1}
            maximumValue={9}
            step={1}
            value={settings.wordsPerLine}
            onValueChange={(v) => {
              if (v !== settings.wordsPerLine) Haptics.selectionAsync();
            }}
            onSlidingComplete={(wordsPerLine) => onChange({ ...settings, wordsPerLine: Math.round(wordsPerLine) })}
            minimumTrackTintColor={theme.ink}
          />
          <View style={styles.between}>
            <Text style={styles.small}>1</Text>
            <Text style={styles.small}>9</Text>
          </View>
        </View>
      </View>
    </Panel>
  );
}

export function SizePanel({ scale, onChange, onDone }: { scale: number; onChange: (v: number) => void; onDone: () => void }) {
  const [v, setV] = useState(scale);
  return (
    <Panel title="Size" value={<Text style={styles.valueStrong}>{Math.round(v * 100)}%</Text>} onDone={onDone}>
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <View style={styles.sliderRow}>
          <SymbolView name="textformat.size.smaller" tintColor={theme.muted} size={15} />
          <Slider style={{ flex: 1 }} minimumValue={0.5} maximumValue={2.5} step={0.05} value={scale} onValueChange={setV} onSlidingComplete={onChange} minimumTrackTintColor={theme.ink} />
          <SymbolView name="textformat.size.larger" tintColor={theme.muted} size={18} />
        </View>
      </View>
    </Panel>
  );
}

export function VolumePanel({ volume, clipLabel, onChange, onAll, onDone }: { volume: number; clipLabel: string; onChange: (v: number) => void; onAll: () => void; onDone: () => void }) {
  const [v, setV] = useState(volume);
  return (
    <Panel title="Volume" value={<Text style={styles.valueStrong}>{Math.round(v * 100)}%</Text>} onDone={onDone}>
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Text style={styles.small}>{clipLabel}</Text>
        <View style={styles.sliderRow}>
          <SymbolView name="speaker.fill" tintColor={theme.muted} size={14} />
          <Text style={styles.small}>0%</Text>
          <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={2} step={0.05} value={volume} onValueChange={setV} onSlidingComplete={onChange} minimumTrackTintColor={theme.ink} />
          <Text style={styles.small}>200%</Text>
        </View>
        <Pressable onPress={onAll} style={styles.pill}>
          <SymbolView name="square.stack.3d.up" tintColor={theme.ink} size={14} />
          <Text style={styles.pillText}>Apply to all clips</Text>
        </Pressable>
      </View>
    </Panel>
  );
}

const SPEEDS = [1, 1.15, 1.25, 1.5, 1.75, 2];

export function SpeedPanel({ speed, length, onChange, onDone }: { speed: number; length: number; onChange: (v: number) => void; onDone: () => void }) {
  const [v, setV] = useState(speed);
  const pick = (s: number) => {
    Haptics.selectionAsync();
    setV(s);
    onChange(s);
  };
  return (
    <Panel title="Speed" value={<Text style={styles.valueStrong}>{v}x</Text>} onDone={onDone}
      footer={<BottomBar items={[{ icon: 'arrow.counterclockwise', label: 'Reset', onPress: () => pick(1), disabled: v === 1 }]} />}
    >
      <View style={{ paddingHorizontal: 16, gap: 14 }}>
        <Text style={styles.small}>
          {mmss((length * speed) / v)} at {v}x
        </Text>
        <View style={styles.speedRow}>
          {SPEEDS.map((s) => (
            <Pressable key={s} onPress={() => pick(s)} style={[styles.speedBtn, v === s && styles.capsOn]}>
              <Text style={[styles.speedText, v === s && { color: '#fff' }]}>{s}x</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.sliderRow}>
          <Text style={styles.small}>0.5x</Text>
          <Slider style={{ flex: 1 }} minimumValue={0.5} maximumValue={4} step={0.05} value={speed} onValueChange={(x) => setV(Math.round(x * 100) / 100)} onSlidingComplete={(x) => onChange(Math.round(x * 100) / 100)} minimumTrackTintColor={theme.ink} />
          <Text style={styles.small}>4x</Text>
        </View>
      </View>
    </Panel>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.hint} pointerEvents="none">
      <SymbolView name="hand.tap" tintColor={theme.ink} size={13} />
      <Text style={styles.hintText}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, backgroundColor: theme.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 50, borderBottomWidth: 1, borderBottomColor: theme.line },
  headSide: { minWidth: 70 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: theme.ink },
  titleLeft: { fontSize: 17, fontWeight: '700', color: theme.ink },
  value: { fontSize: 12, color: theme.muted, fontVariant: ['tabular-nums'] },
  valueStrong: { fontSize: 16, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  bottomBar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.line, paddingTop: 8, paddingBottom: 6, paddingHorizontal: 12 },
  barBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  barItems: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 34 },
  barItem: { alignItems: 'center', gap: 3 },
  barText: { fontSize: 10, color: theme.ink, fontWeight: '500' },
  lineRow: { flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: 16, gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  lineTime: { width: 38, fontSize: 12, color: theme.faint, fontVariant: ['tabular-nums'] },
  lineInput: { flex: 1, fontSize: 15, color: theme.ink, paddingVertical: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyText: { fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20 },
  group: { fontSize: 13, fontWeight: '600', color: theme.muted, marginBottom: 8, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '48%', borderRadius: 14, borderWidth: 2, borderColor: 'transparent', backgroundColor: theme.card, overflow: 'hidden' },
  cardOn: { borderColor: theme.ink },
  cardPreview: { height: 70, backgroundColor: '#2A2A2E', alignItems: 'center', justifyContent: 'center', margin: 6, borderRadius: 10, overflow: 'hidden' },
  cardName: { fontSize: 11, color: theme.muted, textAlign: 'center', marginBottom: 7 },
  label: { fontSize: 15, fontWeight: '600', color: theme.ink },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  small: { fontSize: 12, color: theme.muted, fontVariant: ['tabular-nums'] },
  capsRow: { flexDirection: 'row', gap: 10 },
  capsBtn: { flex: 1, height: 42, borderRadius: 12, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  capsOn: { backgroundColor: theme.ink },
  lookText: { fontSize: 13, fontWeight: '600', color: theme.ink },
  capsText: { fontSize: 15, fontWeight: '700', color: theme.ink },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: theme.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginTop: 6 },
  pillText: { fontSize: 13, fontWeight: '600', color: theme.ink },
  speedRow: { flexDirection: 'row', justifyContent: 'space-between' },
  speedBtn: { width: 50, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  speedText: { fontSize: 13, fontWeight: '700', color: theme.ink },
  hint: { position: 'absolute', top: 6, alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, zIndex: 5 },
  hintText: { fontSize: 12, color: theme.ink },
});
