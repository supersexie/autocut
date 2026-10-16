import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getMe } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PAYMENTS_ON } from '../lib/billing';
import type { PlanId } from '../lib/plans';

/**
 * With payments on, the server decides the plan (from what was paid for). Keep the account's copy,
 * which the app's screens and limits read, in step: at launch and whenever the app comes to the front.
 */
export function PlanSync() {
  const { account, updateProfile } = useAuth();
  const id = account?.id;
  const plan = account?.profile.plan;
  useEffect(() => {
    if (!PAYMENTS_ON || !id) return;
    const sync = () =>
      getMe()
        .then((me) => {
          const paid = (me.plan ?? undefined) as PlanId | undefined;
          if (paid !== plan) updateProfile({ plan: paid }).catch(() => {});
        })
        .catch(() => {});
    sync();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    return () => sub.remove();
  }, [id, plan, updateProfile]);
  return null;
}
