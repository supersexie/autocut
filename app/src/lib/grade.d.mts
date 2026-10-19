// Types for grade.mjs (plain JavaScript so the server can load it too).
export type Band = { h?: number; s?: number; l?: number };
export type Grade = {
  filter?: { id: string; strength: number };
  adjust?: Partial<Record<AdjustKey, number>>;
  hsl?: Partial<Record<string, Band>>;
  wheel?: { angle: number; amount: number; brightness: number };
  curve?: [number, number][];
};
export type AdjustKey =
  | 'exposure' | 'brightness' | 'contrast' | 'light' | 'highlights' | 'shadows' | 'whites' | 'blacks'
  | 'brilliance' | 'saturation' | 'vibrance' | 'warmth' | 'tint' | 'hue'
  | 'fade' | 'sharpen' | 'clarity' | 'vignette' | 'grain';
export type FrameStats = { mean: number; low: number; mid: number; high: number; r: number; g: number; b: number; sat: number };
export type Effects = { sharpen: number; clarity: number; vignette: number; grain: number };

export const ADJUST_KEYS: AdjustKey[];
export const ONE_SIDED: AdjustKey[];
export const HSL_BANDS: { key: string; hue: number; color: string }[];
export const FILTERS: { id: string; name: string; adjust: Partial<Record<AdjustKey, number>> }[];
export function cleanGrade(g: unknown): Grade | undefined;
export function isNeutral(g: Grade | undefined): boolean;
export function sliders(g: Grade | undefined): Record<AdjustKey, number>;
export function effects(g: Grade | undefined): Effects;
export function curveFn(pts: [number, number][]): (x: number) => number;
export function pixelFn(g: Grade | undefined): (r: number, g: number, b: number) => [number, number, number];
export function lut(g: Grade | undefined, size?: number): Float32Array;
export function cube(g: Grade | undefined, size?: number): string;
export function gradeKey(g: Grade | undefined): string;
export function frameStats(rgba: ArrayLike<number>, step?: number): FrameStats | null;
export function autoGrade(st: FrameStats | null): Partial<Record<AdjustKey, number>>;
export function matchGrade(st: FrameStats | null, ref: FrameStats | null): Partial<Record<AdjustKey, number>>;
