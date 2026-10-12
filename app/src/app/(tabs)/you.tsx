import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { autoServerUrl, checkServer, serverUrl } from '../../lib/api';
import { updateSettings, useCuts, useSettings } from '../../lib/store';
import { formatTime, theme } from '../../lib/theme';

export default function YouScreen() {
  const settings = useSettings();
  const cuts = useCuts();
  const insets = useSafeAreaInsets();
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const saved = cuts.reduce((t, c) => t + c.duration - c.keptDuration, 0);

  async function test() {
    setServerStatus('Checking…');
    try {
      setServerStatus((await checkServer(serverUrl(settings))) ? 'Connected' : 'Server answered with an error');
    } catch (e) {
      setServerStatus(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40, paddingHorizontal: 18 }}>
      <Text style={styles.h1}>You</Text>

      <Text style={styles.label}>Cutting</Text>
      <View style={styles.group}>
        <View style={[styles.item, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
          <View style={styles.between}>
            <Text style={styles.text}>Longest pause to keep</Text>
            <Text style={styles.value}>{settings.maxGap.toFixed(2)}s</Text>
          </View>
          <Slider
            minimumValue={0.15}
            maximumValue={0.8}
            step={0.05}
            value={settings.maxGap}
            onSlidingComplete={(v) => updateSettings({ maxGap: Math.round(v * 100) / 100 })}
            minimumTrackTintColor={theme.accent}
          />
        </View>
        <Row label="Remove ums and uhs" value={settings.removeFillers} onChange={(v) => updateSettings({ removeFillers: v })} />
        <Row label="Remove retakes" value={settings.removeRetakes} onChange={(v) => updateSettings({ removeRetakes: v })} last />
      </View>
      <Text style={styles.foot}>Lower pause = snappier edit. With retakes on, when you say a line again Autocut keeps your last take. Applies to new cuts.</Text>

      <Text style={styles.label}>Captions</Text>
      <View style={styles.group}>
        <Row label="Burn captions into the video" value={settings.captions} onChange={(v) => updateSettings({ captions: v })} last />
      </View>

      <Text style={styles.label}>Stats</Text>
      <View style={styles.group}>
        <View style={styles.item}><Text style={styles.text}>Cuts made</Text><Text style={styles.value}>{cuts.length}</Text></View>
        <View style={[styles.item, styles.last]}><Text style={styles.text}>Time saved</Text><Text style={styles.value}>{formatTime(saved)}</Text></View>
      </View>

      <Text style={styles.label}>Server</Text>
      <View style={styles.group}>
        <View style={[styles.item, styles.last, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
          <TextInput
            style={styles.input}
            value={settings.serverUrl}
            onChangeText={(serverUrl) => updateSettings({ serverUrl })}
            placeholder={autoServerUrl()}
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Pressable onPress={test} style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.7 }]}>
            <Text style={styles.testText}>Test connection</Text>
          </Pressable>
          {serverStatus && <Text style={styles.status}>{serverStatus}</Text>}
        </View>
      </View>
      <Text style={styles.foot}>Leave empty to use the Mac running Expo. Your takes are cut there and saved back to this phone.</Text>
    </ScrollView>
  );
}

function Row({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.item, last && styles.last]}>
      <Text style={styles.text}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  h1: { fontSize: 32, fontWeight: '800', color: theme.ink, marginBottom: 4 },
  label: { fontSize: 12, color: theme.faint, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 6, marginLeft: 6 },
  group: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.line, gap: 12 },
  last: { borderBottomWidth: 0 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  text: { fontSize: 15, color: theme.ink, flexShrink: 1 },
  value: { fontSize: 15, color: theme.faint, fontVariant: ['tabular-nums'] },
  foot: { fontSize: 12, color: theme.faint, marginTop: 6, marginHorizontal: 6, lineHeight: 17 },
  input: { fontSize: 15, color: theme.ink, backgroundColor: theme.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  testBtn: { alignSelf: 'flex-start' },
  testText: { color: theme.accent, fontSize: 15, fontWeight: '600' },
  status: { fontSize: 13, color: theme.muted, lineHeight: 18 },
});
