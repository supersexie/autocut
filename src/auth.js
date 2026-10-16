import { createClient } from '@supabase/supabase-js';
import { effectivePlan } from './billing.js';

// Requests carry the app user's Supabase access token. Without SUPABASE_URL (local development)
// every request runs as one local user; in production the server refuses to start that way.
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (process.env.NODE_ENV === 'production' && (!url || !secret)) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in production.');
}

const supabase = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

export const authEnabled = !!supabase;
export const LOCAL_USER = 'local';

/** The signed-in user, or null when the token is missing, expired or forged. */
export async function accountFrom(req) {
  if (!supabase) return { id: LOCAL_USER };
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token) return null;
  const { data, error } = await supabase.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || typeof sub !== 'string') return null;
  return { id: sub };
}

/**
 * The user's plan. Paid plans come from `app_metadata.plans`, which only the server writes (from
 * the Whop and RevenueCat webhooks, see billing.js). Until PAYMENTS_REQUIRED=1, an account that
 * hasn't paid uses the plan the app picked (`user_metadata.plan`, the free beta); after, it has
 * none and can't start edits. Read from the account, not the token, whose copy can be an hour old.
 */
export async function planOf(id) {
  // Local development: Ultimate, or the plan in DEV_PLAN (starter, pro) to try the limits.
  if (!supabase || id === LOCAL_USER) return process.env.DEV_PLAN || 'ultimate';
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error) throw error;
  const paid = effectivePlan(data.user?.app_metadata?.plans);
  if (paid) return paid;
  return process.env.PAYMENTS_REQUIRED === '1' ? null : data.user?.user_metadata?.plan;
}

/** What the account has paid for, per source: { whop: {...}, apple: {...} } (for GET /me). */
export async function plansOf(id) {
  if (!supabase || id === LOCAL_USER) return {};
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error) throw error;
  return data.user?.app_metadata?.plans ?? {};
}

/** Records a change from one payment source (whop | apple) on the account. */
export async function setPlanFrom(source, { userId, plan, billing, active, until, ref }) {
  if (!supabase) return;
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) throw error ?? new Error(`no user ${userId}`);
  const meta = data.user.app_metadata ?? {};
  const plans = { ...(meta.plans ?? {}), [source]: { plan, billing, active, until, ref, at: Date.now() } };
  const { error: e2 } = await supabase.auth.admin.updateUserById(userId, { app_metadata: { ...meta, plans } });
  if (e2) throw e2;
}

/** The signed-in user's id, or null. */
export const userIdFrom = async (req) => (await accountFrom(req))?.id ?? null;

export async function deleteAuthUser(id) {
  if (!supabase || id === LOCAL_USER) return;
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) throw error;
}
