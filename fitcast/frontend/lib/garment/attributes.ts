/**
 * What a garment photo says beyond its type and main colour (I-77), computed on the device and stored with the item
 * for the recommendations:
 *  • pattern: "solid", or "pattern" (stripes, checks, a print — the garment is not one colour);
 *  • secondaryColor: the second palette colour when it covers a real share of the garment;
 *  • tone: light / mid / dark by the main colour's lightness.
 * The garment is told from the background by the border colour (flat-lays and product shots have a plain one);
 * when that finds too little, the centre of the photo is used. Shades of one colour (folds, shadows) are not a
 * pattern: two neutrals that differ only in lightness need a larger share to count.
 */
import { nearestRgb } from '../labels';

export interface PhotoAttributes {
  pattern: 'solid' | 'pattern';
  secondaryColor?: string;
  tone: 'light' | 'mid' | 'dark';
  /** for the form: how the decision was made */
  shares: { main: string; mainShare: number; second?: string; secondShare: number; texture: number };
}


/** sRGB 0–255 → CIE Lab (D65) */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * RGBA pixels → attributes. `mask` marks the garment (from the photo analysis: the texture's background is filled
 * with the base colour); without it the background is told by the border colour, or the centre is used. Pure, so
 * it also runs in Node on the project's photos (scripts/eval-attributes.ts).
 *
 * Pattern: the garment's pixels are split into two colour groups (2-means in Lab). Stripes and prints give two
 * groups far apart with a real share for the smaller one; folds and shadows on one colour give a gradual spread
 * and two groups close together. On the 19 analysed project photos: solid garments 9.6–38.7 ΔE, printed and
 * striped 37–75.5 with the print often only 6–9 % of the front; 40 ΔE and 5 % give 15 of 19 right
 * (scripts/eval-attributes.ts). Small or low-contrast prints are missed — it is a hint, not recognition.
 */
export const PATTERN_DE = 40;
export const PATTERN_SHARE = 0.05;
export function describePixels(data: Uint8ClampedArray | Uint8Array, w: number, h: number, mask?: Uint8Array): PhotoAttributes {
  const at = (i: number) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!];
  let m = mask;
  if (!m) {
    const border: number[][] = [];
    for (let x = 0; x < w; x++) border.push(at(x), at((h - 1) * w + x));
    for (let y = 0; y < h; y++) border.push(at(y * w), at(y * w + w - 1));
    const med = (k: number) => border.map((p) => p[k]!).sort((a, b) => a - b)[border.length >> 1]!;
    const bg = [med(0), med(1), med(2)];
    m = new Uint8Array(w * h);
    let n = 0;
    for (let i = 0; i < w * h; i++) { const p = at(i); if (Math.hypot(p[0]! - bg[0]!, p[1]! - bg[1]!, p[2]! - bg[2]!) > 42) { m[i] = 1; n++; } }
    if (n < w * h * 0.12) {
      m = new Uint8Array(w * h);
      for (let y = Math.floor(h * 0.2); y < h * 0.8; y++) for (let x = Math.floor(w * 0.2); x < w * 0.8; x++) m[y * w + x] = 1;
    }
  }
  const pts: [number, number, number][] = [], rgb: number[][] = [];
  for (let i = 0; i < w * h; i++) if (m[i]) { const p = at(i); rgb.push(p); pts.push(lab(p[0]!, p[1]!, p[2]!)); }
  if (!pts.length) return { pattern: 'solid', tone: 'mid', shares: { main: 'gray', mainShare: 1, secondShare: 0, texture: 0 } };
  // 2-means in Lab, seeded with the darkest and the lightest pixel
  let c0 = pts.reduce((a, b) => (b[0] < a[0] ? b : a)), c1 = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
  const assign = new Uint8Array(pts.length);
  for (let it = 0; it < 12; it++) {
    const s: [number, number, number, number][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
    pts.forEach((p, i) => {
      const d0 = (p[0] - c0[0]) ** 2 + (p[1] - c0[1]) ** 2 + (p[2] - c0[2]) ** 2, d1 = (p[0] - c1[0]) ** 2 + (p[1] - c1[1]) ** 2 + (p[2] - c1[2]) ** 2;
      const k = d0 <= d1 ? 0 : 1; assign[i] = k; s[k]![0] += p[0]; s[k]![1] += p[1]; s[k]![2] += p[2]; s[k]![3]++;
    });
    if (s[0]![3]) c0 = [s[0]![0] / s[0]![3], s[0]![1] / s[0]![3], s[0]![2] / s[0]![3]];
    if (s[1]![3]) c1 = [s[1]![0] / s[1]![3], s[1]![1] / s[1]![3], s[1]![2] / s[1]![3]];
  }
  let n1 = 0; for (const a of assign) n1 += a;
  const n0 = pts.length - n1;
  const big = n0 >= n1 ? 0 : 1, minorShare = Math.min(n0, n1) / pts.length;
  const dE = Math.hypot(c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]);
  const meanRgb = (k: number) => { const t: [number, number, number] = [0, 0, 0]; let c = 0; rgb.forEach((p, i) => { if (assign[i] === k) { t[0] += p[0]!; t[1] += p[1]!; t[2] += p[2]!; c++; } }); return t.map((v) => v / (c || 1)); };
  const main = nearestRgb(meanRgb(big)), second = nearestRgb(meanRgb(1 - big));
  const pattern = dE >= PATTERN_DE && minorShare >= PATTERN_SHARE && second !== main ? 'pattern' : 'solid';
  const L = (big === 0 ? c0 : c1)[0];
  const tone = L > 72 ? 'light' : L < 32 ? 'dark' : 'mid';
  return {
    pattern, tone, ...(pattern === 'pattern' ? { secondaryColor: second } : {}),
    shares: { main, mainShare: Number((1 - minorShare).toFixed(2)), second, secondShare: Number(minorShare.toFixed(2)), texture: Number(dE.toFixed(1)) },
  };
}

/** The garment mask of an analysed photo: its texture has the background filled exactly with the base colour. */
export function maskFromTexture(data: Uint8ClampedArray | Uint8Array, w: number, h: number, baseHex: string): Uint8Array {
  const b = [1, 3, 5].map((i) => parseInt(baseHex.slice(i, i + 2), 16));
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (Math.abs(data[i * 4]! - b[0]!) + Math.abs(data[i * 4 + 1]! - b[1]!) + Math.abs(data[i * 4 + 2]! - b[2]!) > 9) m[i] = 1;
  }
  return m;
}

/** A photo file → attributes (96 × 96 is enough and keeps it instant). */
export async function describePhoto(file: Blob, texture?: { blob: Blob; baseColor: string }): Promise<PhotoAttributes | null> {
  if (texture) {
    // an analysed photo: its texture is the garment cut out, the rest filled with the base colour
    const tb = await createImageBitmap(texture.blob).catch(() => null);
    if (tb) {
      const size = 128, c = document.createElement('canvas'); c.width = size; c.height = size;
      const x = c.getContext('2d', { willReadFrequently: true });
      if (x) {
        x.imageSmoothingEnabled = false; x.drawImage(tb, 0, 0, size, size); tb.close();
        const d = x.getImageData(0, 0, size, size).data;
        return describePixels(d, size, size, maskFromTexture(d, size, size, texture.baseColor));
      }
      tb.close();
    }
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) { bitmap.close(); return null; }
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return describePixels(ctx.getImageData(0, 0, size, size).data, size, size);
}
