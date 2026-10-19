import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HIGHLIGHT, OnbScreen } from './Onboarding';
import { Button, ErrorText, Logo, PreAppFont, PressableScale, Segmented, Wash } from './ui';
import { openLegal } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applePrices, buyOnWeb, buyWithApple, PAYMENTS_ON, waysToPay, type ApplePrice, type Ways } from '../lib/billing';
import { clearDraft, getDraft, profileFromDraft, updateDraft } from '../lib/draft';
import { DAYS_A_MONTH, FEATURES, money, planFor, PLANS, priceFor, pricePerMonth, recommendedPlan, YEARLY_DISCOUNT, type Billing, type PlanId } from '../lib/plans';
import { BRAND_FONT, UI_FONT } from '../lib/fonts';
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
  const perDay = getDraft().perDay ?? account?.profile.perDay;
  const best = recommendedPlan(getDraft().editorCost ?? account?.profile.editorCost, getDraft().perWeek ?? account?.profile.perWeek, perDay);
  // New users start on yearly, the price the setup's savings were worked out with.
  const [billing, setBilling] = useState<Billing>(account?.profile.billing ?? getDraft().billing ?? (changing ? 'monthly' : 'yearly'));
  const [plan, setPlan] = useState<PlanId>(current ?? getDraft().plan ?? best);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = planFor(plan);
  const per = billing === 'yearly' ? 'a year' : 'a month';

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
  // What the plan costs for its period ("$399.99" a year), and yearly plans a month as well.
  const total = (id: PlanId) => apple(id, billing)?.price ?? money(priceFor(planFor(id), billing));
  const monthlyOf = (id: PlanId) => apple(id, billing)?.perMonth ?? money(pricePerMonth(planFor(id), billing));

  // Signs out and opens sign-in, to sign in or sign up with a different account.
  async function switchAccount() {
    await signOut();
    setTimeout(() => router.replace('/sign-in'), 50);
  }

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
        {perDay && !changing
          ? `You post about ${Math.round(perDay * DAYS_A_MONTH)} videos a month. ${chosen.name} gives you ${midSentence(chosen.edits)}.`
          : `Everything your editor does, for a fraction of the price: ${sentence([chosen.edits, ...chosen.features, 'captions'].map(midSentence))}.`}
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
              {p.pick && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>OUR PICK</Text>
                </View>
              )}
              <View style={styles.row}>
                <View style={[styles.radio, on && styles.radioOn]}>{on && <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>{p.name}</Text>
                  <Text style={styles.planEdits}>{p.edits}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.price}>
                    {total(p.id)}
                    <Text style={styles.per}> {per}</Text>
                  </Text>
                  {billing === 'yearly' && <Text style={styles.perMonth}>{monthlyOf(p.id)} a month</Text>}
                </View>
              </View>
              <View style={styles.features}>
                {FEATURES.map((f) => {
                  const has = p.features.includes(f);
                  return (
                    <View key={f} style={styles.feature}>
                      <SymbolView name={has ? 'checkmark.circle.fill' : 'xmark.circle'} tintColor={has ? theme.blue : theme.faint} size={14} />
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
        {total(plan)} {per}. Renews automatically. Cancel anytime.
        {PAYMENTS_ON &&
          '\nCharged to your Apple ID (or card, on the web) when you confirm. Renews unless cancelled at least 24 hours before the period ends; manage it in your account settings.'}
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

  const page = (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <Wash soft />
      <View style={styles.top}>
        {/* The name sits in the middle of the screen; the back button and Switch account at the sides. */}
        <View style={styles.brand} pointerEvents="none">
          <Logo size={22} />
          <Text style={styles.brandText}>Autocut</Text>
        </View>
        {changing ? (
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <SymbolView name="chevron.left" tintColor={theme.ink} size={18} weight="semibold" />
          </Pressable>
        ) : (
          <View />
        )}
        {!changing && (
          <Pressable onPress={switchAccount} hitSlop={10}>
            <Text style={styles.switch} numberOfLines={1}>Switch account</Text>
          </Pressable>
        )}
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
  // Choosing a first plan comes before the app, so it's in the onboarding's font; changing plan doesn't.
  return changing ? page : <PreAppFont>{page}</PreAppFont>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, height: 44 },
  brand: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  brandText: { fontSize: 19, ...BRAND_FONT, color: theme.ink, letterSpacing: -0.3 },
  switch: { fontSize: 15, ...UI_FONT.semibold, color: theme.blue },
  title: { fontSize: 31, ...UI_FONT.bold, color: theme.ink, textAlign: 'center', letterSpacing: -0.9, marginTop: 10 },
  sub: { fontSize: 14, ...UI_FONT.medium, color: theme.muted, textAlign: 'center', lineHeight: 20, marginTop: 8, marginHorizontal: 6 },
  plan: { borderRadius: 18, borderWidth: 1.5, borderColor: '#E3E3E8', padding: 16, gap: 10, backgroundColor: '#fff' },
  planOn: { borderColor: theme.blueLine },
  // A blue pill on the card's top edge, white capitals.
  badge: { position: 'absolute', top: -11, alignSelf: 'center', backgroundColor: theme.blue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 11, ...UI_FONT.semibold, letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: theme.blue, borderColor: theme.blue },
  planName: { fontSize: 17, ...UI_FONT.bold, color: theme.ink },
  planEdits: { fontSize: 13, ...UI_FONT.medium, color: theme.muted, marginTop: 2 },
  price: { fontSize: 17, ...UI_FONT.extrabold, color: theme.ink, fontVariant: ['tabular-nums'] },
  per: { fontSize: 12, ...UI_FONT.medium, color: theme.faint },
  perMonth: { fontSize: 12, ...UI_FONT.medium, color: theme.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  features: { flexDirection: 'row', gap: 14, paddingLeft: 34 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  featureText: { fontSize: 12, ...UI_FONT.medium, color: theme.ink },
  footer: { paddingHorizontal: 22, paddingTop: 8, gap: 6, ...column(COLUMN + 44) },
  terms: { fontSize: 12, ...UI_FONT.medium, color: theme.muted, textAlign: 'center', lineHeight: 17 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  link: { fontSize: 12, ...UI_FONT.medium, color: theme.faint },
});
