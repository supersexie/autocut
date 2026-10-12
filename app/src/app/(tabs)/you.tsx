import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { useAuth } from '../../lib/auth';
import { PLANS } from '../../lib/plans';
import { clipsDuration, useCuts } from '../../lib/store';
import { theme } from '../../lib/theme';

const LIMITS: Record<string, number> = { starter: 100, pro: 300, ultimate: Infinity };

export default function YouScreen() {
  const insets = useSafeAreaInsets();
  const { account, updateProfile } = useAuth();
  const cuts = useCuts();
  const profile = account?.profile ?? {};
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Your studio';
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const plan = PLANS.find((p) => p.id === profile.plan);

  const now = new Date();
  const thisMonth = cuts.filter((c) => {
    const d = new Date(c.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const limit = LIMITS[profile.plan ?? 'starter'];

  const ready = cuts.filter((c) => c.status === 'ready');
  const footage = ready.reduce((t, c) => t + c.duration, 0);
  const kept = ready.reduce((t, c) => t + clipsDuration(c.clips), 0);
  const trims = ready.reduce((t, c) => t + c.cuts.length, 0);
  const exported = ready.reduce((t, c) => t + c.exports, 0);
  // Rough rule of thumb: trimming by hand takes about 3 minutes per minute of raw footage.
  const savedMinutes = Math.round((footage * 3) / 60);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: TAB_BAR_HEIGHT + 60, paddingHorizontal: 18 }}>
      <View style={styles.header}>
        <Text style={styles.h1}>You</Text>
        <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel="Settings" style={styles.gear}>
          <SymbolView name="gearshape" tintColor={theme.ink} size={18} />
        </Pressable>
      </View>

      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.sub}>
            {[profile.handle && `@${profile.handle}`, account && `Since ${new Date(account.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.between}>
          <Text style={styles.planName}>{plan?.name ?? 'No plan'}</Text>
          <Pressable onPress={() => updateProfile({ onboarded: false })} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text style={styles.link}>Manage</Text>
            <SymbolView name="chevron.right" tintColor={theme.accent} size={11} />
          </Pressable>
        </View>
        <Text style={styles.small}>Payments aren’t connected yet, so nothing is charged.</Text>
        <View style={styles.divider} />
        <View style={styles.between}>
          <Text style={styles.text}>
            {thisMonth} of {limit === Infinity ? 'unlimited' : limit} edits used
          </Text>
          <Text style={styles.small}>Resets {resets}</Text>
        </View>
        {limit !== Infinity && (
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${Math.min(100, (thisMonth / limit) * 100)}%` }]} />
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Your stats</Text>
        <Text style={styles.big}>{savedMinutes} min</Text>
        <Text style={styles.small}>saved vs cutting it yourself (estimate)</Text>
        <Text style={styles.small}>
          {Math.round(footage)} sec of footage · {Math.round(footage - kept)} sec trimmed · {trims} cuts
        </Text>
        <View style={styles.divider} />
        <View style={styles.statsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statValue}>{exported || 'None yet'}</Text>
            <Text style={styles.small}>Videos exported</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statValue}>{ready.length}</Text>
            <Text style={styles.small}>Cuts made</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { fontSize: 32, fontWeight: '800', color: theme.ink },
  gear: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 18 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(61,133,245,0.14)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 19, fontWeight: '700', color: theme.accent },
  name: { fontSize: 22, fontWeight: '800', color: theme.ink },
  sub: { fontSize: 13, color: theme.muted, marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 4, marginBottom: 12 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { fontSize: 18, fontWeight: '700', color: theme.ink },
  link: { fontSize: 14, fontWeight: '600', color: theme.accent },
  divider: { height: 1, backgroundColor: theme.line, marginVertical: 10 },
  text: { fontSize: 14, color: theme.ink, fontVariant: ['tabular-nums'] },
  small: { fontSize: 12, color: theme.muted, fontVariant: ['tabular-nums'] },
  meter: { height: 6, borderRadius: 3, backgroundColor: theme.line, overflow: 'hidden', marginTop: 8 },
  meterFill: { height: 6, backgroundColor: theme.accent },
  cardLabel: { fontSize: 14, fontWeight: '700', color: theme.ink, marginBottom: 6 },
  big: { fontSize: 34, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  statsRow: { flexDirection: 'row' },
  statValue: { fontSize: 17, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
});
