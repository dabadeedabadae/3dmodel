'use client';
/**
 * Photo → garment package, in the browser. Same steps and parameters as the 3D module's pipeline
 * (3dmodel: SegmentationProvider U²-Netp, landmarks.ts, color.ts, imported-body/src/photoMap.ts):
 *   mask (U²-Netp, 320×320, post-processing post-v3: + background the model swallowed is carved back, I-66) → T-shirt landmarks from the mask → photo anchors and their
 *   plausibility → median base colour → texture = the photo with everything outside the mask in the base colour.
 * Runs locally with onnxruntime-web (wasm, one thread); the photo is not sent anywhere for this.
 * The model and the runtime files are served from /ml and /ort (npm run ml:sync in the FitCast root).
 */
import { resizeGray, resizeRaster, toCHWFloat, type GrayImage, type RasterImage } from './raster';
import { assessMask, carveBackground, postprocessSoftMask } from './maskOps';
import { estimateTShirtLandmarks } from './landmarks';
import { estimateBaseColor } from './color';
import { anchorIssues, anchorsFromLandmarks, estimatePantsLandmarks, type PantsAnchors, type PhotoAnchors, type PhotoPointName } from '../figure/photoMap';

export const MASK_PROVIDER = 'u2netp.onnx@sha256:309c8469…4ddd8;post-v3';
const N = 320;
const THRESHOLD = 128;
/** longest side the analysis works at; larger photos are scaled down first (speed, texture size) */
const MAX_SIDE = 1024;

interface PackageCommon {
  version: 1;
  baseColor: string;
  maskQuality: 'ok' | 'suspicious' | 'empty';
  landmarkStatus: 'ok' | 'uncertain';
  anchorIssues: string[];
  /** true when the points must be confirmed by a person before the print is trusted */
  needsReview: boolean;
  /** who placed the points: the estimator, or the person after dragging them in the form (I-63) */
  pointsSource?: 'auto' | 'user';
  provider: string;
}
/** photo → 3D package: a T-shirt or a long-sleeved top (shirt, hoodie, sweater — the same points, I-63) onto the
 *  figure's top, or trousers/jeans onto its bottom */
export type GarmentPackage =
  | (PackageCommon & { category: 'tshirt' | 'top'; anchors: PhotoAnchors })
  | (PackageCommon & { category: 'pants'; anchors: PantsAnchors });

export interface Analysis {
  pkg: GarmentPackage;
  texture: Blob;
  /** small preview: photo dimmed outside the mask, for the form */
  preview: string;
  ms: number;
  /** tops only: what the point editor needs to recompute the anchors from points the person moved */
  edit?: { mask: Uint8Array; width: number; height: number; points: Record<PhotoPointName, { x: number; y: number }>; backdrop: string };
}

type Ort = typeof import('onnxruntime-web/wasm');
let sessionPromise: Promise<{ ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }> | null = null;

function loadSession() {
  sessionPromise ??= (async () => {
    // wasm-only build: the default entry pulls the WebGPU (jsep) variant, which is not shipped here
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1; // more threads need cross-origin isolation
    const session = await ort.InferenceSession.create('/ml/u2netp.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session };
  })().catch((e) => { sessionPromise = null; throw e; });
  return sessionPromise;
}

async function toRaster(file: Blob): Promise<RasterImage> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  return { width: w, height: h, data: new Uint8ClampedArray(data) };
}

async function segment(image: RasterImage) {
  const { ort, session } = await loadSession();
  const input = resizeRaster(image, N, N);
  const chw = toCHWFloat(input, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], true);
  const out = await session.run({ 'input.1': new ort.Tensor('float32', chw, [1, 3, N, N]) });
  const d0 = out[session.outputNames[0]!]!.data as Float32Array;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < d0.length; i++) { mn = Math.min(mn, d0[i]!); mx = Math.max(mx, d0[i]!); }
  const small: GrayImage = { width: N, height: N, data: new Uint8ClampedArray(N * N) };
  for (let i = 0; i < d0.length; i++) small.data[i] = ((d0[i]! - mn) / (mx - mn || 1)) * 255;
  const soft = resizeGray(small, image.width, image.height);
  const post = postprocessSoftMask(soft, THRESHOLD);
  const mask = carveBackground(image.data, soft.data, post.mask, image.width, image.height).mask;
  const quality = assessMask(mask, image.width, image.height);
  return { mask, quality: quality.status };
}

/** texture (background in the base colour) and a dimmed preview with the points drawn */
async function renderOutputs(img: RasterImage, mask: Uint8Array, rgb: [number, number, number], points: { x: number; y: number }[]) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const tex = ctx.createImageData(img.width, img.height);
  const prev = ctx.createImageData(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const inside = mask[i] === 1;
    for (let k = 0; k < 3; k++) {
      tex.data[i * 4 + k] = inside ? img.data[i * 4 + k]! : rgb[k]!;
      prev.data[i * 4 + k] = inside ? img.data[i * 4 + k]! : img.data[i * 4 + k]! * 0.25 + 40;
    }
    tex.data[i * 4 + 3] = 255; prev.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(tex, 0, 0);
  const texture = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('texture encode failed'))), 'image/jpeg', 0.88));
  ctx.putImageData(prev, 0, 0);
  const backdrop = canvas.toDataURL('image/jpeg', 0.8);
  ctx.fillStyle = '#1f3ff0';
  const r = Math.max(3, Math.round(Math.min(img.width, img.height) * 0.012));
  for (const p of points) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
  return { texture, preview: canvas.toDataURL('image/jpeg', 0.8), backdrop };
}

/** Top photo (front view, sleeves away from the body) → package for the figure's top: T-shirt or long-sleeved top. */
export async function analyzeTShirtPhoto(file: Blob, category: 'tshirt' | 'top' = 'tshirt'): Promise<Analysis> {
  const t0 = performance.now();
  const img = await toRaster(file);
  const { mask, quality } = await segment(img);
  const lm = estimateTShirtLandmarks(mask, img.width, img.height);
  const points = Object.fromEntries(Object.entries(lm.points).map(([k, p]) => [k, { x: p.x, y: p.y }])) as Record<PhotoPointName, { x: number; y: number }>;
  const anchors = anchorsFromLandmarks(points, mask, img.width, img.height);
  const issues = anchorIssues(anchors);
  const color = estimateBaseColor(img, mask);
  const { texture, preview, backdrop } = await renderOutputs(img, mask, color.rgb, Object.values(points));
  return {
    pkg: {
      version: 1, category, anchors, baseColor: color.hex, maskQuality: quality, landmarkStatus: lm.status,
      anchorIssues: issues, needsReview: lm.status !== 'ok' || issues.length > 0 || quality !== 'ok', provider: MASK_PROVIDER,
      pointsSource: 'auto',
    },
    texture, preview, ms: Math.round(performance.now() - t0),
    edit: { mask, width: img.width, height: img.height, points, backdrop },
  };
}

/**
 * The person moved the points in the form: the anchors (edge rows from the mask) and their plausibility are
 * recomputed from those points exactly as from estimated ones. The points are now the person's ('user'), so the
 * estimator's 'uncertain' no longer applies; the plausibility checks and the mask status still do.
 */
export function withUserPoints(a: Analysis, points: Record<PhotoPointName, { x: number; y: number }>): Analysis {
  if (!a.edit || a.pkg.category === 'pants') return a;
  const anchors = anchorsFromLandmarks(points, a.edit.mask, a.edit.width, a.edit.height);
  const issues = anchorIssues(anchors);
  return {
    ...a,
    pkg: { ...a.pkg, anchors, landmarkStatus: 'ok', anchorIssues: issues, needsReview: issues.length > 0 || a.pkg.maskQuality !== 'ok', pointsSource: 'user' },
    edit: { ...a.edit, points },
  };
}

/** Trousers / jeans photo (front view, legs apart) → package for the figure's lower garment (I-53). */
export async function analyzePantsPhoto(file: Blob): Promise<Analysis> {
  const t0 = performance.now();
  const img = await toRaster(file);
  const { mask, quality } = await segment(img);
  const lm = estimatePantsLandmarks(mask, img.width, img.height);
  if (!lm.anchors) throw new Error(`Could not find the pant legs in the photo: ${lm.reasons.join('; ')}. Photograph the pants from the front with the legs apart.`);
  const color = estimateBaseColor(img, mask);
  const { texture, preview } = await renderOutputs(img, mask, color.rgb, Object.values(lm.points));
  return {
    pkg: {
      version: 1, category: 'pants', anchors: lm.anchors, baseColor: color.hex, maskQuality: quality, landmarkStatus: lm.status,
      anchorIssues: lm.reasons, needsReview: lm.status !== 'ok' || quality !== 'ok', provider: MASK_PROVIDER,
    },
    texture, preview, ms: Math.round(performance.now() - t0),
  };
}
