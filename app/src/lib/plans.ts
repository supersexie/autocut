// Placeholder pricing (US dollars) until payments are connected. Change prices and limits here.
export type PlanId = 'starter' | 'pro' | 'ultimate';
export type Billing = 'monthly' | 'yearly';

export const YEARLY_DISCOUNT = 0.33;
export const CURRENCY = '$';

export const FEATURES = ['Captions', 'Batch cuts'] as const;

export const PLANS: { id: PlanId; name: string; monthly: number; edits: string; limit: number; features: readonly string[]; pick?: boolean }[] = [
  { id: 'starter', name: 'Starter', monthly: 19.99, edits: '100 AI edits a month', limit: 100, features: ['Captions'] },
  { id: 'pro', name: 'Pro', monthly: 49.99, edits: '300 AI edits a month', limit: 300, features: FEATURES, pick: true },
  { id: 'ultimate', name: 'Ultimate', monthly: 99.99, edits: 'Unlimited AI edits', limit: Infinity, features: FEATURES },
];

export const pricePerMonth = (monthly: number, billing: Billing) =>
  billing === 'yearly' ? Math.round(monthly * (1 - YEARLY_DISCOUNT) * 100) / 100 : monthly;

export const planFor = (id: PlanId) => PLANS.find((p) => p.id === id)!;

/**
 * What a creator pays their editor each month (US dollars), as asked in setup. `none` skips the
 * money screens. The `value`s are what's saved on accounts, so they stay as they were.
 */
export const EDITOR_COSTS = [
  { value: 'u10k', label: 'Under $100', monthly: 60, bars: 1 },
  { value: '10-25k', label: '$100 to $300', monthly: 200, bars: 2 },
  { value: '25-50k', label: '$300 to $600', monthly: 450, bars: 3 },
  { value: '50k-1l', label: '$600 to $1,200', monthly: 900, bars: 4 },
  { value: '1l+', label: 'More than $1,200', monthly: 1500, bars: 5 },
  { value: 'none', label: 'I don’t pay an editor', monthly: 0, bars: 0 },
] as const;

export const editorMonthly = (value?: string) => EDITOR_COSTS.find((c) => c.value === value)?.monthly ?? 0;

/** The plan to suggest from what they spend on editing now. */
export function recommendedPlan(editorCost?: string): PlanId {
  const spend = editorMonthly(editorCost);
  if (!spend || spend < 100) return 'starter';
  return spend >= 900 ? 'ultimate' : 'pro';
}

/** $49.99, $1,500 — cents only when there are some. */
export const money = (n: number) =>
  `${CURRENCY}${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 })}`;
