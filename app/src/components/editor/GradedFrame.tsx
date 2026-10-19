import { AlphaType, Canvas, ColorType, FilterMode, Fill, ImageShader, MipmapMode, Shader, Skia, type SkImage } from '@shopify/react-native-skia';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { effects, gradeKey, lut, type Grade } from '../../lib/grade.mjs';

const SIZE = 25; // LUT points per channel (the exports use the same size)

/**
 * The grade's colour LUT as a picture Skia can sample: SIZE slices of SIZE×SIZE side by side
 * (red across, green down, one slice per blue step).
 */
export function lutImage(grade: Grade | undefined, size = SIZE): SkImage | null {
  const data = lut(grade, size);
  const w = size * size;
  const bytes = new Uint8Array(w * size * 4);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const i = ((b * size + g) * size + r) * 4;
        const o = (g * w + b * size + r) * 4;
        bytes[o] = Math.round(data[i] * 255);
        bytes[o + 1] = Math.round(data[i + 1] * 255);
        bytes[o + 2] = Math.round(data[i + 2] * 255);
        bytes[o + 3] = 255;
      }
  return Skia.Image.MakeImage({ width: w, height: size, alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 }, Skia.Data.fromBytes(bytes), w * 4);
}

// The frame through the LUT (blue slices blended), then vignette and grain on top. Left of `split`
// the frame is shown as filmed (the before/after view).
const effect = Skia.RuntimeEffect.Make(`
uniform shader image;
uniform shader table;
uniform float size;
uniform float2 res;
uniform float vignette;
uniform float grain;
uniform float split;
half4 main(float2 xy) {
  half4 c = image.eval(xy);
  if (xy.x < split) return c;
  float3 v = clamp(float3(c.rgb), 0.0, 1.0) * (size - 1.0);
  float b0 = floor(v.b);
  float b1 = min(b0 + 1.0, size - 1.0);
  half3 lo = table.eval(float2(v.r + b0 * size + 0.5, v.g + 0.5)).rgb;
  half3 hi = table.eval(float2(v.r + b1 * size + 0.5, v.g + 0.5)).rgb;
  half3 o = mix(lo, hi, half(v.b - b0));
  float2 uv = xy / res - 0.5;
  o *= half(1.0 - vignette * 0.85 * smoothstep(0.25, 0.78, length(uv * float2(1.0, res.y / res.x)) * 1.15));
  float n = fract(sin(dot(floor(xy), float2(12.9898, 78.233))) * 43758.5453) - 0.5;
  o += half(n * grain * 0.16);
  return half4(o, 1.0);
}`)!;

/**
 * A frame drawn with a grade, filling width × height. `split`: x where the graded half starts (0 = all
 * graded). `lutSize`: fewer LUT points for small thumbnails (quicker to make).
 */
export function GradedFrame({ image, grade, width, height, split = 0, lutSize = SIZE }: { image: SkImage | null; grade: Grade | undefined; width: number; height: number; split?: number; lutSize?: number }) {
  const key = gradeKey(grade);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const table = useMemo(() => lutImage(grade, lutSize), [key, lutSize]);
  const fx = effects(grade);
  if (!image || !table || width <= 0) return null;
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={{ size: lutSize, res: [width, height], vignette: fx.vignette, grain: fx.grain, split }}>
          <ImageShader image={image} fit="cover" rect={{ x: 0, y: 0, width, height }} sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }} />
          <ImageShader image={table} fit="fill" rect={{ x: 0, y: 0, width: lutSize * lutSize, height: lutSize }} sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}

/** A still of the take at `seconds` (source time) as a Skia image, refreshed a moment after it changes. */
export function useFrameAt(uri: string | undefined, seconds: number, enabled: boolean) {
  const [image, setImage] = useState<SkImage | null>(null);
  const cache = useRef(new Map<number, SkImage>());
  const at = Math.round(seconds * 10) / 10;
  useEffect(() => {
    if (!enabled || !uri) return;
    const hit = cache.current.get(at);
    if (hit) return setImage(hit);
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, at * 1000), quality: 0.8 });
        const img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(thumb.uri));
        if (!alive || !img) return;
        if (cache.current.size > 20) cache.current.clear();
        cache.current.set(at, img);
        setImage(img);
      } catch {
        // No still for this moment; keep the last one.
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [uri, at, enabled]);
  return image;
}

/** A frame's pixels, for Auto and Match (frameStats in grade.mjs). */
export function pixelsOf(image: SkImage | null) {
  if (!image) return null;
  const px = image.readPixels(0, 0, { width: image.width(), height: image.height(), alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 });
  return px instanceof Uint8Array ? px : null;
}
