// Placeholder pricing until payments are connected. Change prices and limits here.
export type PlanId = 'starter' | 'pro' | 'ultimate';
export type Billing = 'monthly' | 'yearly';

export const YEARLY_DISCOUNT = 0.33;
export const CURRENCY = '₹';

export const FEATURES = ['Overlap audio', 'Scheduled batch edits'] as const;

export const PLANS: { id: PlanId; name: string; monthly: number; edits: string; features: readonly string[]; pick?: boolean }[] = [
  { id: 'starter', name: 'Starter', monthly: 1999, edits: '100 AI edits a month', features: [] },
  { id: 'pro', name: 'Pro', monthly: 4999, edits: '300 AI edits a month', features: FEATURES, pick: true },
  { id: 'ultimate', name: 'Ultimate', monthly: 9900, edits: 'Unlimited AI edits', features: FEATURES },
];

export const pricePerMonth = (monthly: number, billing: Billing) =>
  billing === 'yearly' ? Math.round(monthly * (1 - YEARLY_DISCOUNT)) : monthly;

export const money = (n: number) => `${CURRENCY}${n.toLocaleString('en-IN')}`;
