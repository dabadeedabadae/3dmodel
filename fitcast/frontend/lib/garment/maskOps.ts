// Ported from 3dmodel/src/image/maskOps.ts (photo-garments pipeline); keep in sync.
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
  if (area === 0) warnings.push('mask is empty');
  if (coverage > 0 && coverage < 0.05) warnings.push('mask covers less than 5% of the frame; the garment may not have been found');
  if (coverage > 0.9) warnings.push('mask covers more than 90% of the frame; the background was probably included');
  if (touchesBorder) warnings.push('mask touches the frame edge; the garment is cropped or the background was included');
  if (comps.regions.length > 1) warnings.push(`${comps.regions.length} separate fragments`);
  if (holes.regions.length > 0) warnings.push(`internal gaps: ${holes.regions.length} (${((openHoleArea / Math.max(1, area)) * 100).toFixed(1)}% of garment area); keep the real neckline, fill in the rest`);
  return { status: area === 0 ? 'empty' : warnings.length ? 'suspicious' : 'ok', coverage, touchesBorder, components: comps.regions.length, openHoles: holes.regions.length, openHoleArea, warnings };
}
