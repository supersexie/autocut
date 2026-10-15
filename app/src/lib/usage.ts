import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useAuth } from './auth';
import { planAllows, PLANS, type Feature } from './plans';
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
  const left = Math.max(0, plan.limit - used);
  return {
    plan,
    used,
    limit: plan.limit,
    left,
    resets,
    /** Whether the plan includes `feature`. */
    allows: (feature: Feature) => planAllows(plan.id, feature),
    /**
     * Room for `count` more edits this month? If not, says so (offering an upgrade) and returns how
     * many still fit, which may be 0.
     */
    room: (count = 1) => {
      if (left >= count) return count;
      askToUpgrade(
        left ? `Only ${left} edit${left === 1 ? '' : 's'} left` : 'No edits left this month',
        `${plan.name} includes ${plan.limit} edits a month and they reset ${resets}. Upgrade for more.`
      );
      return left;
    },
  };
}

export const usageLine = (used: number, limit: number) => (limit === Infinity ? `${used} edit${used === 1 ? '' : 's'} this month` : `${used} of ${limit} edits used`);

/** "That's on a bigger plan": offers the plans screen. */
export function askToUpgrade(title: string, message: string) {
  Alert.alert(title, message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'See plans', onPress: () => router.push('/change-plan') },
  ]);
}
