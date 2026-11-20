/**
 * Mask operations with full provenance. Nothing here is destructive: every
 * step returns a new mask and a description of what it changed, so the UI can
 * offer to undo it (restore a removed fragment, fill or keep a hole).
 *
 * Masks are Uint8Array (1 = garment) in working-photo pixel coordinates.
 */
import { thresholdGray, type GrayImage } from './raster';

export interface Region {
  id: number;
  area: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  touchesBorder: boolean;
}

export interface LabelResult {
  labels: Int32Array; // -1 = not labelled
  regions: Region[];
}

/** 4-connected components of pixels where `pred(i)` is true. */
export function labelComponents(width: number, height: number, pred: (i: number) => boolean): LabelResult {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || !pred(start)) continue;
    const id = regions.length;
    const r: Region = { id, area: 0, bbox: { x0: width, y0: height, x1: -1, y1: -1 }, touchesBorder: false };
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      r.area++;
      if (x < r.bbox.x0) r.bbox.x0 = x;
      if (x > r.bbox.x1) r.bbox.x1 = x;
      if (y < r.bbox.y0) r.bbox.y0 = y;
      if (y > r.bbox.y1) r.bbox.y1 = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) r.touchesBorder = true;
      if (x > 0 && labels[i - 1] === -1 && pred(i - 1)) {
        labels[i - 1] = id;
        stack.push(i - 1);
      }
      if (x < width - 1 && labels[i + 1] === -1 && pred(i + 1)) {
        labels[i + 1] = id;
        stack.push(i + 1);
      }
      if (y > 0 && labels[i - width] === -1 && pred(i - width)) {
        labels[i - width] = id;
        stack.push(i - width);
      }
      if (y < height - 1 && labels[i + width] === -1 && pred(i + width)) {
        labels[i + width] = id;
        stack.push(i + width);
      }
    }
    regions.push(r);
  }
  return { labels, regions };
}

/** Foreground components of a mask. */
export function maskComponents(mask: Uint8Array, width: number, height: number): LabelResult {
  return labelComponents(width, height, (i) => mask[i] === 1);
}

/** Enclosed background regions (holes): background components that do not touch the image border. */
export function maskHoles(mask: Uint8Array, width: number, height: number): LabelResult {
  const bg = labelComponents(width, height, (i) => mask[i] === 0);
  const holes = bg.regions.filter((r) => !r.touchesBorder);
  // relabel so hole ids are dense and labels only mark holes
  const map = new Map<number, number>();
  holes.forEach((h, k) => map.set(h.id, k));
  const labels = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    const l = bg.labels[i]!;
    if (l !== -1 && map.has(l)) labels[i] = map.get(l)!;
  }
  return { labels, regions: holes.map((h, k) => ({ ...h, id: k })) };
}

/** Returns a copy of `mask` with the given holes (ids from maskHoles) filled. */
export function fillHoles(mask: Uint8Array, holes: LabelResult, ids: number[]): Uint8Array {
  const set = new Set(ids);
  const out = mask.slice();
  for (let i = 0; i < out.length; i++) if (!out[i] && set.has(holes.labels[i]!)) out[i] = 1;
  return out;
}

/** Returns a copy of `mask` keeping only the listed components (ids from maskComponents). */
export function keepComponents(mask: Uint8Array, comps: LabelResult, ids: number[]): Uint8Array {
  const set = new Set(ids);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) if (mask[i] && set.has(comps.labels[i]!)) out[i] = 1;
  return out;
}

export interface PostprocessOptions {
  /** holes with area <= this fraction of the kept component are treated as texture noise and filled */
  smallHoleFraction?: number; // default 0.005
}

export interface PostprocessResult {
  threshold: number;
  /** raw model mask at the threshold — untouched */
  thresholded: Uint8Array;
  /** largest component only, small holes filled */
  mask: Uint8Array;
  /** components dropped by "largest component" (restorable) */
  removedComponents: Region[];
  removedLabels: Int32Array;
  /** holes left open on purpose (could be a real opening / a tear) — reported, restorable by filling */
  openHoles: Region[];
  holeLabels: Int32Array;
  smallHolesFilled: number;
  keptArea: number;
}

/**
 * Deterministic post-processing of a saliency map. Re-runnable for any
 * threshold WITHOUT inference. It never fills a hole larger than
 * `smallHoleFraction` of the garment: a real neck opening or a tear stays
 * open and is reported in `openHoles` for the user to decide.
 */
export function postprocessSoftMask(soft: GrayImage, threshold: number, opts: PostprocessOptions = {}): PostprocessResult {
  const { width, height } = soft;
  const thresholded = thresholdGray(soft, threshold);
  const comps = maskComponents(thresholded, width, height);
  let best = -1;
  let bestArea = 0;
  for (const r of comps.regions)
    if (r.area > bestArea) {
      bestArea = r.area;
      best = r.id;
    }
  const largest = best >= 0 ? keepComponents(thresholded, comps, [best]) : new Uint8Array(thresholded.length);
  const removedComponents = comps.regions.filter((r) => r.id !== best);
  const holes = maskHoles(largest, width, height);
  const smallMax = (opts.smallHoleFraction ?? 0.005) * Math.max(1, bestArea);
  const small = holes.regions.filter((h) => h.area <= smallMax).map((h) => h.id);
  const mask = fillHoles(largest, holes, small);
  const openHoles = holes.regions.filter((h) => h.area > smallMax);
  return {
    threshold,
    thresholded,
    mask,
    removedComponents,
    removedLabels: comps.labels,
    openHoles,
    holeLabels: holes.labels,
    smallHolesFilled: small.length,
    keptArea: bestArea,
  };
}

export interface MaskQuality {
  /** HEURISTIC status — not an accuracy measure; the user's confirmation is a separate flag */
  status: 'ok' | 'suspicious' | 'empty';
  coverage: number;
  touchesBorder: boolean;
  components: number;
  openHoles: number;
  openHoleArea: number;
  warnings: string[];
}

export function assessMask(mask: Uint8Array, width: number, height: number): MaskQuality {
  const comps = maskComponents(mask, width, height);
  const holes = maskHoles(mask, width, height);
  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i]!;
  const coverage = area / (width * height);
  let borderHits = 0;
  for (let x = 0; x < width; x++) borderHits += mask[x]! + mask[(height - 1) * width + x]!;
  for (let y = 0; y < height; y++) borderHits += mask[y * width]! + mask[y * width + width - 1]!;
  const touchesBorder = borderHits / (2 * (width + height)) > 0.15;
  const openHoleArea = holes.regions.reduce((a, h) => a + h.area, 0);
  const warnings: string[] = [];
  if (area === 0) warnings.push('маска пустая');
  if (coverage > 0 && coverage < 0.05) warnings.push('маска меньше 5 % кадра — вещь могла не найтись');
  if (coverage > 0.9) warnings.push('маска больше 90 % кадра — вероятно, захвачен фон');
  if (touchesBorder) warnings.push('маска касается края кадра — вещь обрезана или захвачен фон');
  if (comps.regions.length > 1) warnings.push(`${comps.regions.length} отдельных фрагментов`);
  if (holes.regions.length > 0) warnings.push(`внутренние разрывы: ${holes.regions.length} (${((openHoleArea / Math.max(1, area)) * 100).toFixed(1)} % площади вещи) — настоящий вырез оставьте, остальное восстановите`);
  return { status: area === 0 ? 'empty' : warnings.length ? 'suspicious' : 'ok', coverage, touchesBorder, components: comps.regions.length, openHoles: holes.regions.length, openHoleArea, warnings };
}

export interface CarveResult {
  mask: Uint8Array;
  /** mask pixels given back to the background */
  carved: number;
}

/**
 * post-v3 (I-66): background that the saliency model swallowed — typically the wall between trouser legs, or the
 * surface under a hem — is given back. Colour model: the median of the pixels outside the mask (background) and
 * inside it (garment). From the background a flood fill enters the mask through pixels that are clearly
 * background-coloured: closer to the background than half their distance to the garment, and within 60 (RGB
 * distance) of it — and where the model was less than fully sure (soft map below 250 of 255; garment fabric reads
 * 254–255). On the test photos the swallowed wall between trouser legs is 160–250, while a dark sleeve on a dark
 * carpet, which colour alone would carve, is ≥ 250. A white T-shirt on a light blanket still loses thin edge
 * slivers: there the boundary is ambiguous by colour and almost so for the model. A print or a stripe inside the
 * garment is surrounded by fabric, so the fill never reaches it; a garment of the background's own colour stops the
 * fill at once. The largest component is kept afterwards. Nothing
 * is carved when that would take more than 40 % of the mask (the model's mask is then kept as it was).
 */
export function carveBackground(rgba: ArrayLike<number>, soft: ArrayLike<number>, mask: Uint8Array, width: number, height: number): CarveResult {
  const n = width * height;
  const median = (inside: boolean): [number, number, number] => {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let count = 0;
    for (let i = 0; i < n; i += 3) if ((mask[i] === 1) === inside) { count++; for (let k = 0; k < 3; k++) hist[k]![rgba[i * 4 + k]!]!++; }
    return [0, 1, 2].map((k) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[k]![v]!; if (acc * 2 >= count) return v; } return 0; }) as [number, number, number];
  };
  let area = 0;
  for (let i = 0; i < n; i++) area += mask[i]!;
  if (area === 0 || area === n) return { mask, carved: 0 };
  const bg = median(false), fg = median(true);
  const dist = (i: number, c: [number, number, number]) => Math.hypot(rgba[i * 4]! - c[0], rgba[i * 4 + 1]! - c[1], rgba[i * 4 + 2]! - c[2]);
  const bgLike = (i: number) => { if (soft[i]! >= 250) return false; const b = dist(i, bg); return b < 60 && b < 0.5 * dist(i, fg); };
  const out = Uint8Array.from(mask);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mask[i] !== 1 || !bgLike(i)) continue;
    const x = i % width, y = (i - x) / width;
    const touches = x === 0 || y === 0 || x === width - 1 || y === height - 1 || mask[i - 1] === 0 || mask[i + 1] === 0 || mask[i - width] === 0 || mask[i + width] === 0;
    if (touches) { out[i] = 0; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (j < 0 || j >= n || out[j] !== 1 || !bgLike(j)) continue;
      out[j] = 0;
      stack.push(j);
    }
  }
  const comps = maskComponents(out, width, height);
  let best = -1;
  for (const r of comps.regions) if (best < 0 || r.area > comps.regions[best]!.area) best = r.id;
  const kept = best >= 0 ? keepComponents(out, comps, [best]) : out;
  let left = 0;
  for (let i = 0; i < n; i++) left += kept[i]!;
  if (left < 0.6 * area) return { mask, carved: 0 };
  return { mask: kept, carved: area - left };
}
