import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ErrorText, Segmented } from '../components/ui';
import { useAuth, type Profile } from '../lib/auth';
import { clearDraft, getDraft } from '../lib/draft';
import { money, PLANS, pricePerMonth, YEARLY_DISCOUNT, type Billing, type PlanId } from '../lib/plans';
import { theme } from '../lib/theme';

const CUTS = [[0, 12], [18, 27], [31, 33], [38, 52], [57, 66], [72, 80], [86, 100]];

/** Last step of setup: pick a plan, then the answers from setup are saved to the account. */
export default function Paywall() {
  const insets = useSafeAreaInsets();
  const { account, updateProfile, signOut } = useAuth();
  const [billing, setBilling] = useState<Billing>('yearly');
  const [plan, setPlan] = useState<PlanId>(account?.profile.plan ?? 'pro');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = PLANS.find((p) => p.id === plan)!;
  const monthly = pricePerMonth(chosen.monthly, billing);

  async function start() {
    setSaving(true);
    setError(null);
    try {
      const d = getDraft();
      const fromSetup: Profile = Object.fromEntries(
        Object.entries({
          firstName: d.firstName?.trim(), lastName: d.lastName?.trim(), handle: d.handle, language: d.language,
          creates: d.creates, perWeek: d.perWeek, heardFrom: d.heardFrom, editTime: d.editTime, blockers: d.blockers,
        }).filter(([, v]) => v !== undefined && v !== '')
      );
      // Payments are not connected yet: save the choice and open the app.
      await updateProfile({ ...fromSetup, plan, billing, onboarded: true });
      clearDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={signOut} hitSlop={10} style={styles.switch}>
            <Text style={styles.switchText}>Switch account</Text>
          </Pressable>
          <Text style={styles.heroTimes}>
            <Text style={styles.heroBefore}>1:10</Text> → 0:17
          </Text>
          <View style={styles.heroTrack}>
            {CUTS.map(([s, e]) => (
              <View key={s} style={[styles.heroCut, { left: `${s}%`, width: `${e - s}%` }]} />
            ))}
          </View>
          <Text style={styles.heroCaption}>Every pause, um and retake, gone.</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>Unlock Autocut to post faster</Text>
          <View style={{ alignSelf: 'center', width: 250, marginBottom: 14 }}>
            <Segmented
              value={billing}
              onChange={setBilling}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly', badge: `-${Math.round(YEARLY_DISCOUNT * 100)}%` },
              ]}
            />
          </View>

          <View style={{ gap: 10 }}>
            {PLANS.map((p) => {
              const on = p.id === plan;
              return (
                <Pressable key={p.id} onPress={() => setPlan(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.plan, on && styles.planOn]}>
                  {p.pick && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>MOST POPULAR</Text>
                    </View>
                  )}
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{p.name}</Text>
                    <Text style={styles.planEdits}>{p.edits}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.price}>{money(pricePerMonth(p.monthly, billing))}<Text style={styles.per}>/mo</Text></Text>
                    {billing === 'yearly' && <Text style={styles.planEdits}>{money(pricePerMonth(p.monthly, billing) * 12)}/yr</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <ErrorText>{error}</ErrorText>
        <Button title="Continue" onPress={start} loading={saving} />
        <Text style={styles.terms}>
          {money(monthly)} a month{billing === 'yearly' ? `, billed ${money(monthly * 12)} yearly` : ''}. Renews automatically, cancel anytime.
        </Text>
        <Text style={styles.notConnected}>Payments aren’t connected yet, so you won’t be charged.</Text>
        <View style={styles.links}>
          <Text style={styles.link}>Terms</Text>
          <Text style={styles.link}>·</Text>
          <Text style={styles.link}>Privacy</Text>
          <Text style={styles.link}>·</Text>
          <Text style={styles.link}>Restore</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  hero: { backgroundColor: '#111114', paddingHorizontal: 24, paddingBottom: 30, gap: 16, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  switch: { alignSelf: 'flex-end' },
  switchText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  heroTimes: { color: '#fff', fontSize: 46, fontWeight: '800', textAlign: 'center', marginTop: 18, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  heroBefore: { color: 'rgba(255,255,255,0.35)', textDecorationLine: 'line-through' },
  heroTrack: { height: 12, borderRadius: 6, backgroundColor: '#fff', overflow: 'hidden', marginHorizontal: 6 },
  heroCut: { position: 'absolute', top: 0, bottom: 0, backgroundColor: theme.cut },
  heroCaption: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center' },
  body: { paddingHorizontal: 22, paddingTop: 22 },
  title: { fontSize: 26, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.4, marginBottom: 16 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1.5, borderColor: '#E3E3E8', padding: 16, backgroundColor: '#fff' },
  planOn: { borderColor: theme.ink, borderWidth: 2 },
  badge: { position: 'absolute', top: -10, left: 16, backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  planName: { fontSize: 17, fontWeight: '700', color: theme.ink },
  planEdits: { fontSize: 12, color: theme.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  price: { fontSize: 17, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  per: { fontSize: 12, fontWeight: '500', color: theme.faint },
  footer: { paddingHorizontal: 22, paddingTop: 8, gap: 6, backgroundColor: theme.bg },
  terms: { fontSize: 12, color: theme.muted, textAlign: 'center' },
  notConnected: { fontSize: 12, color: '#9A6B00', textAlign: 'center' },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  link: { fontSize: 12, color: theme.faint },
});
