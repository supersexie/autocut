import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Footnote, Meter, PageHeader, Row } from '../components/list';
import { Button } from '../components/ui';
import { FEATURES } from '../lib/plans';
import { column, COLUMN, theme } from '../lib/theme';
import { usageLine, useUsage } from '../lib/usage';

/** "Your plan": the plan, this month's edits, and changing it. */
export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const { plan, used, limit, left, resets } = useUsage();

  return (
    <View style={styles.screen}>
      <PageHeader title="Your plan" />
      <ScrollView contentContainerStyle={[{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: insets.bottom + 30 }, column(COLUMN + 36)]}>
        <Card style={styles.pad}>
          <Text style={styles.plan}>
            {plan.name} <Text style={styles.tag}>Beta</Text>
          </Text>
          <Text style={styles.line}>{plan.edits}</Text>
          <Text style={styles.small}>Free while Autocut is in beta. You won’t be charged.</Text>
          <Button title="Change plan" onPress={() => router.push('/change-plan')} style={{ marginTop: 16 }} />
        </Card>

        <Card style={[styles.pad, { marginTop: 12 }]}>
          <Text style={styles.usage}>{usageLine(used, limit)}</Text>
          {limit !== Infinity && <Meter fraction={used / limit} />}
          <Text style={[styles.small, { marginTop: 10 }]}>{limit === Infinity ? 'Unlimited edits' : `${left} left this month`} · Resets {resets}</Text>
        </Card>

        {/* What this plan includes, and what the bigger ones add. */}
        <Card style={[styles.pad, { marginTop: 12, gap: 12 }]}>
          <Text style={styles.included}>Included</Text>
          {[{ label: plan.edits, has: true }, { label: 'Captions on every word', has: true }, ...FEATURES.map((f) => ({ label: f, has: plan.features.includes(f) }))].map((f) => (
            <View key={f.label} style={styles.feature}>
              <SymbolView name={f.has ? 'checkmark.circle.fill' : 'lock.fill'} tintColor={f.has ? theme.ink : theme.faint} size={f.has ? 18 : 14} style={{ width: 20 }} />
              <Text style={[styles.featureText, !f.has && { color: theme.faint }]}>{f.label}</Text>
              {!f.has && <Text style={styles.upgrade}>Pro and Ultimate</Text>}
            </View>
          ))}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <Row
            label="Restore purchases"
            muted
            last
            onPress={() => Alert.alert('Nothing to restore', 'Autocut is free during the beta, so there are no purchases to bring back yet.')}
          />
        </Card>
        <Footnote center>Changes made in the App Store can take up to 24 hours to show here.</Footnote>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  pad: { padding: 18 },
  plan: { fontSize: 30, fontWeight: '800', color: theme.ink, letterSpacing: -0.5 },
  tag: { fontSize: 16, fontWeight: '500', color: theme.muted },
  line: { fontSize: 16, color: theme.ink, marginTop: 6 },
  small: { fontSize: 14, color: theme.muted, marginTop: 3 },
  included: { fontSize: 13, fontWeight: '700', color: theme.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { flex: 1, fontSize: 15, color: theme.ink },
  upgrade: { fontSize: 12, fontWeight: '600', color: theme.muted },
  usage: { fontSize: 17, fontWeight: '600', color: theme.ink, fontVariant: ['tabular-nums'] },
});
