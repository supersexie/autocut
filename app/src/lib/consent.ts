import { postConsent } from './api';
import type { Profile } from './auth';

/**
 * The terms and privacy policy version users agree to. Must match TERMS_VERSION in the server's
 * src/legal.js; bumping both asks everyone to agree again.
 */
export const TERMS_VERSION = '2026-10-16';

/**
 * Whether letting Autocut use your videos to improve the app and its AI is a condition of using it
 * (true) or a choice (false). A legal decision: your lawyer sets this. When it's a choice, the
 * server only uses videos from accounts that said yes (the `consents` table).
 */
export const AI_CONSENT_REQUIRED = false;

// Sent once per account per launch, so the server's record catches up with the account's.
const sent = new Set<string>();

export function syncConsent(userId: string, termsVersion?: string, ai?: boolean) {
  const key = `${userId}:${termsVersion}:${ai}`;
  if (!termsVersion || sent.has(key)) return;
  sent.add(key);
  postConsent({ termsVersion, ai: !!ai }).catch(() => sent.delete(key)); // try again next time
}

// Ticked at sign-up with Apple or Google, before the account exists: put on it once it does.
let pending: Profile | null = null;
export const holdAgreement = (p: Profile | null) => (pending = p);
export const takeAgreement = () => {
  const p = pending;
  pending = null;
  return p;
};
