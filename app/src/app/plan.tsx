import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Footnote, Meter, PageHeader, Row } from '../components/list';
import { Button, Wash } from '../components/ui';
import { useAuth } from '../lib/auth';
import { MANAGE_APPLE_URL, MANAGE_WHOP_URL, PAYMENTS_ON, restore } from '../lib/billing';
import { FEATURES, planFor } from '../lib/plans';
import { column, COLUMN, theme } from '../lib/theme';
import { usageLine, useUsage } from '../lib/usage';

/** "Your plan": the plan, this month's edits, and changing it. */
export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const { plan, used, limit, left, resets } = useUsage();
  const { account, updateProfile } = useAuth();
  const [restoring, setRestoring] = useState(false);

  async function restorePurchases() {
    if (!PAYMENTS_ON) return Alert.alert('Nothing to restore', 'Autocut is free during the beta, so there are no purchases to bring back yet.');
    if (!account) return;
    setRestoring(true);
    try {
      const paid = await restore(account.id);
      if (paid) {
        await updateProfile({ plan: paid });
        Alert.alert('Restored', `You’re on ${planFor(paid).name}.`);
      } else Alert.alert('Nothing to restore', 'We couldn’t find a plan on this account. If you paid on the web, sign in with the same email you used there.');
    } catch (e) {
      Alert.alert('Couldn’t restore', e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  }

  // Subscriptions are changed or cancelled where they were bought.
  const manage = () =>
    Alert.alert('Manage subscription', 'Where did you subscribe?', [
      { text: 'In the App Store', onPress: () => Linking.openURL(MANAGE_APPLE_URL) },
      { text: 'On the web (Whop)', onPress: () => Linking.openURL(MANAGE_WHOP_URL) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={styles.screen}>
      <Wash />
      <PageHeader title="Your plan" />
      <ScrollView contentContainerStyle={[{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: insets.bottom + 30 }, column(COLUMN + 36)]}>
        <Card style={styles.pad}>
          <Text style={styles.plan}>
            {plan.name} {!PAYMENTS_ON && <Text style={styles.tag}>Beta</Text>}
          </Text>
          <Text style={styles.line}>{plan.edits}</Text>
          {!PAYMENTS_ON && <Text style={styles.small}>Free while Autocut is in beta. You won’t be charged.</Text>}
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
          {PAYMENTS_ON && <Row label="Manage subscription" onPress={manage} />}
          <Row label={restoring ? 'Restoring…' : 'Restore purchases'} muted last onPress={restoring ? undefined : restorePurchases} />
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
