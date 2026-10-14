import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { Overlay } from '../../lib/edit';
import { cutFile } from '../../lib/store';

const MAX_PHOTO = 1600; // px wide: plenty for a layer over a phone video, and quick to upload

export type OverlayMedia = Pick<Overlay, 'file' | 'kind' | 'mime' | 'w' | 'h' | 'length'>;

/**
 * Lets the user pick a photo or video for an overlay and keeps a copy next to the cut. Photos are
 * saved as JPEG (the server can't read HEIC) and kept to a sensible size.
 */
export async function pickOverlay(cutId: string): Promise<OverlayMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1 });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const stamp = `${cutId}-overlay-${Date.now().toString(36)}`;

  if (asset.type === 'video') {
    const ext = (asset.fileName?.split('.').pop() ?? asset.uri.split('.').pop() ?? 'mov').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mov';
    const file = `${stamp}.${ext}`;
    new File(asset.uri).copy(cutFile(file));
    // Its shape as shown (iPhone videos are often stored sideways and turned when played).
    const frame = await VideoThumbnails.getThumbnailAsync(cutFile(file).uri, { time: 0 }).catch(() => null);
    const w = frame?.width || asset.width || 1080;
    const h = frame?.height || asset.height || 1920;
    return { file, kind: 'video', mime: asset.mimeType ?? 'video/quicktime', w, h, length: Math.max(0.5, (asset.duration ?? 3000) / 1000) };
  }

  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > MAX_PHOTO) context.resize({ width: MAX_PHOTO });
  const image = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const file = `${stamp}.jpg`;
  new File(image.uri).copy(cutFile(file));
  return { file, kind: 'image', mime: 'image/jpeg', w: image.width, h: image.height, length: 0 };
}
