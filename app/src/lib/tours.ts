import { useAuth } from './auth';
import { updateSettings, useSettings } from './store';

/** `app`: the tour of the main sections on the camera. `editor`: the editor's, on the first cut. */
export type TourId = 'app' | 'editor';

/**
 * Whether each tour has been seen, so it shows once per account: remembered on the account (so a
 * new phone or signing in again doesn't show it again) and on the phone (so it works offline and
 * before the account exists). Settings › Replay tutorial clears both.
 */
export function useTours() {
  const { account, updateProfile } = useAuth();
  const { cameraTourDone, tourDone } = useSettings();
  const profile = account?.profile;
  const seen = (id: TourId) => (id === 'app' ? cameraTourDone || !!profile?.tour : tourDone || !!profile?.editorTour);
  const mark = (id: TourId, done: boolean) => {
    updateSettings(id === 'app' ? { cameraTourDone: done } : { tourDone: done });
    if (account) updateProfile(id === 'app' ? { tour: done } : { editorTour: done }).catch(() => {}); // the phone's copy still holds
  };
  return {
    seen,
    done: (id: TourId) => mark(id, true),
    /** Show it again (Replay tutorial), or on purpose (Show me around). */
    again: (id: TourId) => mark(id, false),
  };
}
