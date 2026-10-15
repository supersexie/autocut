// Placeholder pricing (US dollars) until payments are connected. Change prices and limits here.
export type PlanId = 'starter' | 'pro' | 'ultimate';
export type Billing = 'monthly' | 'yearly';

export const YEARLY_DISCOUNT = 0.33;
export const CURRENCY = '$';

// What the paid plans add (every plan gets cutting, captions and the editor). The server checks
// these too (src/plans.js), so keep the two in step.
export const OVERLAP = 'Overlap audio';
export const BATCH = 'Batch cuts';
export const FEATURES = [OVERLAP, BATCH] as const;
export type Feature = (typeof FEATURES)[number];

export const PLANS: { id: PlanId; name: string; monthly: number; edits: string; limit: number; features: readonly Feature[]; pick?: boolean }[] = [
  { id: 'starter', name: 'Starter', monthly: 19.99, edits: '100 AI edits a month', limit: 100, features: [] },
  { id: 'pro', name: 'Pro', monthly: 49.99, edits: '300 AI edits a month', limit: 300, features: FEATURES, pick: true },
  { id: 'ultimate', name: 'Ultimate', monthly: 99.99, edits: 'Unlimited AI edits', limit: Infinity, features: FEATURES },
];

export const pricePerMonth = (monthly: number, billing: Billing) =>
  billing === 'yearly' ? Math.round(monthly * (1 - YEARLY_DISCOUNT) * 100) / 100 : monthly;

export const planFor = (id: PlanId) => PLANS.find((p) => p.id === id)!;

/** Whether a plan includes a feature (no plan yet counts as Starter). */
export const planAllows = (id: PlanId | undefined, feature: Feature) => (PLANS.find((p) => p.id === id) ?? PLANS[0]).features.includes(feature);

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
  { value: 'none', label: 'Nothing, I edit myself', monthly: 0, bars: 0 },
] as const;

export const editorMonthly = (value?: string) => EDITOR_COSTS.find((c) => c.value === value)?.monthly ?? 0;

/** How many videos a creator posts a week, as asked in setup (`count` is a typical week). */
export const PER_WEEK = [
  { value: '1-3', label: '1 to 3', count: 2 },
  { value: '4-7', label: '4 to 7', count: 5.5 },
  { value: '8-15', label: '8 to 15', count: 11.5 },
  { value: '15+', label: 'More than 15', count: 20 },
] as const;

export const videosPerWeek = (value?: string) => PER_WEEK.find((p) => p.value === value)?.count ?? 0;

// Rough minutes to cut one short video by hand, and with Autocut (send, check, export).
export const BY_HAND_MINUTES = 30;
export const AUTOCUT_MINUTES = 3;

/** Hours a week Autocut saves, from how many videos they post. */
export const hoursBack = (perWeek?: string) => (videosPerWeek(perWeek) * (BY_HAND_MINUTES - AUTOCUT_MINUTES)) / 60;

const ORDER: PlanId[] = ['starter', 'pro', 'ultimate'];

/** The plan to suggest from what they spend on editing now, and enough edits for how much they post. */
export function recommendedPlan(editorCost?: string, perWeek?: string): PlanId {
  const spend = editorMonthly(editorCost);
  const bySpend: PlanId = !spend || spend < 100 ? 'starter' : spend >= 900 ? 'ultimate' : 'pro';
  const monthly = videosPerWeek(perWeek) * 4.3;
  const byVolume: PlanId = monthly > 250 ? 'ultimate' : monthly > 80 ? 'pro' : 'starter';
  return ORDER[Math.max(ORDER.indexOf(bySpend), ORDER.indexOf(byVolume))];
}

/** $49.99, $1,500 — cents only when there are some. */
export const money = (n: number) =>
  `${CURRENCY}${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 })}`;
