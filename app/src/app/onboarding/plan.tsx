import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Backdrop, Button, ErrorText, Logo, Segmented } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { FEATURES, money, PLANS, pricePerMonth, YEARLY_DISCOUNT, type Billing, type PlanId } from '../../lib/plans';
import { theme } from '../../lib/theme';

export default function PlanStep() {
  const { updateProfile, signOut } = useAuth();
  const [billing, setBilling] = useState<Billing>('monthly');
  const [plan, setPlan] = useState<PlanId>('pro');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = PLANS.find((p) => p.id === plan)!;
  const price = pricePerMonth(chosen.monthly, billing);

  async function start() {
    setSaving(true);
    setError(null);
    try {
      // Payments are not connected yet: record the choice and open the app.
      await updateProfile({ plan, billing, onboarded: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <Backdrop
      footer={
        <>
          <ErrorText>{error}</ErrorText>
          <Button
            title={`Continue with ${chosen.name}`}
            icon={null}
            onPress={start}
            loading={saving}
          />
          <Text style={styles.terms}>
            {money(price)} a month{billing === 'yearly' ? ', billed yearly' : ''}. Renews automatically. Cancel anytime.
          </Text>
          <Text style={styles.notConnected}>Payments aren’t connected yet, so you won’t be charged.</Text>
          <View style={styles.links}>
            <Text style={styles.link}>Restore purchases</Text>
            <Text style={styles.link}>Terms of Use</Text>
            <Text style={styles.link}>Privacy Policy</Text>
          </View>
        </>
      }
    >
      <View style={styles.top}>
        <View style={styles.brandRow}>
          <Logo size={26} />
          <Text style={styles.brand}>Autocut</Text>
        </View>
        <Pressable onPress={signOut} hitSlop={10}>
          <Text style={styles.switchAccount}>Switch account</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Choose your plan.</Text>

      <View style={{ marginTop: 18, marginBottom: 14, alignSelf: 'center', width: 240 }}>
        <Segmented
          value={billing}
          onChange={setBilling}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly', badge: `-${Math.round(YEARLY_DISCOUNT * 100)}%` },
          ]}
        />
      </View>

      <View style={{ gap: 12 }}>
        {PLANS.map((p) => {
          const on = p.id === plan;
          return (
            <Pressable
              key={p.id}
              onPress={() => setPlan(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.card, on && styles.cardOn]}
            >
              {p.pick && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>OUR PICK</Text>
                </View>
              )}
              <View style={styles.cardRow}>
                <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>{p.name}</Text>
                  <Text style={styles.edits}>{p.edits}</Text>
                </View>
                <Text style={styles.price}>
                  {money(pricePerMonth(p.monthly, billing))}
                  <Text style={styles.per}> /month</Text>
                </Text>
              </View>
              <View style={styles.features}>
                {FEATURES.map((f) => {
                  const has = p.features.includes(f);
                  return (
                    <View key={f} style={styles.feature}>
                      <SymbolView name={has ? 'checkmark.circle.fill' : 'xmark.circle'} tintColor={has ? theme.accent : '#B8C0CC'} size={14} />
                      <Text style={[styles.featureText, !has && { color: '#9AA3B2' }]}>{f}</Text>
                    </View>
                  );
                })}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { fontSize: 17, fontWeight: '800', color: theme.ink },
  switchAccount: { fontSize: 14, color: theme.accent, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '800', color: theme.ink, textAlign: 'center', letterSpacing: -0.4 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, borderWidth: 1.5, borderColor: '#E1E6EE', gap: 10 },
  cardOn: { borderColor: theme.accent, shadowColor: theme.accent, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  badge: { position: 'absolute', top: -10, alignSelf: 'center', backgroundColor: theme.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#C3CAD5', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: theme.accent },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: theme.accent },
  planName: { fontSize: 17, fontWeight: '700', color: theme.ink },
  edits: { fontSize: 13, color: theme.muted, marginTop: 2 },
  price: { fontSize: 17, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  per: { fontSize: 12, fontWeight: '500', color: theme.faint },
  features: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingLeft: 34 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  featureText: { fontSize: 12, color: theme.ink },
  terms: { fontSize: 12, color: theme.muted, textAlign: 'center' },
  notConnected: { fontSize: 12, color: '#7A5B00', textAlign: 'center' },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  link: { fontSize: 12, color: theme.faint },
});
