import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { autoServerUrl, checkServer, openLegal } from '../lib/api';
import { useAuth } from '../lib/auth';
import { updateSettings, useSettings } from '../lib/store';
import { column, COLUMN, theme } from '../lib/theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { account, signOut, updateProfile, deleteAccount } = useAuth();
  const profile = account?.profile ?? {};
  const settings = useSettings();
  const [serverStatus, setServerStatus] = useState<string | null>(null);

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, your takes and your cuts, on our server and on this device. Videos you already saved to Photos stay there.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () =>
            deleteAccount().catch((e) => Alert.alert('Couldn’t delete your account', e instanceof Error ? e.message : String(e))),
        },
      ]
    );
  }

  async function test() {
    setServerStatus('Checking…');
    try {
      setServerStatus((await checkServer()) ? 'Connected' : 'The server answered with an error');
    } catch (e) {
      setServerStatus(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Text style={styles.title}>Settings</Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[{ paddingHorizontal: 18, paddingBottom: insets.bottom + 30 }, column(COLUMN + 36)]}>
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
          <Row label="Remove retakes" value={settings.removeRetakes} onChange={(v) => updateSettings({ removeRetakes: v })} />
          <Row label="Captions on new cuts" value={settings.captions} onChange={(v) => updateSettings({ captions: v })} last />
        </View>
        <Text style={styles.foot}>Lower pause = snappier edit. With retakes on, when you say a line again Autocut keeps your last take.</Text>

        <Text style={styles.label}>Recording</Text>
        <View style={styles.group}>
          <Row label="Mirror selfie videos" value={settings.mirrorSelfie} onChange={(v) => updateSettings({ mirrorSelfie: v })} />
          <Pressable style={[styles.item, styles.last]} onPress={() => updateProfile({ language: profile.language === 'es' ? 'en' : 'es' })}>
            <Text style={styles.text}>I record in</Text>
            <Text style={[styles.value, { color: theme.accent }]}>{profile.language === 'es' ? 'Español' : 'English'}</Text>
          </Pressable>
        </View>

        <Text style={styles.foot}>Off: selfie videos come out the way others see you, so text reads the right way round. On: they stay mirrored like the camera preview.</Text>

        {__DEV__ && (
          <>
            <Text style={styles.label}>Server (development)</Text>
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
                  accessibilityLabel="Server address"
                />
                <Pressable onPress={test} style={{ alignSelf: 'flex-start' }} hitSlop={6}>
                  <Text style={styles.link}>Test connection</Text>
                </Pressable>
                {serverStatus && <Text style={styles.status}>{serverStatus}</Text>}
              </View>
            </View>
            <Text style={styles.foot}>Leave empty to use the Mac running Expo. Your takes are cut there and come back to this phone.</Text>
          </>
        )}

        <Text style={styles.label}>Legal</Text>
        <View style={styles.group}>
          <Pressable style={styles.item} onPress={() => openLegal('privacy')}>
            <Text style={styles.text}>Privacy Policy</Text>
            <Text style={styles.value}>›</Text>
          </Pressable>
          <Pressable style={[styles.item, styles.last]} onPress={() => openLegal('terms')}>
            <Text style={styles.text}>Terms of Service</Text>
            <Text style={styles.value}>›</Text>
          </Pressable>
        </View>

        <View style={[styles.group, { marginTop: 24 }]}>
          <Pressable style={styles.item} onPress={signOut}>
            <Text style={[styles.text, { color: '#D93B3B' }]}>Sign out</Text>
            <Text style={styles.value}>{account?.email ?? 'dev mode'}</Text>
          </Pressable>
          <Pressable style={[styles.item, styles.last]} onPress={confirmDelete}>
            <Text style={[styles.text, { color: '#D93B3B' }]}>Delete account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.item, last && styles.last]}>
      <Text style={styles.text}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.ink }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: theme.ink },
  done: { fontSize: 16, fontWeight: '600', color: theme.accent },
  label: { fontSize: 12, color: theme.faint, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 6, marginLeft: 6 },
  group: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.line, gap: 12 },
  last: { borderBottomWidth: 0 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  text: { fontSize: 15, color: theme.ink, flexShrink: 1 },
  value: { fontSize: 15, color: theme.faint, fontVariant: ['tabular-nums'] },
  foot: { fontSize: 12, color: theme.faint, marginTop: 6, marginHorizontal: 6, lineHeight: 17 },
  input: { fontSize: 15, color: theme.ink, backgroundColor: theme.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  link: { color: theme.accent, fontSize: 15, fontWeight: '600' },
  status: { fontSize: 13, color: theme.muted, lineHeight: 18 },
});
