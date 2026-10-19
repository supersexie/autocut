import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportedVideos } from '../../components/ExportedVideos';
import { Card, listStyles, Meter, RoundButton } from '../../components/list';
import { TAB_BAR_HEIGHT } from '../../components/tabBar';
import { Button, Wash } from '../../components/ui';
import { displayName, initialsOf, useAuth } from '../../lib/auth';
import { useCuts } from '../../lib/store';
import { column, COLUMN, theme } from '../../lib/theme';
import { usageLine, useUsage } from '../../lib/usage';
import { UI_FONT } from '../../lib/fonts';

const DEVICE = Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone';

export default function YouScreen() {
  const insets = useSafeAreaInsets();
  const { account } = useAuth();
  const cuts = useCuts();
  const { plan, used, limit, resets } = useUsage();
  const profile = account?.profile ?? {};
  const name = displayName(account);
  const initials = initialsOf(name);
  const since = account && `Since ${new Date(account.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  const exported = cuts.reduce((t, c) => t + c.exports, 0);
  const made = cuts.filter((c) => c.status === 'ready').length;

  return (
    <View style={styles.screen}>
      <Wash />
      <ScrollView contentContainerStyle={[{ paddingTop: insets.top + 6, paddingBottom: TAB_BAR_HEIGHT + 60, paddingHorizontal: 18 }, column(COLUMN + 36)]}>
        <View style={styles.top}>
          <RoundButton icon="gearshape" label="Settings" onPress={() => router.push('/settings')} />
        </View>
        <Text style={styles.h1} numberOfLines={2}>
          {name}
        </Text>

        <View style={styles.profile}>
          <View style={[listStyles.avatar, { width: 52, height: 52 }]}>
            <Text style={[listStyles.avatarText, { fontSize: 18, ...UI_FONT.semibold }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.handle} numberOfLines={1}>
              {profile.handle ? `@${profile.handle}` : (account?.email ?? '')}
            </Text>
            {since && <Text style={styles.sub}>{since}</Text>}
          </View>
        </View>

        <Card style={styles.pad}>
          <View style={styles.between}>
            <Text style={styles.plan}>
              {plan.name} <Text style={styles.tag}>Beta</Text>
            </Text>
            <Pressable onPress={() => router.push('/plan')} hitSlop={8} style={styles.manage}>
              <Text style={styles.link}>Manage</Text>
              <SymbolView name="chevron.right" tintColor={theme.ink} size={11} weight="semibold" />
            </Pressable>
          </View>
          <Text style={styles.small}>Free while Autocut is in beta · Edits reset {resets}</Text>
          <View style={styles.divider} />
          <Text style={styles.usage}>{usageLine(used, limit)}</Text>
          {limit !== Infinity && <Meter fraction={used / limit} />}
        </Card>

        <Card style={[styles.pad, { marginTop: 12 }]}>
          <View style={styles.between}>
            <Text style={styles.cardTitle}>Your stats</Text>
            <Pressable
              hitSlop={10}
              accessibilityLabel="About your stats"
              onPress={() => Alert.alert('Your stats', `Counted on this ${DEVICE}. Cuts made are the takes Autocut has finished cutting; videos exported are the finished videos you've saved or shared.`)}
            >
              <SymbolView name="info.circle" tintColor={theme.muted} size={18} />
            </Pressable>
          </View>
          <View style={styles.stats}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statValue, { color: theme.blue }]}>{exported}</Text>
              <Text style={styles.statLabel}>Videos exported</Text>
              <Text style={styles.statNote}>From this {DEVICE}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statValue, { color: theme.blue }]}>{made}</Text>
              <Text style={styles.statLabel}>Cuts made</Text>
            </View>
          </View>
        </Card>

        <ExportedVideos cuts={cuts} />

        {cuts.length === 0 && (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <SymbolView name="film.stack" tintColor={theme.muted} size={26} />
            </View>
            <Text style={styles.emptyTitle}>Your <Text style={{ color: theme.blue }}>cuts</Text> show up here</Text>
            <Text style={styles.emptyBody}>Record a few takes and Autocut turns them into a post-ready cut.</Text>
            <Button kind="outline" title="Start recording" onPress={() => router.navigate('/')} style={{ paddingHorizontal: 26, minHeight: 46 }} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  top: { flexDirection: 'row', justifyContent: 'flex-end', height: 44 },
  h1: { fontSize: 34, ...UI_FONT.extrabold, color: theme.ink, letterSpacing: -0.6 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14, marginBottom: 20 },
  handle: { fontSize: 16, ...UI_FONT.semibold, color: theme.ink },
  sub: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted, marginTop: 3 },
  pad: { padding: 16 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plan: { fontSize: 22, ...UI_FONT.extrabold, color: theme.ink },
  tag: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  link: { fontSize: 15, ...UI_FONT.semibold, color: theme.ink },
  small: { fontSize: 13, ...UI_FONT.semibold, color: theme.muted, marginTop: 6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginVertical: 14 },
  usage: { fontSize: 16, ...UI_FONT.semibold, color: theme.ink, fontVariant: ['tabular-nums'] },
  cardTitle: { fontSize: 18, ...UI_FONT.bold, color: theme.ink },
  stats: { flexDirection: 'row', marginTop: 16 },
  statValue: { fontSize: 24, ...UI_FONT.bold, color: theme.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 15, ...UI_FONT.semibold, color: theme.ink, marginTop: 2 },
  statNote: { fontSize: 12, ...UI_FONT.semibold, color: theme.muted, marginTop: 2 },
  empty: { alignItems: 'center', gap: 8, marginTop: 44, paddingHorizontal: 20 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 18, ...UI_FONT.bold, color: theme.ink },
  emptyBody: { fontSize: 14, ...UI_FONT.semibold, color: theme.muted, textAlign: 'center', lineHeight: 20, marginBottom: 10 },
});
