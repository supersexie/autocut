import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import type { Language, Profile } from './auth';
import type { Billing, PlanId } from './plans';

/**
 * Answers from the setup questions. They're asked before sign-up, so they live on the phone
 * until the account exists, then get saved to the profile.
 */
export type Draft = {
  who?: string;
  goal?: string;
  editorCost?: string; // an EDITOR_COSTS value
  perWeek?: string; // a PER_WEEK value
  language?: Language;
  firstName?: string;
  lastName?: string;
  handle?: string;
  plan?: PlanId; // picked before the account exists
  billing?: Billing;
};

const file = new File(Paths.document, 'setup-draft.json');

let draft: Draft = (() => {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as Draft) : {};
  } catch {
    return {};
  }
})();
const listeners = new Set<() => void>();

export function updateDraft(patch: Draft) {
  draft = { ...draft, ...patch };
  file.write(JSON.stringify(draft));
  listeners.forEach((l) => l());
}

export function clearDraft() {
  draft = {};
  if (file.exists) file.delete();
  listeners.forEach((l) => l());
}

export const getDraft = () => draft;
export const useDraft = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => draft
  );

/** The setup answers that belong on the profile, without the empty ones. */
export function profileFromDraft(d: Draft = draft): Profile {
  return Object.fromEntries(
    Object.entries({ who: d.who, goal: d.goal, editorCost: d.editorCost, perWeek: d.perWeek, language: d.language }).filter(([, v]) => v)
  );
}
