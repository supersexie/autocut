import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { syncConsent, takeAgreement, TERMS_VERSION } from '../lib/consent';

/**
 * Makes sure every signed-in account has the current terms on record, without a popup: signing in or
 * up says "By continuing, you agree to the Terms of Service and Privacy Policy" (and creating an
 * account has the box to tick), so an account that's signed in has agreed. What was ticked at sign-up
 * (including the AI choice) is put on the account; accounts from before these terms, or Apple/Google
 * sign-ins that skipped that screen, get the current version recorded quietly. The server's copy
 * follows.
 */
export function ConsentGate() {
  const { account, updateProfile } = useAuth();
  const profile = account?.profile;
  const current = profile?.termsVersion === TERMS_VERSION;

  useEffect(() => {
    if (!account) return;
    if (current) return syncConsent(account.id, profile?.termsVersion, profile?.aiConsent);
    // Ticked on the sign-up screen just before an Apple or Google sign-in created the account.
    const held = takeAgreement();
    updateProfile({ termsVersion: TERMS_VERSION, aiConsent: held?.aiConsent ?? profile?.aiConsent ?? false, ...held }).catch(() => {});
  }, [account, current, profile?.termsVersion, profile?.aiConsent, updateProfile]);

  return null;
}
