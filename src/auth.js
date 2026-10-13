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

/** The signed-in user's id, or null when the token is missing, expired or forged. */
export async function userIdFrom(req) {
  if (!supabase) return LOCAL_USER;
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token) return null;
  const { data, error } = await supabase.auth.getClaims(token);
  const sub = data?.claims?.sub;
  return error || typeof sub !== 'string' ? null : sub;
}

export async function deleteAuthUser(id) {
  if (!supabase || id === LOCAL_USER) return;
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) throw error;
}
