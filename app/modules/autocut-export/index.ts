import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type ExportModule = {
  exportVideo(json: string): Promise<string>;
  cancel(): void;
  addListener(event: 'onProgress', fn: (e: { progress: number }) => void): { remove(): void };
};

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<ExportModule>('AutocutExport') : null;

/**
 * True in builds that include the phone export (development, TestFlight and App Store builds).
 * Expo Go doesn't have it, so exports go to the server there.
 */
export const hasPhoneExport = native != null;

/** Renders the edit described by `spec` (see localExport.ts) on this phone; resolves with the file's URI. */
export async function exportOnPhone(spec: object, onProgress: (progress: number) => void): Promise<string> {
  if (!native) throw new Error('Phone export is not in this build.');
  const sub = native.addListener('onProgress', (e) => onProgress(e.progress));
  try {
    return await native.exportVideo(JSON.stringify(spec));
  } finally {
    sub.remove();
  }
}

export const cancelPhoneExport = () => native?.cancel();
