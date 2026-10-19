// Colour grading (the editor's Adjust tool), shared by the app and the server so every place that
// draws a clip draws it the same: the editor's preview, the phone export and the server export.
// The colour part of a grade becomes one 3D lookup table (LUT): the app and the phone export apply it
// with Core Image / Skia, the server with ffmpeg's lut3d. Sharpen, clarity, vignette and grain work on
// neighbouring pixels, so they can't live in a LUT; each renderer adds those itself (see `effects`).
//
// Plain JavaScript (no imports) so Node can load it straight from the app's folder.

/** @typedef {{ h?: number; s?: number; l?: number }} Band */
/**
 * @typedef {{
 *   filter?: { id: string; strength: number };
 *   adjust?: Record<string, number>;
 *   hsl?: Record<string, Band>;
 *   wheel?: { angle: number; amount: number; brightness: number };
 *   curve?: [number, number][];
 * }} Grade
 */

/** The sliders, all −100…100 (fade, sharpen, clarity, vignette and grain 0…100). */
export const ADJUST_KEYS = [
  'exposure', 'brightness', 'contrast', 'light', 'highlights', 'shadows', 'whites', 'blacks',
  'brilliance', 'saturation', 'vibrance', 'warmth', 'tint', 'hue',
  'fade', 'sharpen', 'clarity', 'vignette', 'grain',
];
export const ONE_SIDED = ['fade', 'sharpen', 'clarity', 'vignette', 'grain'];

/** The colour bands of the HSL tool, by the hue they're centred on (degrees). */
export const HSL_BANDS = [
  { key: 'red', hue: 0, color: '#E5484D' },
  { key: 'orange', hue: 30, color: '#F08C3A' },
  { key: 'yellow', hue: 58, color: '#C9B12E' },
  { key: 'green', hue: 120, color: '#46A758' },
  { key: 'aqua', hue: 180, color: '#29B5B0' },
  { key: 'blue', hue: 225, color: '#4C7DF0' },
  { key: 'purple', hue: 270, color: '#8E5BE0' },
  { key: 'magenta', hue: 320, color: '#D6409F' },
];

/** One-tap looks: sliders (and sometimes a curve) at full strength; the strength slider scales them. */
export const FILTERS = [
  { id: 'natural', name: 'Natural', adjust: { contrast: 8, vibrance: 14, warmth: 4 } },
  { id: 'bright', name: 'Bright', adjust: { exposure: 14, shadows: 18, contrast: 6 } },
  { id: 'warm', name: 'Warm', adjust: { warmth: 32, tint: 4, vibrance: 6 } },
  { id: 'cool', name: 'Cool', adjust: { warmth: -30, tint: -3 } },
  { id: 'soft', name: 'Soft', adjust: { contrast: -18, fade: 22, highlights: -16 } },
  { id: 'vivid', name: 'Vivid', adjust: { saturation: 30, contrast: 14, vibrance: 22 } },
  { id: 'studio', name: 'Studio', adjust: { contrast: 18, clarity: 22, shadows: 10, highlights: -12 } },
  { id: 'film', name: 'Film', adjust: { fade: 24, contrast: 12, warmth: 8, saturation: -14, grain: 28 } },
  { id: 'moody', name: 'Moody', adjust: { exposure: -12, contrast: 20, saturation: -22, shadows: -16, warmth: -6 } },
  { id: 'mono', name: 'Mono', adjust: { saturation: -100, contrast: 16 } },
  { id: 'pop', name: 'Pop', adjust: { saturation: 24, contrast: 20, vibrance: 16 } },
  { id: 'golden', name: 'Golden', adjust: { warmth: 36, highlights: -8, saturation: 10, tint: 6 } },
];

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x) => clamp(x, 0, 1);
const num = (x, lo, hi) => (Number.isFinite(Number(x)) ? clamp(Number(x), lo, hi) : 0);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A grade with every value checked and in range (anything else dropped), or undefined when it does nothing. */
export function cleanGrade(g) {
  if (!g || typeof g !== 'object') return undefined;
  const out = {};
  const adjust = {};
  for (const k of ADJUST_KEYS) {
    const v = num(g.adjust?.[k], ONE_SIDED.includes(k) ? 0 : -100, 100);
    if (v) adjust[k] = Math.round(v);
  }
  if (Object.keys(adjust).length) out.adjust = adjust;
  const f = g.filter && FILTERS.find((x) => x.id === g.filter.id);
  if (f) {
    const strength = Math.round(num(g.filter.strength ?? 100, 0, 100));
    if (strength) out.filter = { id: f.id, strength };
  }
  const hsl = {};
  for (const { key } of HSL_BANDS) {
    const b = g.hsl?.[key];
    if (!b) continue;
    const band = {};
    for (const c of ['h', 's', 'l']) {
      const v = Math.round(num(b[c], -100, 100));
      if (v) band[c] = v;
    }
    if (Object.keys(band).length) hsl[key] = band;
  }
  if (Object.keys(hsl).length) out.hsl = hsl;
  if (g.wheel) {
    const amount = Math.round(num(g.wheel.amount, 0, 100));
    const brightness = Math.round(num(g.wheel.brightness, -100, 100));
    if (amount || brightness) out.wheel = { angle: Math.round(((num(g.wheel.angle, -720, 720) % 360) + 360) % 360), amount, brightness };
  }
  if (Array.isArray(g.curve)) {
    const pts = g.curve
      .filter((p) => Array.isArray(p) && p.length === 2)
      .slice(0, 12)
      .map(([x, y]) => [Math.round(num(x, 0, 1) * 1000) / 1000, Math.round(num(y, 0, 1) * 1000) / 1000])
      .sort((a, b) => a[0] - b[0]);
    const straight = pts.every(([x, y]) => Math.abs(x - y) < 0.002);
    if (pts.length >= 2 && !straight) out.curve = pts;
  }
  return Object.keys(out).length ? out : undefined;
}

/** True when the grade changes nothing. */
export const isNeutral = (g) => !cleanGrade(g);

/** The sliders in effect: the user's own plus the filter's, scaled by its strength. */
export function sliders(g) {
  const s = {};
  for (const k of ADJUST_KEYS) s[k] = g?.adjust?.[k] ?? 0;
  const f = g?.filter && FILTERS.find((x) => x.id === g.filter.id);
  if (f) {
    const k = (g.filter.strength ?? 100) / 100;
    for (const [key, v] of Object.entries(f.adjust)) s[key] = clamp(s[key] + v * k, ONE_SIDED.includes(key) ? 0 : -100, 100);
  }
  return s;
}

/** Sharpen, clarity, vignette and grain, 0…1: drawn by each renderer on top of the LUT. */
export function effects(g) {
  const s = sliders(g);
  return { sharpen: s.sharpen / 100, clarity: s.clarity / 100, vignette: s.vignette / 100, grain: s.grain / 100 };
}

/** A monotone curve through the points (no overshoot), as a function of 0…1. */
export function curveFn(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const m = xs.map((_, i) => {
    if (i === 0) return d[0];
    if (i === n - 1) return d[n - 2];
    if (d[i - 1] * d[i] <= 0) return 0;
    return (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]); // harmonic mean keeps it monotone
  });
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hh = h / 360;
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}

/**
 * The colour part of a grade as a function of one pixel (each channel 0…1, as stored in the video).
 * Order: light (exposure, levels, tone), then the curve, then colour (warmth, tint, wheel, hue, HSL,
 * saturation).
 */
export function pixelFn(g) {
  const s = sliders(g);
  const curve = g?.curve?.length >= 2 ? curveFn(g.curve) : null;
  const wheel = g?.wheel;
  const tint = wheel && wheel.amount ? hslToRgb(wheel.angle, 1, 0.5) : null;
  const bands = HSL_BANDS.map((b) => ({ hue: b.hue, ...(g?.hsl?.[b.key] ?? {}) })).filter((b) => b.h || b.s || b.l);
  const ex = Math.pow(2, (s.exposure / 100) * 1.6);
  const gamma = Math.pow(2, -((s.brightness / 100) * 0.75 + ((wheel?.brightness ?? 0) / 100) * 0.5));
  const k = s.contrast / 100;
  const hueTurn = (s.hue / 100) * 60;
  const shadows = s.shadows + s.brilliance * 0.5;
  const highlights = s.highlights - s.brilliance * 0.3;
  const sat = 1 + s.saturation / 100 + s.brilliance * 0.001;
  const luma = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;

  return (r, gg, b) => {
    let c = [r, gg, b];
    // Exposure, in linear light.
    if (ex !== 1) c = c.map((v) => Math.pow(Math.pow(v, 2.2) * ex, 1 / 2.2));
    // Whites and blacks move the ends; brightness and light the middle.
    c = c.map((v) => {
      v = clamp01(v);
      v += (s.whites / 100) * 0.18 * Math.pow(v, 3);
      v += (s.blacks / 100) * 0.18 * Math.pow(1 - v, 3);
      v = Math.pow(clamp01(v), gamma);
      v += (s.light / 100) * 0.12 * Math.sin(Math.PI * clamp01(v));
      return v;
    });
    // Contrast: an S-curve about the middle (or flattened towards it).
    if (k > 0) c = c.map((v) => v + (clamp01(v) * clamp01(v) * (3 - 2 * clamp01(v)) - v) * k * 0.9);
    else if (k < 0) c = c.map((v) => v + (0.5 - v) * -k * 0.5);
    // Highlights and shadows, weighted by how bright the pixel is.
    if (highlights || shadows) {
      const l = luma(...c.map(clamp01));
      const hi = (highlights / 100) * 0.32 * smooth(0.45, 1, l);
      const lo = (shadows / 100) * 0.32 * (1 - smooth(0, 0.55, l));
      c = c.map((v) => {
        v = clamp01(v);
        v += hi > 0 ? hi * (1 - v) : hi * v;
        v += lo > 0 ? lo * (1 - v) : lo * v;
        return v;
      });
    }
    // Fade lifts the blacks and softens.
    if (s.fade) c = c.map((v) => clamp01(v) * (1 - (s.fade / 100) * 0.22) + (s.fade / 100) * 0.1);
    if (curve) c = c.map((v) => curve(clamp01(v)));
    // Colour.
    if (s.warmth || s.tint) {
      const w = s.warmth / 100;
      const t = s.tint / 100;
      c = [c[0] * (1 + w * 0.16 + t * 0.05), c[1] * (1 + w * 0.02 - t * 0.14), c[2] * (1 - w * 0.18 + t * 0.05)];
    }
    if (tint) {
      const a = (wheel.amount / 100) * 0.22;
      c = c.map((v, i) => v + (tint[i] - 0.5) * a);
    }
    if (hueTurn || bands.length) {
      let [h, sa, li] = rgbToHsl(...c.map(clamp01));
      let dh = hueTurn;
      let ds = 0;
      let dl = 0;
      for (const band of bands) {
        let d = Math.abs(h - band.hue);
        if (d > 180) d = 360 - d;
        const w = d >= 45 ? 0 : 0.5 + 0.5 * Math.cos((d / 45) * Math.PI);
        if (!w) continue;
        dh += w * ((band.h ?? 0) / 100) * 30;
        ds += w * ((band.s ?? 0) / 100);
        dl += w * ((band.l ?? 0) / 100) * 0.25;
      }
      h = (h + dh + 360) % 360;
      sa = clamp01(sa * (1 + ds));
      li = clamp01(li + dl * sa); // greys (no colour) don't change
      c = hslToRgb(h, sa, li);
    }
    if (sat !== 1 || s.vibrance) {
      const l = luma(...c);
      const chroma = Math.max(...c) - Math.min(...c);
      const amt = sat + (s.vibrance / 100) * (1 - clamp01(chroma * 1.4)) * 0.9;
      c = c.map((v) => l + (v - l) * Math.max(0, amt));
    }
    return c.map(clamp01);
  };
}

/** The grade's colour as a size³ LUT: RGBA floats, red changing fastest (Core Image's and .cube's order). */
export function lut(g, size = 25) {
  const f = pixelFn(g);
  const out = new Float32Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let gg = 0; gg < size; gg++)
      for (let r = 0; r < size; r++) {
        const [R, G, B] = f(r / (size - 1), gg / (size - 1), b / (size - 1));
        out[i++] = R;
        out[i++] = G;
        out[i++] = B;
        out[i++] = 1;
      }
  return out;
}

/** The same LUT as a .cube file (for ffmpeg's lut3d). */
export function cube(g, size = 25) {
  const data = lut(g, size);
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let i = 0; i < data.length; i += 4) lines.push(`${data[i].toFixed(5)} ${data[i + 1].toFixed(5)} ${data[i + 2].toFixed(5)}`);
  return lines.join('\n') + '\n';
}

/** A short key for a grade (to name its LUT file and spot changes). */
export function gradeKey(g) {
  const s = JSON.stringify(cleanGrade(g) ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** What a frame looks like, from its pixels (RGBA bytes): brightness spread, average colour and saturation. */
export function frameStats(rgba, step = 4) {
  const lum = [];
  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  let n = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4 * step) {
    const R = rgba[i] / 255;
    const G = rgba[i + 1] / 255;
    const B = rgba[i + 2] / 255;
    lum.push(0.2126 * R + 0.7152 * G + 0.0722 * B);
    r += R;
    g += G;
    b += B;
    sat += Math.max(R, G, B) - Math.min(R, G, B);
    n++;
  }
  if (!n) return null;
  lum.sort((x, y) => x - y);
  const at = (p) => lum[Math.min(lum.length - 1, Math.floor(p * lum.length))];
  return { mean: lum.reduce((a, x) => a + x, 0) / n, low: at(0.02), mid: at(0.5), high: at(0.98), r: r / n, g: g / n, b: b / n, sat: sat / n };
}

const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));

/** Auto: sliders that bring a frame to a balanced exposure, a full range of tones and neutral colour. */
export function autoGrade(st) {
  if (!st) return {};
  const exposure = clamp((Math.log2(Math.pow(0.46, 2.2) / Math.max(0.002, Math.pow(st.mid, 2.2))) / 1.6) * 100 * 0.7, -45, 45);
  return round({
    exposure,
    contrast: clamp((0.82 - (st.high - st.low)) * 55, -10, 28),
    whites: clamp((0.96 - st.high) * 120, -20, 30),
    blacks: clamp(-(st.low - 0.03) * 140, -30, 15),
    warmth: clamp((st.b - st.r) * 140, -35, 35),
    tint: clamp((st.g - (st.r + st.b) / 2) * 160, -25, 25),
    vibrance: st.sat < 0.18 ? 12 : 0,
  });
}

/** Match: sliders that make a frame look like a reference frame (brightness, contrast, colour, saturation). */
export function matchGrade(st, ref) {
  if (!st || !ref) return {};
  const ratio = (a, b) => Math.log2(Math.max(0.002, Math.pow(b, 2.2)) / Math.max(0.002, Math.pow(a, 2.2)));
  return round({
    exposure: clamp((ratio(st.mid, ref.mid) / 1.6) * 100, -60, 60),
    contrast: clamp(((ref.high - ref.low) / Math.max(0.05, st.high - st.low) - 1) * 80, -50, 50),
    warmth: clamp(((ref.r - ref.b) - (st.r - st.b)) * 220, -60, 60),
    tint: clamp(((st.g - (st.r + st.b) / 2) - (ref.g - (ref.r + ref.b) / 2)) * 220, -50, 50),
    saturation: clamp((ref.sat / Math.max(0.01, st.sat) - 1) * 70, -60, 60),
  });
}
