import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Bug fixes without App Store review (EAS Update): besides the check at launch, look again when the
 * app comes back to the front, and download any fix quietly. It's used from the next launch, so
 * nothing reloads in the middle of an upload or an edit. Off in Expo Go and development.
 */
export function useBackgroundUpdates() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 15 * 60_000) return;
      last = Date.now();
      try {
        if ((await Updates.checkForUpdateAsync()).isAvailable) await Updates.fetchUpdateAsync();
      } catch {} // offline, or the update server is unreachable: next time
    };
    const sub = AppState.addEventListener('change', (state) => state === 'active' && check());
    return () => sub.remove();
  }, []);
}
