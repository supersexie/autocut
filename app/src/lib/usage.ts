import { useAuth } from './auth';
import { PLANS } from './plans';
import { useCuts } from './store';

/** The account's plan and how many of this month's edits it has used. */
export function useUsage() {
  const { account } = useAuth();
  const cuts = useCuts();
  const plan = PLANS.find((p) => p.id === account?.profile.plan) ?? PLANS[0];
  const now = new Date();
  const used = cuts.filter((c) => {
    const d = new Date(c.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return { plan, used, limit: plan.limit, left: Math.max(0, plan.limit - used), resets };
}

export const usageLine = (used: number, limit: number) => (limit === Infinity ? `${used} edits this month` : `${used} of ${limit} edits used`);
