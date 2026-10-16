import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HIGHLIGHT, OnbScreen } from './Onboarding';
import { Button, ErrorText, Logo, PressableScale, Segmented, Wash } from './ui';
import { openLegal } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applePrices, buyOnWeb, buyWithApple, PAYMENTS_ON, waysToPay, type ApplePrice, type Ways } from '../lib/billing';
import { clearDraft, getDraft, profileFromDraft, updateDraft } from '../lib/draft';
import { FEATURES, money, planFor, PLANS, pricePerMonth, recommendedPlan, YEARLY_DISCOUNT, type Billing, type PlanId } from '../lib/plans';
import { BRAND_FONT } from '../lib/fonts';
import { column, COLUMN, midSentence, theme } from '../lib/theme';

/** "a, b and c". */
const sentence = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * The plans. `setup`: a step of setup, before the account exists: the choice is kept with the
 * answers and saved once they sign up. `onboarding`: signed in without a plan yet; picking one saves
 * the answers and opens the app. `change`: from Your plan, with a way back; picking one switches plan.
 */
export function PlanPicker({ mode, header, onDone }: { mode: 'setup' | 'onboarding' | 'change'; header?: React.ReactNode; onDone?: () => void }) {
  const insets = useSafeAreaInsets();
  const { account, updateProfile, signOut } = useAuth();
  const changing = mode === 'change';
  const current = account?.profile.plan;
  const best = recommendedPlan(getDraft().editorCost ?? account?.profile.editorCost, getDraft().perWeek ?? account?.profile.perWeek);
  // New users start on yearly, the price the setup's savings were worked out with.
  const [billing, setBilling] = useState<Billing>(account?.profile.billing ?? getDraft().billing ?? (changing ? 'monthly' : 'yearly'));
  const [plan, setPlan] = useState<PlanId>(current ?? getDraft().plan ?? best);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = planFor(plan);
  const monthly = pricePerMonth(chosen.monthly, billing);

  // How this account can pay here (when payments are on): Apple everywhere, Whop on the US store.
  const [ways, setWays] = useState<Ways | null>(null);
  const paying = PAYMENTS_ON && mode !== 'setup';
  // Where Apple purchases are on, Apple's prices in the buyer's currency (what they'll be charged).
  const [prices, setPrices] = useState<Record<string, ApplePrice>>({});
  useEffect(() => {
    if (!paying || !account) return;
    waysToPay(account.id).then(setWays, () => setWays({ apple: false, web: false }));
    applePrices(account.id).then(setPrices, () => {});
  }, [paying, account]);
  const apple = (id: PlanId, b: Billing) => prices[`${id}_${b}`];

  async function start(how: 'apple' | 'web' = 'apple') {
    // Kept with the setup answers; they're saved with the rest when setup finishes.
    if (mode === 'setup') {
      updateDraft({ plan, billing });
      onDone?.();
      return;
    }
    if (changing && plan === current && billing === (account?.profile.billing ?? 'monthly')) return router.back();
    setSaving(true);
    setError(null);
    try {
      if (paying && account) {
        const paid = how === 'web' ? await buyOnWeb(plan, billing) : await buyWithApple(account.id, plan, billing);
        if (!paid) return setSaving(false); // closed without paying
      }
      if (mode === 'onboarding' && onDone) {
        updateDraft({ plan, billing });
        onDone();
      } else if (changing) {
        await updateProfile({ plan, billing });
        router.back();
      } else {
        await updateProfile({ ...profileFromDraft(), plan, billing, onboarded: true });
        clearDraft();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const title = (
    <>
      <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        <Text style={{ color: HIGHLIGHT }}>{chosen.name}</Text> fits how you post.
      </Text>
      <Text style={styles.sub}>
        Everything your editor does, for a fraction of the price: {sentence([chosen.edits, ...chosen.features, 'captions'].map(midSentence))}.
      </Text>
    </>
  );
  const choices = (
    <>
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
                  {apple(p.id, billing)?.perMonth ?? money(pricePerMonth(p.monthly, billing))}
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
    </>
  );
  const footer = (
    <>
      <ErrorText>{error}</ErrorText>
      {paying && ways && !ways.apple && !ways.web ? (
        <ErrorText>Buying a plan works in the Autocut app from the App Store.</ErrorText>
      ) : paying && !(changing && plan === current && billing === (account?.profile.billing ?? 'monthly')) ? (
        <>
          {(!ways || ways.apple) && <Button title={`Subscribe to ${chosen.name}`} onPress={() => start('apple')} loading={saving || !ways} />}
          {ways?.web && <Button kind={ways.apple ? 'outline' : 'primary'} title="Pay on the web with Whop" onPress={() => start('web')} disabled={saving} />}
        </>
      ) : (
        <Button
          title={changing ? (plan === current && billing === (account?.profile.billing ?? 'monthly') ? `Keep ${chosen.name}` : `Switch to ${chosen.name}`) : `Continue with ${chosen.name}  →`}
          onPress={() => start()}
          loading={saving}
        />
      )}
      <Text style={styles.terms}>
        {apple(plan, billing)
          ? `${apple(plan, billing)!.price} ${billing === 'yearly' ? 'a year' : 'a month'}`
          : `${money(monthly)} a month${billing === 'yearly' ? `, billed ${money(monthly * 12)} yearly` : ''}`}
        . Renews automatically. Cancel anytime.
        {'\n'}
        {PAYMENTS_ON
          ? 'Charged to your Apple ID (or card, on the web) when you confirm. Renews unless cancelled at least 24 hours before the period ends; manage it in your account settings.'
          : 'Free during the beta: you won’t be charged.'}
      </Text>
      <View style={styles.links}>
        <Text style={styles.link} onPress={() => openLegal('terms')}>
          Terms of Use
        </Text>
        <Text style={styles.link} onPress={() => openLegal('privacy')}>
          Privacy Policy
        </Text>
      </View>
    </>
  );

  if (mode === 'setup') {
    return (
      <OnbScreen header={header} footer={footer}>
        <View style={{ marginTop: -8 }}>
          {title}
          {choices}
        </View>
      </OnbScreen>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <Wash />
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
        {title}
        {choices}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        {footer}
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
  title: { fontSize: 31, fontWeight: '800', color: theme.ink, textAlign: 'center', letterSpacing: -1, marginTop: 10 },
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
