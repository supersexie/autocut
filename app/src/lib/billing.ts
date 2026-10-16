import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { getMe, startWhopCheckout } from './api';
import type { Billing, PlanId } from './plans';

/**
 * Payments, on when EXPO_PUBLIC_PAYMENTS=1 (until then Autocut is free and the plan picker just
 * saves the choice). Two ways to pay, as Apple allows:
 *   Apple in-app purchase (through RevenueCat): everywhere. Needs the App Store build; Expo Go
 *     can't make real purchases.
 *   Whop on the web: only on the US App Store, offered next to Apple's, never instead of it.
 * Either way the server hears it from the payment provider and puts the plan on the account; the
 * app then waits for GET /me to show it.
 *
 * RevenueCat set-up: offering "default" with packages named <plan>_<billing>
 * (starter_monthly … ultimate_yearly), entitlements starter, pro, ultimate.
 */
export const PAYMENTS_ON = process.env.EXPO_PUBLIC_PAYMENTS === '1';
const RC_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const WEB_ON = process.env.EXPO_PUBLIC_WHOP !== '0';
export const MANAGE_WHOP_URL = process.env.EXPO_PUBLIC_WHOP_MANAGE_URL || 'https://whop.com/hub';
export const MANAGE_APPLE_URL = 'https://apps.apple.com/account/subscriptions';

const inExpoGo = Constants.executionEnvironment === 'storeClient';

type RC = typeof import('react-native-purchases').default;
let rc: RC | null = null;
let rcUser: string | null = null;

/** RevenueCat, signed in as this account, or null where Apple purchases can't happen. */
async function purchases(userId: string): Promise<RC | null> {
  if (!RC_KEY || inExpoGo || Platform.OS !== 'ios') return null;
  if (!rc) {
    rc = (await import('react-native-purchases')).default;
    rc.configure({ apiKey: RC_KEY, appUserID: userId });
    rcUser = userId;
  } else if (rcUser !== userId) {
    await rc.logIn(userId);
    rcUser = userId;
  }
  return rc;
}

/** The App Store country: from the store account when we can ask, else the phone's region. */
async function storeCountry(userId: string) {
  const p = await purchases(userId);
  if (p) {
    try {
      const code = (await p.getStorefront())?.countryCode;
      if (code) return code.toUpperCase();
    } catch {}
  }
  return (Intl.DateTimeFormat().resolvedOptions().locale.split('-').pop() ?? '').toUpperCase();
}

export type Ways = { apple: boolean; web: boolean };

/** How this account can pay here. Web checkout only on the US storefront (Apple's rule). */
export async function waysToPay(userId: string): Promise<Ways> {
  const apple = !!(await purchases(userId));
  const country = await storeCountry(userId);
  return { apple, web: WEB_ON && (country === 'US' || country === 'USA') };
}

/** Waits for the server to have heard about the purchase. True once the plan shows on the account. */
async function settled(plan: PlanId, seconds = 40) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const me = await getMe().catch(() => null);
    if (me?.paid === plan) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Buys with Apple. Resolves false if they cancelled. */
export async function buyWithApple(userId: string, plan: PlanId, billing: Billing) {
  const p = await purchases(userId);
  if (!p) throw new Error('Buying with Apple works in the Autocut app from the App Store.');
  const offering = (await p.getOfferings()).current;
  const pkg =
    offering?.availablePackages.find((x) => x.identifier === `${plan}_${billing}`) ??
    offering?.availablePackages.find((x) => x.product.identifier.includes(plan) && x.product.identifier.includes(billing));
  if (!pkg) throw new Error('That plan isn’t available in the App Store yet. Try again later.');
  try {
    await p.purchasePackage(pkg);
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return false;
    throw e;
  }
  if (!(await settled(plan))) throw new Error('Payment went through. Your plan can take a minute to show; it updates when you next open Autocut.');
  return true;
}

/** Pays on the web with Whop (US only). Resolves false if they closed checkout without paying. */
export async function buyOnWeb(plan: PlanId, billing: Billing) {
  const url = await startWhopCheckout(plan, billing);
  await WebBrowser.openAuthSessionAsync(url, Linking.createURL('plan'));
  return settled(plan, 25);
}

/** Restore purchases: Apple's (through RevenueCat), then whatever the server has on record. */
export async function restore(userId: string) {
  const p = await purchases(userId);
  if (p) await p.restorePurchases();
  const me = await getMe();
  return me.paid as PlanId | null;
}
