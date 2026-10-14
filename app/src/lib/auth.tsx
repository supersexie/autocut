import type { User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Billing, PlanId } from './plans';
import { deleteAccountOnServer } from './api';
import { clearCuts } from './store';
import { supabase } from './supabase';

export type Language = 'en' | 'es';

export type Profile = {
  firstName?: string;
  lastName?: string;
  language?: Language;
  handle?: string;
  tour?: boolean;
  who?: string;
  goal?: string;
  editorCost?: string;
  perWeek?: string;
  plan?: PlanId;
  billing?: Billing;
  onboarded?: boolean;
};

/** `fullName` is the name a sign-in provider (Google, Apple) shared, if any. */
export type Account = { id: string; email: string | null; createdAt: string; profile: Profile; fullName?: string };

type AuthContextValue = {
  loading: boolean;
  account: Account | null;
  /** False until Supabase keys are configured; sign-in then only works in dev mode. */
  configured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Resolves 'check-email' when the project requires email confirmation first. */
  signUpWithEmail: (email: string, password: string) => Promise<'signed-in' | 'check-email'>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (patch: Profile) => Promise<void>;
  signOut: () => Promise<void>;
  /** Deletes the account, its takes and cuts on the server, and everything on this phone. */
  deleteAccount: () => Promise<void>;
  continueWithoutAccount: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const NOT_CONFIGURED = "Accounts aren't connected yet. Add your Supabase keys to app/.env.local.";

// Profile fields live in the Supabase user's metadata, so no extra tables are needed.
const KEYS: Record<keyof Profile, string> = {
  firstName: 'first_name', lastName: 'last_name', language: 'language', handle: 'handle',
  tour: 'tour', who: 'who', goal: 'goal', editorCost: 'editor_cost', perWeek: 'per_week', plan: 'plan', billing: 'billing', onboarded: 'onboarded',
};
const toMetadata = (p: Profile) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [KEYS[k as keyof Profile], v]));
const fromMetadata = (m: Record<string, unknown> = {}): Profile =>
  Object.fromEntries(Object.entries(KEYS).filter(([, mk]) => m[mk] !== undefined).map(([k, mk]) => [k, m[mk]])) as Profile;
const toAccount = (u: User): Account => ({
  id: u.id,
  email: u.email ?? null,
  createdAt: u.created_at,
  profile: fromMetadata(u.user_metadata),
  fullName: String(u.user_metadata?.full_name ?? u.user_metadata?.name ?? '').trim() || undefined,
});

// Dev mode (no Supabase yet): a local stand-in account so the app can be tried end to end.
const devFile = new File(Paths.document, 'dev-account.json');
const readDev = (): Account | null => {
  try {
    return devFile.exists ? JSON.parse(devFile.textSync()) : null;
  } catch {
    return null;
  }
};
const writeDev = (a: Account | null) => (a ? devFile.write(JSON.stringify(a)) : devFile.exists && devFile.delete());

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(!!supabase);
  const [account, setAccount] = useState<Account | null>(() => (supabase ? null : readDev()));

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAccount(data.session ? toAccount(data.session.user) : null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccount(session ? toAccount(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const client = () => {
      if (!supabase) throw new Error(NOT_CONFIGURED);
      return supabase;
    };
    const check = (error: { message: string } | null) => {
      if (error) throw new Error(friendly(error.message));
    };

    return {
      loading,
      account,
      configured: !!supabase,

      async signInWithEmail(email, password) {
        const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
        check(error);
      },

      async signUpWithEmail(email, password) {
        // The confirmation email links back into the app (route: auth-callback), not to a website.
        const { data, error } = await client().auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: Linking.createURL('auth-callback') },
        });
        check(error);
        return data.session ? 'signed-in' : 'check-email';
      },

      async signInWithApple() {
        const auth = client();
        // Expo Go can't use Sign in with Apple (it's tied to each app's own ID); the real app can.
        if (!(await AppleAuthentication.isAvailableAsync()))
          throw new Error('Sign in with Apple works in the Autocut app from the App Store. Here, use Google or email.');
        await mustBeOn('apple');
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({
            requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
          });
        } catch (e) {
          if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
          throw e;
        }
        if (!credential.identityToken) throw new Error('Apple did not return a sign-in token. Try again.');
        const { error } = await auth.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
        check(error);
        // Apple shares the name only on the very first sign-in, so keep it for onboarding.
        const { givenName, familyName } = credential.fullName ?? {};
        if (givenName || familyName) {
          await auth.auth.updateUser({ data: toMetadata({ firstName: givenName ?? undefined, lastName: familyName ?? undefined }) });
        }
      },

      async signInWithGoogle() {
        const auth = client();
        await mustBeOn('google');
        const redirectTo = Linking.createURL('auth-callback');
        const { data, error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
        check(error);
        if (!data.url) throw new Error('Google sign-in is not available right now.');
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') return;
        const returned = new URL(result.url);
        const code = returned.searchParams.get('code');
        if (!code) throw new Error(friendly(returned.searchParams.get('error_description') ?? 'Google sign-in was cancelled.'));
        const exchange = await auth.auth.exchangeCodeForSession(code);
        check(exchange.error);
      },

      async resetPassword(email) {
        const { error } = await client().auth.resetPasswordForEmail(email.trim());
        check(error);
      },

      async updateProfile(patch) {
        if (!account) return;
        if (!supabase) {
          const next = { ...account, profile: { ...account.profile, ...patch } };
          writeDev(next);
          setAccount(next);
          return;
        }
        const { data, error } = await supabase.auth.updateUser({ data: toMetadata(patch) });
        check(error);
        if (data.user) setAccount(toAccount(data.user));
      },

      async signOut() {
        if (!supabase) {
          writeDev(null);
          setAccount(null);
          return;
        }
        await supabase.auth.signOut();
      },

      async deleteAccount() {
        await deleteAccountOnServer();
        clearCuts();
        if (!supabase) {
          writeDev(null);
          setAccount(null);
          return;
        }
        await supabase.auth.signOut({ scope: 'local' });
      },

      continueWithoutAccount() {
        const dev: Account = { id: 'dev', email: null, createdAt: new Date().toISOString(), profile: {} };
        writeDev(dev);
        setAccount(dev);
      },
    };
  }, [loading, account]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Which sign-in providers are switched on in the Supabase project, so we only show those. */
/** Apple sign-in is offered on iPhone and iPad; Google everywhere. */
/**
 * Which "Continue with…" buttons to show. While developing they always show, so the screens can be
 * seen as designed; in release builds only the ones switched on in Supabase do, so nobody (an App
 * Store reviewer included) taps a button that can't work.
 */
export async function socialOptions() {
  if (__DEV__) return { apple: Platform.OS === 'ios', google: true };
  const enabled = await enabledProviders();
  return { apple: Platform.OS === 'ios' && enabled.apple, google: enabled.google };
}

/** Stops with a plain message if the provider isn't switched on in Supabase yet. */
async function mustBeOn(provider: 'apple' | 'google') {
  const enabled = await enabledProviders();
  const name = provider === 'apple' ? 'Apple' : 'Google';
  if (!enabled[provider]) throw new Error(`Sign in with ${name} isn't switched on yet. Use your email for now.`);
}

export async function enabledProviders(): Promise<{ google: boolean; apple: boolean }> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { google: false, apple: false };
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    const { external } = await res.json();
    return { google: !!external?.google, apple: !!external?.apple };
  } catch {
    return { google: false, apple: false };
  }
}

/**
 * What to call someone: the name they set, else the one Google or Apple shared, else one made from
 * their email (rishav.vashisht@… → Rishav Vashisht), else "Creator".
 */
export function displayName(account: Account | null) {
  const own = [account?.profile.firstName, account?.profile.lastName].filter(Boolean).join(' ').trim();
  if (own) return own;
  if (account?.fullName) return account.fullName;
  const local = (account?.email ?? '').split('@')[0].split('+')[0];
  const words = local
    .split(/[._\-\s]+/)
    .map((w) => w.replace(/[0-9]+/g, ''))
    .filter((w) => w.length > 1) // "r24126571" is a code, not a name
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return words.join(' ') || 'Creator';
}

export const initialsOf = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Try again or reset your password.";
  if (/already registered/i.test(message)) return 'There is already an account with that email. Sign in instead.';
  if (/password should be at least/i.test(message)) return 'Use a password with at least 6 characters.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first. Check your inbox for the link.';
  if (/not enabled|unsupported provider/i.test(message)) return 'This sign-in option is not switched on yet. Use your email for now.';
  return message;
}
