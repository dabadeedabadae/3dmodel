// Ported from 3dmodel/src/image/color.ts (photo-garments pipeline); keep in sync.
/**
 * Stage 11 — base colour and a cautious lighting flattening.
 *
 *  - base colour: median RGB inside the eroded mask after dropping the 5 %
 *    darkest and 5 % brightest pixels (shadows / highlights)
 *  - lighting correction: divides luminance by its LOW-FREQUENCY field
 *    (masked box blur, radius ~ W/6). Only large-scale gradients are touched;
 *    letters and prints are much smaller than the blur radius. Strength 0..1,
 *    off by default in the record (user decides). It is NOT an albedo
 *    recovery: a dark print and a shadow of the same size are indistinguishable.
 */
import type { RasterImage } from './raster';

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function erodeMask(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = mask.slice();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let keep = true;
      for (let dy = -r; dy <= r && keep; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height || !mask[yy * width + xx]) {
            keep = false;
            break;
          }
        }
      if (!keep) out[i] = 0;
    }
  return out;
}

export interface BaseColorResult {
  rgb: [number, number, number];
  hex: string;
  sampled: number;
  note: string;
}

export function estimateBaseColor(img: RasterImage, mask: Uint8Array): BaseColorResult {
  const er = erodeMask(mask, img.width, img.height, Math.max(2, Math.round(Math.min(img.width, img.height) * 0.01)));
  const px: { l: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < er.length; i++) {
    if (!er[i]) continue;
    const o = i * 4;
    px.push({ l: luminance(img.data[o]!, img.data[o + 1]!, img.data[o + 2]!), r: img.data[o]!, g: img.data[o + 1]!, b: img.data[o + 2]! });
  }
  if (px.length === 0) return { rgb: [128, 128, 128], hex: '#808080', sampled: 0, note: 'маска пуста — серый по умолчанию' };
  px.sort((a, b) => a.l - b.l);
  const lo = Math.floor(px.length * 0.05),
    hi = Math.ceil(px.length * 0.95);
  const mid = px.slice(lo, hi);
  const med = (k: 'r' | 'g' | 'b') => {
    const v = mid.map((p) => p[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)]!;
  };
  const rgb: [number, number, number] = [med('r'), med('g'), med('b')];
  const hex = '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
  return { rgb, hex, sampled: mid.length, note: `медиана по ${mid.length} пикселям внутри маски (эрозия, без 5 % самых тёмных и светлых)` };
}

/** Masked box blur of a scalar field (summed-area tables), radius r. Returns the blurred field (undefined where no mask within radius). */
function maskedBoxBlur(field: Float32Array, mask: Uint8Array, width: number, height: number, r: number): Float32Array {
  const W1 = width + 1;
  const sat = new Float64Array((width + 1) * (height + 1));
  const cnt = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowS = 0,
      rowC = 0;
    for (let x = 1; x <= width; x++) {
      const i = (y - 1) * width + (x - 1);
      if (mask[i]) {
        rowS += field[i]!;
        rowC += 1;
      }
      sat[y * W1 + x] = sat[(y - 1) * W1 + x]! + rowS;
      cnt[y * W1 + x] = cnt[(y - 1) * W1 + x]! + rowC;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r),
        x1 = Math.min(width - 1, x + r);
      const y0 = Math.max(0, y - r),
        y1 = Math.min(height - 1, y + r);
      const S = sat[(y1 + 1) * W1 + x1 + 1]! - sat[y0 * W1 + x1 + 1]! - sat[(y1 + 1) * W1 + x0]! + sat[y0 * W1 + x0]!;
      const C = cnt[(y1 + 1) * W1 + x1 + 1]! - cnt[y0 * W1 + x1 + 1]! - cnt[(y1 + 1) * W1 + x0]! + cnt[y0 * W1 + x0]!;
      out[y * width + x] = C > 0 ? S / C : NaN;
    }
  return out;
}

export interface LightingResult {
  image: RasterImage;
  strength: number;
  radius: number;
  /** min/max of the low-frequency field relative to its mean — how much was corrected */
  fieldRange: [number, number];
}

/** Flatten large-scale lighting inside the mask. strength 0 = untouched copy. */
export function flattenLighting(img: RasterImage, mask: Uint8Array, strength: number): LightingResult {
  const { width, height } = img;
  const out: RasterImage = { width, height, data: new Uint8ClampedArray(img.data) };
  const radius = Math.max(4, Math.round(Math.min(width, height) / 6));
  if (strength <= 0) return { image: out, strength: 0, radius, fieldRange: [1, 1] };
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) lum[i] = luminance(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!);
  const field = maskedBoxBlur(lum, mask, width, height, radius);
  let sum = 0,
    n = 0;
  for (let i = 0; i < field.length; i++)
    if (mask[i] && !Number.isNaN(field[i]!)) {
      sum += field[i]!;
      n++;
    }
  const mean = n ? sum / n : 1;
  let mn = Infinity,
    mx = -Infinity;
  for (let i = 0; i < field.length; i++) {
    if (!mask[i] || Number.isNaN(field[i]!)) continue;
    const gain = Math.min(2.5, Math.max(0.4, mean / Math.max(1, field[i]!)));
    const g = 1 + (gain - 1) * strength;
    mn = Math.min(mn, g);
    mx = Math.max(mx, g);
    const o = i * 4;
    out.data[o] = Math.min(255, img.data[o]! * g);
    out.data[o + 1] = Math.min(255, img.data[o + 1]! * g);
    out.data[o + 2] = Math.min(255, img.data[o + 2]! * g);
  }
  return { image: out, strength, radius, fieldRange: [Number.isFinite(mn) ? mn : 1, Number.isFinite(mx) ? mx : 1] };
}
