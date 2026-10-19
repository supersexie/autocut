import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Field, Wash } from '../components/ui';
import { displayName, useAuth } from '../lib/auth';
import { theme } from '../lib/theme';
import { UI_FONT } from '../lib/fonts';

/** Name and TikTok handle, from Settings › Edit. */
export default function EditProfile() {
  const { account, updateProfile } = useAuth();
  const profile = account?.profile ?? {};
  // Start from the name we show (made from the email when they haven't set one).
  const [suggestedFirst, ...suggestedRest] = displayName(account) === 'Creator' ? [''] : displayName(account).split(' ');
  const [firstName, setFirstName] = useState(profile.firstName ?? suggestedFirst ?? '');
  const [lastName, setLastName] = useState(profile.lastName ?? suggestedRest.join(' '));
  const [handle, setHandle] = useState(profile.handle ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateProfile({ firstName: firstName.trim(), lastName: lastName.trim(), handle: handle.trim().replace(/^@/, '') });
      router.back();
    } catch (e) {
      setSaving(false);
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={styles.sheet}>
      <Wash />
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Edit <Text style={{ color: theme.blue }}>profile</Text></Text>
        <Pressable onPress={save} disabled={saving || !firstName.trim()} hitSlop={10}>
          <Text style={[styles.save, (saving || !firstName.trim()) && { color: theme.faint }]}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Field label="First name" value={firstName} onChangeText={setFirstName} autoFocus autoCapitalize="words" textContentType="givenName" returnKeyType="next" />
        <Field label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" textContentType="familyName" returnKeyType="next" />
        <Field label="TikTok handle" prefix="@" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={save} />
        <Text style={styles.email}>Signed in as {account?.email ?? 'nobody'}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#fff' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 },
  title: { fontSize: 17, ...UI_FONT.semibold, color: theme.ink },
  cancel: { fontSize: 16, ...UI_FONT.medium, color: theme.muted },
  save: { fontSize: 16, ...UI_FONT.bold, color: theme.ink },
  body: { padding: 18, gap: 16 },
  email: { fontSize: 13, ...UI_FONT.medium, color: theme.muted, marginTop: 4 },
});
