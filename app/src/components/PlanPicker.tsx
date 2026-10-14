import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ErrorText, Logo, PressableScale, Segmented } from './ui';
import { openLegal } from '../lib/api';
import { useAuth, type Profile } from '../lib/auth';
import { clearDraft, getDraft } from '../lib/draft';
import { FEATURES, money, planFor, PLANS, pricePerMonth, recommendedPlan, YEARLY_DISCOUNT, type Billing, type PlanId } from '../lib/plans';
import { BRAND_FONT } from '../lib/fonts';
import { column, COLUMN, theme } from '../lib/theme';

/**
 * The plans. `onboarding`: the last step of setup, where picking one saves the setup answers and
 * opens the app. `change`: from Your plan, with a way back, and picking one just switches plan.
 */
export function PlanPicker({ mode }: { mode: 'onboarding' | 'change' }) {
  const insets = useSafeAreaInsets();
  const { account, updateProfile, signOut } = useAuth();
  const changing = mode === 'change';
  const current = account?.profile.plan;
  const best = recommendedPlan(getDraft().editorCost ?? account?.profile.editorCost, getDraft().perWeek ?? account?.profile.perWeek);
  const [billing, setBilling] = useState<Billing>(account?.profile.billing ?? 'monthly');
  const [plan, setPlan] = useState<PlanId>(current ?? best);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = planFor(plan);
  const monthly = pricePerMonth(chosen.monthly, billing);

  async function start() {
    setSaving(true);
    setError(null);
    if (changing) {
      try {
        await updateProfile({ plan, billing });
        router.back();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      }
      return;
    }
    try {
      const d = getDraft();
      const fromSetup: Profile = Object.fromEntries(
        Object.entries({ who: d.who, goal: d.goal, editorCost: d.editorCost, perWeek: d.perWeek, language: d.language }).filter(([, v]) => v)
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
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <View style={styles.top}>
        {changing ? (
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 110 }} accessibilityLabel="Back">
            <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
          </Pressable>
        ) : (
          <View style={{ width: 110 }} />
        )}
        <View style={styles.brand}>
          <Logo size={22} />
          <Text style={styles.brandText}>Autocut</Text>
        </View>
        <Pressable onPress={signOut} hitSlop={10} disabled={changing} style={{ width: 110, alignItems: 'flex-end', opacity: changing ? 0 : 1 }}>
          <Text style={styles.switch}>Switch account</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[{ paddingHorizontal: 22, paddingBottom: 16 }, column(COLUMN + 44)]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{chosen.name} fits how you post.</Text>
        <Text style={styles.sub}>
          Everything your editor does, for a fraction of the price: {chosen.edits.toLowerCase()}, {chosen.features.join(' and ').toLowerCase()}.
        </Text>

        <View style={{ alignSelf: 'center', width: 250, marginVertical: 16 }}>
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
              <PressableScale
                key={p.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  setPlan(p.id);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                scaleTo={0.98}
                style={[styles.plan, on && styles.planOn]}
              >
                {p.id === best && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>BEST FOR YOU</Text>
                  </View>
                )}
                <View style={styles.row}>
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{p.name}</Text>
                    <Text style={styles.planEdits}>{p.edits}</Text>
                  </View>
                  <Text style={styles.price}>
                    {money(pricePerMonth(p.monthly, billing))}
                    <Text style={styles.per}> a month</Text>
                  </Text>
                </View>
                <View style={styles.features}>
                  {FEATURES.map((f) => {
                    const has = p.features.includes(f);
                    return (
                      <View key={f} style={styles.feature}>
                        <SymbolView name={has ? 'checkmark.circle.fill' : 'xmark.circle'} tintColor={has ? theme.ink : theme.faint} size={14} />
                        <Text style={[styles.featureText, !has && { color: theme.faint }]}>{f}</Text>
                      </View>
                    );
                  })}
                </View>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <ErrorText>{error}</ErrorText>
        <Button
          title={changing ? (plan === current && billing === (account?.profile.billing ?? 'monthly') ? `Keep ${chosen.name}` : `Switch to ${chosen.name}`) : `Continue with ${chosen.name}  →`}
          onPress={start}
          loading={saving}
        />
        <Text style={styles.terms}>
          {money(monthly)} a month{billing === 'yearly' ? `, billed ${money(monthly * 12)} yearly` : ''}. Renews automatically. Cancel anytime.
          {'\n'}Free during the beta: you won’t be charged.
        </Text>
        <View style={styles.links}>
          <Text style={styles.link} onPress={() => openLegal('terms')}>
            Terms of Use
          </Text>
          <Text style={styles.link} onPress={() => openLegal('privacy')}>
            Privacy Policy
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, height: 44 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandText: { fontSize: 19, fontFamily: BRAND_FONT, color: theme.ink, letterSpacing: -0.3 },
  switch: { fontSize: 14, fontWeight: '600', color: theme.muted },
  title: { fontSize: 28, fontWeight: '700', color: theme.ink, textAlign: 'center', letterSpacing: -0.5, marginTop: 14 },
  sub: { fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20, marginTop: 8, marginHorizontal: 6 },
  plan: { borderRadius: 18, borderWidth: 1.5, borderColor: '#E3E3E8', padding: 16, gap: 10, backgroundColor: '#fff' },
  planOn: { borderColor: theme.ink, borderWidth: 2 },
  badge: { position: 'absolute', top: -10, alignSelf: 'center', backgroundColor: theme.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  planName: { fontSize: 17, fontWeight: '700', color: theme.ink },
  planEdits: { fontSize: 13, color: theme.muted, marginTop: 2 },
  price: { fontSize: 17, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  per: { fontSize: 12, fontWeight: '500', color: theme.faint },
  features: { flexDirection: 'row', gap: 14, paddingLeft: 34 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  featureText: { fontSize: 12, color: theme.ink },
  footer: { paddingHorizontal: 22, paddingTop: 8, gap: 6, ...column(COLUMN + 44) },
  terms: { fontSize: 12, color: theme.muted, textAlign: 'center', lineHeight: 17 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  link: { fontSize: 12, color: theme.faint },
});
