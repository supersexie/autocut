import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import { Backdrop, Button, Logo } from '../components/ui';
import { clearDraft } from '../lib/draft';
import { BRAND_FONT } from '../lib/fonts';
import { theme } from '../lib/theme';

// Raw take (seconds) and what Autocut removed, drawn on the mock phone.
const RAW = 70;
const CUTS = [[0, 9], [13, 21], [24, 25], [28, 38], [41, 52], [55, 62], [64, 70]];

export default function Welcome() {
  return (
    <Backdrop
      footer={
        <>
          <Button
            title="Get Started"
            onPress={() => {
              clearDraft(); // a fresh start: no answers left over from an earlier run through setup
              router.push('/setup');
            }}
          />
          <Text style={styles.signIn}>
            Already have an account?{' '}
            <Text style={styles.signInLink} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'sign-in' } })}>
              Sign In
            </Text>
          </Text>
        </>
      }
    >
      <View style={styles.phoneWrap}>
        <View style={styles.phone}>
          <View style={styles.screen}>
            <View style={styles.appBar}>
              <Logo size={18} />
              <Text style={styles.appName}>Autocut</Text>
            </View>
            <View style={styles.video}>
              <SymbolView name="person.fill" tintColor="#4A4A50" size={120} />
              <Text style={styles.caption}>Captions on every word.</Text>
            </View>
            <View style={styles.panel}>
              <View style={styles.row}>
                <View style={styles.okDot} />
                <Text style={styles.ready}>Cut ready</Text>
                <Text style={styles.times}>
                  <Text style={styles.before}>1:10</Text> → 0:17
                </Text>
              </View>
              <View style={styles.track}>
                {CUTS.map(([s, e]) => (
                  <View key={s} style={[styles.cut, { left: `${(s / RAW) * 100}%`, width: `${((e - s) / RAW) * 100}%` }]} />
                ))}
              </View>
              <View style={styles.stats}>
                <Stat value="7" label="cuts" />
                <Stat value="53s" label="removed" />
                <Stat value="2" label="retakes" />
              </View>
            </View>
          </View>
        </View>
      </View>

      <Text style={styles.headline}>Raw take in.{'\n'}Tight cut out.</Text>
    </Backdrop>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  phoneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 20 },
  phone: { width: 236, height: 470, borderRadius: 42, backgroundColor: '#111114', padding: 9, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 30, shadowOffset: { width: 0, height: 16 } },
  screen: { flex: 1, borderRadius: 34, backgroundColor: '#fff', overflow: 'hidden', padding: 12, gap: 10 },
  appBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  appName: { fontSize: 12, fontFamily: BRAND_FONT, color: theme.ink },
  video: { flex: 1, borderRadius: 18, backgroundColor: '#2A2A2E', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 18, gap: 18, overflow: 'hidden' },
  caption: { color: '#fff', fontSize: 15, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 3 },
  panel: { backgroundColor: theme.card, borderRadius: 16, padding: 10, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  okDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.ok },
  ready: { flex: 1, fontSize: 12, fontWeight: '700', color: theme.ink },
  times: { fontSize: 12, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  before: { color: theme.faint, textDecorationLine: 'line-through' },
  track: { height: 7, borderRadius: 4, backgroundColor: theme.ink, overflow: 'hidden' },
  cut: { position: 'absolute', top: 0, bottom: 0, backgroundColor: theme.cut },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 13, fontWeight: '800', color: theme.ink },
  statLabel: { fontSize: 10, color: theme.muted },
  headline: { fontSize: 32, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.6, lineHeight: 38, marginTop: 28, marginBottom: 6 },
  signIn: { fontSize: 14, color: theme.muted, textAlign: 'center', marginTop: 4 },
  signInLink: { color: theme.ink, fontWeight: '700' },
});
