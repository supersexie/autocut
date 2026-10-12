import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCuts } from '../../lib/store';
import { formatTime, theme } from '../../lib/theme';

export default function CreateScreen() {
  const cuts = useCuts();
  const insets = useSafeAreaInsets();

  async function start(source: 'camera' | 'library') {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      videoMaxDuration: 600,
      cameraType: ImagePicker.CameraType.front,
      quality: 1,
    };
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        return Alert.alert('Camera is off', 'Allow camera access for Autocut in Settings to record a take.');
      }
    }
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    router.push({
      pathname: '/cut/[id]',
      params: { id: 'new', uri: asset.uri, mime: asset.mimeType ?? 'video/quicktime', duration: String((asset.duration ?? 0) / 1000) },
    });
  }

  const latest = cuts[0];
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.logo}>
        <SymbolView name="scissors" tintColor={theme.accent} size={30} weight="semibold" />
      </View>
      <Text style={styles.appName}>Autocut</Text>

      <View style={styles.card}>
        <Text style={styles.title}>Make your first cut</Text>
        <Text style={styles.body}>Film a take or pick one from your camera roll. Autocut trims the dead air, ums and retakes for you.</Text>
        <Pressable style={({ pressed }) => [styles.btn, styles.primary, pressed && styles.pressed]} onPress={() => start('camera')}>
          <SymbolView name="record.circle" tintColor="#fff" size={18} />
          <Text style={[styles.btnText, { color: '#fff' }]}>Record now</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.btn, styles.secondary, pressed && styles.pressed]} onPress={() => start('library')}>
          <SymbolView name="photo.on.rectangle" tintColor={theme.accent} size={18} />
          <Text style={[styles.btnText, { color: theme.accent }]}>Import a video</Text>
        </Pressable>
        <Text style={styles.small}>Your take is cut on your Autocut server, then saved back to this phone.</Text>
      </View>

      {latest && (
        <Text style={styles.last}>
          Last cut: {formatTime(latest.duration)} → {formatTime(latest.keptDuration)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 22, backgroundColor: theme.bgTop },
  logo: {
    width: 64, height: 64, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: theme.accent, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  appName: { fontSize: 22, fontWeight: '800', color: theme.ink, marginTop: -6 },
  card: {
    width: '100%', backgroundColor: theme.card, borderRadius: 24, padding: 22, gap: 12, alignItems: 'stretch',
    shadowColor: '#14284f', shadowOpacity: 0.07, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  title: { fontSize: 17, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 20, color: theme.muted, textAlign: 'center' },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14 },
  primary: { backgroundColor: theme.accent },
  secondary: { backgroundColor: 'rgba(61,133,245,0.12)' },
  pressed: { opacity: 0.7 },
  btnText: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 12, color: theme.faint, textAlign: 'center' },
  last: { fontSize: 13, color: theme.muted, fontVariant: ['tabular-nums'] },
});
