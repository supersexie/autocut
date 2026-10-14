import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as StoreReview from 'expo-store-review';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CuttingSettings } from '../components/CuttingSettings';
import { PressableScale } from '../components/ui';
import { Card, Footnote, listStyles, PageHeader, Row, SectionLabel } from '../components/list';
import { forgetThumbnails } from '../components/Thumb';
import { autoServerUrl, checkServer, openLegal } from '../lib/api';
import { displayName, initialsOf, useAuth } from '../lib/auth';
import { cacheBytes, clearCache, updateSettings, useSettings } from '../lib/store';
import { column, COLUMN, theme } from '../lib/theme';
import { useUsage } from '../lib/usage';

const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
const VERSION = `v${Constants.expoConfig?.version ?? '1.0.0'}${Constants.expoConfig?.ios?.buildNumber ? ` (${Constants.expoConfig.ios.buildNumber})` : ''}`;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { account, signOut, deleteAccount } = useAuth();
  const { plan } = useUsage();
  const settings = useSettings();
  const [cache, setCache] = useState(cacheBytes);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const name = displayName(account);
  const initials = initialsOf(name);

  async function rate() {
    if (await StoreReview.hasAction()) await StoreReview.requestReview();
    else Alert.alert('Thank you!', 'Rating opens here once Autocut is on the App Store.');
  }

  function emptyCache() {
    Alert.alert('Clear the cache?', 'Editor previews and thumbnails are made again when you need them. Your cuts aren’t touched.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          clearCache();
          forgetThumbnails();
          setCache(cacheBytes());
        },
      },
    ]);
  }

  function replayTutorial() {
    updateSettings({ tourDone: false });
    Alert.alert('Tutorial is on', 'The editor tour shows again the next time you open a cut.');
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, your takes and your cuts, on our server and on this device. Videos you already saved to Photos stay there.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => deleteAccount().catch((e) => Alert.alert('Couldn’t delete your account', e instanceof Error ? e.message : String(e))),
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
      <PageHeader title="Settings" />
      <ScrollView contentContainerStyle={[{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: insets.bottom + 30 }, column(COLUMN + 36)]}>
        <Card>
          <View style={styles.profile}>
            <View style={[listStyles.avatar, { width: 50, height: 50 }]}>
              <Text style={[listStyles.avatarText, { fontSize: 17 }]}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.email} numberOfLines={1}>
                {account?.email ?? 'Not signed in'}
              </Text>
            </View>
            <Pressable onPress={() => router.push('/edit-profile')} hitSlop={10}>
              <Text style={styles.edit}>Edit</Text>
            </Pressable>
          </View>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <Row label="Your plan" value={plan.name} onPress={() => router.push('/plan')} last />
        </Card>

        <SectionLabel>Preferences</SectionLabel>
        <Card>
          <Row
            icon="person.crop.square"
            label="Mirror selfie videos"
            right={<Switch value={settings.mirrorSelfie} onValueChange={(mirrorSelfie) => updateSettings({ mirrorSelfie })} trackColor={{ true: theme.ink }} />}
            last
          />
        </Card>
        <Footnote>Off: selfie videos come out the way others see you, so text reads the right way round.</Footnote>

        <SectionLabel>Cutting</SectionLabel>
        <CuttingSettings />

        <SectionLabel>Support</SectionLabel>
        <Card>
          {SUPPORT_EMAIL && <Row icon="envelope" label="Help & contact" detail={SUPPORT_EMAIL} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />}
          <Row icon="star" label="Rate Autocut" onPress={rate} />
          <Row icon="internaldrive" label="Cache" detail={`${(cache / 1e6).toFixed(1)} MB · previews and thumbnails`} onPress={emptyCache} />
          <Row icon="graduationcap" label="Replay tutorial" onPress={replayTutorial} last />
        </Card>

        <SectionLabel>Legal</SectionLabel>
        <Card>
          <Row icon="checkmark.shield" label="Privacy Policy" onPress={() => openLegal('privacy')} />
          <Row icon="doc.text" label="Terms of Service" onPress={() => openLegal('terms')} last />
        </Card>

        {__DEV__ && (
          <>
            <SectionLabel>Server (development)</SectionLabel>
            <Card style={{ padding: 14, gap: 10 }}>
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
                <Text style={styles.devLink}>Test connection</Text>
              </Pressable>
              {serverStatus && <Text style={styles.status}>{serverStatus}</Text>}
            </Card>
            <Footnote>Leave empty to use the Mac running Expo.</Footnote>
          </>
        )}

        <PressableScale onPress={signOut} scaleTo={0.98} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </PressableScale>
        <Text style={styles.version}>{VERSION}</Text>
        <Pressable onPress={confirmDelete} hitSlop={10} style={{ alignSelf: 'center' }}>
          <Text style={styles.delete}>Delete account</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  name: { fontSize: 17, fontWeight: '700', color: theme.ink },
  email: { fontSize: 13, color: theme.muted, marginTop: 2 },
  edit: { fontSize: 15, fontWeight: '600', color: theme.ink },
  input: { fontSize: 15, color: theme.ink, backgroundColor: theme.page, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  devLink: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  status: { fontSize: 13, color: theme.muted, lineHeight: 18 },
  signOut: { marginTop: 30, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: theme.line },
  signOutText: { fontSize: 16, fontWeight: '600', color: theme.ink },
  version: { fontSize: 13, color: theme.faint, textAlign: 'center', marginTop: 22 },
  delete: { fontSize: 15, color: theme.danger, marginTop: 14, fontWeight: '500' },
});
