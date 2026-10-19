// A grade for the phone's player and export (modules/autocut-player, modules/autocut-export): its
// colour LUT written to a small file (Float32 RGBA, red changing fastest) that Core Image loads,
// plus the effects drawn on top. The server gets the grade itself and makes a .cube (src/media.js).
import { Directory, File, Paths } from 'expo-file-system';
import { effects, gradeKey, isNeutral, lut, type Grade } from './grade.mjs';

const SIZE = 25; // LUT points per channel, as on the server and in the editor preview

export type NativeGrade = { lut: string; size: number; sharpen: number; clarity: number; vignette: number; grain: number };

const made = new Map<string, NativeGrade>();

/** The grade's file and effects if they're ready (made before), so it's free to call every render. */
export function readyGrade(g: Grade | undefined): NativeGrade | undefined {
  return g && !isNeutral(g) ? made.get(gradeKey(g)) : undefined;
}

/** The grade's file and effects, writing the file the first time. Undefined for no grade. */
export function nativeGrade(g: Grade | undefined): NativeGrade | undefined {
  if (!g || isNeutral(g)) return undefined;
  const key = gradeKey(g);
  const hit = made.get(key);
  if (hit) return hit;
  try {
    const dir = new Directory(Paths.cache, 'grades');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${key}-${SIZE}.lut`);
    if (!file.exists) file.write(new Uint8Array(lut(g, SIZE).buffer));
    const out = { lut: file.uri, size: SIZE, ...effects(g) };
    if (made.size > 200) made.clear();
    made.set(key, out);
    return out;
  } catch {
    return undefined; // no room to write it: that clip plays and exports as filmed
  }
}
