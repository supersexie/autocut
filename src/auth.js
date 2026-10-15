import { createClient } from '@supabase/supabase-js';

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
 * The user's plan, read from the account itself (`user_metadata.plan`). Not from the token: its copy
 * is as old as the token (up to an hour), so a plan just changed wouldn't count yet. Until App Store
 * subscriptions are connected the app sets it, so it isn't proof of payment: see HANDOVER.md.
 */
export async function planOf(id) {
  // Local development: Ultimate, or the plan in DEV_PLAN (starter, pro) to try the limits.
  if (!supabase || id === LOCAL_USER) return process.env.DEV_PLAN || 'ultimate';
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error) throw error;
  return data.user?.user_metadata?.plan;
}

/** The signed-in user's id, or null. */
export const userIdFrom = async (req) => (await accountFrom(req))?.id ?? null;

export async function deleteAuthUser(id) {
  if (!supabase || id === LOCAL_USER) return;
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) throw error;
}
