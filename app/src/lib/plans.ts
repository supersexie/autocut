// Placeholder pricing until payments are connected. Change prices and limits here.
export type PlanId = 'starter' | 'pro' | 'ultimate';
export type Billing = 'monthly' | 'yearly';

export const YEARLY_DISCOUNT = 0.33;
export const CURRENCY = '₹';

export const FEATURES = ['Captions', 'Batch cuts'] as const;

export const PLANS: { id: PlanId; name: string; monthly: number; edits: string; limit: number; features: readonly string[]; pick?: boolean }[] = [
  { id: 'starter', name: 'Starter', monthly: 1999, edits: '100 AI edits a month', limit: 100, features: ['Captions'] },
  { id: 'pro', name: 'Pro', monthly: 4999, edits: '300 AI edits a month', limit: 300, features: FEATURES, pick: true },
  { id: 'ultimate', name: 'Ultimate', monthly: 9900, edits: 'Unlimited AI edits', limit: Infinity, features: FEATURES },
];

export const pricePerMonth = (monthly: number, billing: Billing) =>
  billing === 'yearly' ? Math.round(monthly * (1 - YEARLY_DISCOUNT)) : monthly;

export const planFor = (id: PlanId) => PLANS.find((p) => p.id === id)!;

/** What a creator pays their editor each month (₹), as asked in setup. `none` skips the money screens. */
export const EDITOR_COSTS = [
  { value: 'u10k', label: 'Under ₹10,000', monthly: 6000, bars: 1 },
  { value: '10-25k', label: '₹10,000 to ₹25,000', monthly: 17500, bars: 2 },
  { value: '25-50k', label: '₹25,000 to ₹50,000', monthly: 37500, bars: 3 },
  { value: '50k-1l', label: '₹50,000 to ₹1,00,000', monthly: 75000, bars: 4 },
  { value: '1l+', label: 'More than ₹1,00,000', monthly: 125000, bars: 5 },
  { value: 'none', label: 'I don’t pay an editor', monthly: 0, bars: 0 },
] as const;

export const editorMonthly = (value?: string) => EDITOR_COSTS.find((c) => c.value === value)?.monthly ?? 0;

/** The plan to suggest from what they spend on editing now. */
export function recommendedPlan(editorCost?: string): PlanId {
  const spend = editorMonthly(editorCost);
  if (!spend || spend < 10000) return 'starter';
  return spend >= 75000 ? 'ultimate' : 'pro';
}

export const money = (n: number) => `${CURRENCY}${n.toLocaleString('en-IN')}`;
