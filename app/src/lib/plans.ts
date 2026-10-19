// Placeholder pricing (US dollars) until payments are connected. Change prices and limits here.
export type PlanId = 'starter' | 'pro' | 'ultimate';
export type Billing = 'monthly' | 'yearly';

export const YEARLY_DISCOUNT = 0.33;
export const CURRENCY = '$';

// What the paid plans add (every plan gets cutting, captions and the editor). The server checks
// these too (src/plans.js), so keep the two in step.
export const OVERLAP = 'Overlap audio';
// Batch edits are on every plan; picking a time for them is the paid part.
export const SCHEDULED = 'Scheduled batch edits';
export const FEATURES = [OVERLAP, SCHEDULED] as const;
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
  { value: 'u500', label: 'Under $500', monthly: 300, bars: 1 },
  { value: '500-1k', label: '$500 to $1,000', monthly: 750, bars: 2 },
  { value: '1k-2k', label: '$1,000 to $2,000', monthly: 1500, bars: 3 },
  { value: '2k-5k', label: '$2,000 to $5,000', monthly: 3500, bars: 4 },
  { value: '5k+', label: 'More than $5,000', monthly: 6000, bars: 5 },
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

/**
 * The plan to suggest: enough edits for how much they post (`perDay` from setup's slider, or the older
 * `perWeek` answer), and no smaller than what they spend on an editor now (accounts from before).
 */
export function recommendedPlan(editorCost?: string, perWeek?: string, perDay?: number): PlanId {
  const spend = editorMonthly(editorCost);
  const bySpend: PlanId = !spend || spend < 500 ? 'starter' : spend >= 1000 ? 'ultimate' : 'pro';
  const monthly = perDay ? perDay * DAYS_A_MONTH : videosPerWeek(perWeek) * 4.3;
  const byVolume: PlanId = monthly > 250 ? 'ultimate' : monthly > 80 ? 'pro' : 'starter';
  return ORDER[Math.max(ORDER.indexOf(bySpend), ORDER.indexOf(byVolume))];
}

export const DAYS_A_MONTH = 365 / 12;

/** Setup's "How many videos are you currently posting?" slider, from 1 a week to 10 or more a day. */
export const VOLUME_STOPS = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ n, unit: 'a week', perDay: n / 7 })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ n, unit: 'a day', perDay: n })),
  { n: 10, unit: 'or more a day', perDay: 10 },
];

/** Setup's "How long do you spend editing?" slider: minutes per video, from 5 minutes to an hour. */
export const EDIT_STOPS = [5, 10, 15, 20, 25, 30, 40, 50, 60];

/** What a freelance editor charges for one short video (US dollars), for "vs. hiring an editor". */
export const EDITOR_PER_VIDEO = 15;

/** The older "videos a week" answer for a `perDay` from the slider, so saved profiles stay readable. */
export const perWeekFor = (perDay: number) => {
  const week = perDay * 7;
  return week <= 3 ? '1-3' : week <= 7 ? '4-7' : week <= 15 ? '8-15' : '15+';
};

/**
 * What setup works out from the two sliders. Hours are per day. With Autocut a video takes about
 * AUTOCUT_MINUTES (send it, check the cut, export); `editor` is what hiring one would cost a month.
 */
export function editingNumbers(perDay: number, minutes: number, autocutMonthly: number) {
  const spent = (perDay * minutes) / 60;
  const saved = (perDay * Math.max(0, minutes - AUTOCUT_MINUTES)) / 60;
  const videosAMonth = perDay * DAYS_A_MONTH;
  const editor = videosAMonth * EDITOR_PER_VIDEO;
  return { spent, saved, videosAMonth, editor, savedMoney: Math.max(0, editor - autocutMonthly) };
}

/** $49.99, $1,500 — cents only when there are some. */
export const money = (n: number) =>
  `${CURRENCY}${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 })}`;
