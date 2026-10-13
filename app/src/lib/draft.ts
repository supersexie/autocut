import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import type { Language } from './auth';

/**
 * Answers from the setup questions. They're asked before sign-up, so they live on the phone
 * until the account exists, then get saved to the profile.
 */
export type Draft = {
  creates?: string;
  perWeek?: string;
  heardFrom?: string;
  editTime?: string;
  blockers?: string[];
  language?: Language;
  firstName?: string;
  lastName?: string;
  handle?: string;
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
