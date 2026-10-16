import { createHmac, timingSafeEqual } from 'node:crypto';

// Payments. Two ways to pay, both ending in the same place: the account's `app_metadata.plans`,
// which only the server can write (users can edit their own user_metadata, not app_metadata).
//   Whop (web checkout, US App Store only): the app asks us for a checkout link carrying the user's
//     id; Whop tells /webhooks/whop when a membership starts or ends.
//   Apple in-app purchase, through RevenueCat: the app buys with the user's id as RevenueCat's
//     app user id; RevenueCat tells /webhooks/revenuecat.
// Each source is kept separately ({ whop: {...}, apple: {...} }), and the plan in force is the best
// one that's still active, so ending one never cancels the other.
//
// Environment:
//   WHOP_API_KEY            Whop → Developer → API keys (checkout_configuration:create)
//   WHOP_WEBHOOK_SECRET     the ws_… secret shown when the webhook is created
//   WHOP_PLANS              which Whop plan is which: "starter-monthly=plan_a,starter-yearly=plan_b,pro-monthly=…"
//   WHOP_REDIRECT_URL       where Whop sends the buyer afterwards (default: autocut://plan)
//   REVENUECAT_WEBHOOK_AUTH the Authorization value set on the RevenueCat webhook
export const RANK = { starter: 1, pro: 2, ultimate: 3 };
const PLANS = Object.keys(RANK);

/** The plan in force from `app_metadata.plans`: the best active one, or null. */
export function effectivePlan(plans, now = Date.now()) {
  let best = null;
  for (const p of Object.values(plans ?? {})) {
    if (!p?.active || !RANK[p.plan] || (p.until && p.until < now)) continue;
    if (!best || RANK[p.plan] > RANK[best]) best = p.plan;
  }
  return best;
}

/** "starter-monthly=plan_a,…" as { plan_a: { plan: 'starter', billing: 'monthly' }, … }. */
export function whopPlanMap(text = process.env.WHOP_PLANS ?? '') {
  const map = {};
  for (const pair of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, id] = pair.split('=').map((s) => s.trim());
    const [plan, billing = 'monthly'] = name.split('-');
    if (id && RANK[plan]) map[id] = { plan, billing };
  }
  return map;
}

/** Standard Webhooks signature check (Whop): HMAC-SHA256 of "id.timestamp.body" with the secret as given. */
export function verifyWhop(headers, raw, secret, now = Date.now()) {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sigs = String(headers['webhook-signature'] ?? '');
  if (!id || !ts || !sigs || !secret) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false; // replayed or badly delayed
  const expected = createHmac('sha256', secret).update(`${id}.${ts}.${raw}`).digest();
  return sigs.split(' ').some((s) => {
    const given = Buffer.from(s.replace(/^v1,/, ''), 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** What a Whop event means for our plans: { userId, plan, active } or null to ignore. */
export function whopChange(event, planMap = whopPlanMap()) {
  const type = String(event?.type ?? '').replace(/_/g, '.');
  const m = event?.data ?? {};
  const userId = m.metadata?.user_id ?? m.metadata?.userId;
  const planId = m.plan?.id ?? m.plan_id ?? m.plan;
  const mapped = planMap[planId];
  if (!userId || !mapped) return null;
  if (/membership\.(activated|went\.valid)$/.test(type)) return { userId, plan: mapped.plan, billing: mapped.billing, active: true, ref: m.id };
  if (/membership\.(deactivated|went\.invalid)$/.test(type)) return { userId, plan: mapped.plan, active: false, ref: m.id };
  if (/membership\.updated$/.test(type)) {
    const live = ['active', 'trialing', 'completed', 'past_due'].includes(String(m.status ?? ''));
    return { userId, plan: mapped.plan, billing: mapped.billing, active: live, ref: m.id };
  }
  return null;
}

/** What a RevenueCat event means: { userId, plan, active, until } or null. */
export function revenueCatChange(body) {
  const e = body?.event ?? {};
  const userId = e.app_user_id;
  if (!userId || /^\$RCAnonymousID/.test(userId)) return null;
  // Entitlements named after the plans; otherwise the product id says which ("autocut.pro.yearly").
  const named = (e.entitlement_ids ?? []).map((x) => String(x).toLowerCase()).filter((x) => RANK[x]);
  const fromProduct = PLANS.filter((p) => String(e.new_product_id ?? e.product_id ?? '').toLowerCase().includes(p));
  const plan = [...named, ...fromProduct].sort((a, b) => RANK[b] - RANK[a])[0];
  const until = Number(e.expiration_at_ms) || undefined;
  switch (e.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
    case 'NON_RENEWING_PURCHASE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      return plan ? { userId, plan, active: true, until } : null;
    case 'EXPIRATION':
      return { userId, plan: plan ?? 'starter', active: false, until };
    // Cancelled but paid up to `until`: still on the plan until then.
    case 'CANCELLATION':
    case 'BILLING_ISSUE':
      return plan ? { userId, plan, active: true, until } : null;
    default:
      return null;
  }
}

/** The app's request for a Whop checkout link: { plan, billing } → the link to open. */
export async function whopCheckout(userId, { plan, billing }, { fetchImpl = fetch, env = process.env } = {}) {
  const entry = Object.entries(whopPlanMap(env.WHOP_PLANS)).find(([, v]) => v.plan === plan && v.billing === billing);
  if (!env.WHOP_API_KEY || !entry) throw Object.assign(new Error('Paying on the web isn’t set up yet.'), { status: 503 });
  const res = await fetchImpl('https://api.whop.com/api/v1/checkout_configurations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHOP_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: entry[0], metadata: { user_id: userId }, redirect_url: env.WHOP_REDIRECT_URL || 'autocut://plan' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.purchase_url) throw Object.assign(new Error('Couldn’t open checkout. Try again.'), { status: 502 });
  return body.purchase_url.startsWith('http') ? body.purchase_url : `https://whop.com${body.purchase_url}`;
}
