'use client';
/**
 * Photo → garment package, in the browser. Same steps and parameters as the 3D module's pipeline
 * (3dmodel: SegmentationProvider U²-Netp, landmarks.ts, color.ts, imported-body/src/photoMap.ts):
 *   mask (U²-Netp, 320×320, post-processing post-v2) → T-shirt landmarks from the mask → photo anchors and their
 *   plausibility → median base colour → texture = the photo with everything outside the mask in the base colour.
 * Runs locally with onnxruntime-web (wasm, one thread); the photo is not sent anywhere for this.
 * The model and the runtime files are served from /ml and /ort (npm run ml:sync in the FitCast root).
 */
import { resizeGray, resizeRaster, toCHWFloat, type GrayImage, type RasterImage } from './raster';
import { assessMask, postprocessSoftMask } from './maskOps';
import { estimateTShirtLandmarks } from './landmarks';
import { estimateBaseColor } from './color';
import { anchorIssues, anchorsFromLandmarks, type PhotoAnchors, type PhotoPointName } from '../figure/photoMap';

export const MASK_PROVIDER = 'u2netp.onnx@sha256:309c8469…4ddd8;post-v2';
const N = 320;
const THRESHOLD = 128;
/** longest side the analysis works at; larger photos are scaled down first (speed, texture size) */
const MAX_SIDE = 1024;

export interface GarmentPackage {
  version: 1;
  category: 'tshirt';
  anchors: PhotoAnchors;
  baseColor: string;
  maskQuality: 'ok' | 'suspicious' | 'empty';
  landmarkStatus: 'ok' | 'uncertain';
  anchorIssues: string[];
  /** true when the points must be confirmed by a person before the print is trusted */
  needsReview: boolean;
  provider: string;
}

export interface Analysis {
  pkg: GarmentPackage;
  texture: Blob;
  /** small preview: photo dimmed outside the mask, for the form */
  preview: string;
  ms: number;
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
  const quality = assessMask(post.mask, image.width, image.height);
  return { mask: post.mask, quality: quality.status };
}

export async function analyzeTShirtPhoto(file: Blob): Promise<Analysis> {
  const t0 = performance.now();
  const img = await toRaster(file);
  const { mask, quality } = await segment(img);
  const lm = estimateTShirtLandmarks(mask, img.width, img.height);
  const points = Object.fromEntries(Object.entries(lm.points).map(([k, p]) => [k, { x: p.x, y: p.y }])) as Record<PhotoPointName, { x: number; y: number }>;
  const anchors = anchorsFromLandmarks(points, mask, img.width, img.height);
  const issues = anchorIssues(anchors);
  const color = estimateBaseColor(img, mask);

  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const tex = ctx.createImageData(img.width, img.height);
  const prev = ctx.createImageData(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const inside = mask[i] === 1;
    for (let k = 0; k < 3; k++) {
      tex.data[i * 4 + k] = inside ? img.data[i * 4 + k]! : color.rgb[k]!;
      prev.data[i * 4 + k] = inside ? img.data[i * 4 + k]! : img.data[i * 4 + k]! * 0.25 + 40;
    }
    tex.data[i * 4 + 3] = 255; prev.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(tex, 0, 0);
  const texture = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('texture encode failed'))), 'image/jpeg', 0.88));
  ctx.putImageData(prev, 0, 0);
  // landmarks over the preview, so the user sees what the print will follow
  ctx.fillStyle = '#1f3ff0';
  const r = Math.max(3, Math.round(Math.min(img.width, img.height) * 0.012));
  for (const p of Object.values(points)) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
  const preview = canvas.toDataURL('image/jpeg', 0.8);

  return {
    pkg: {
      version: 1, category: 'tshirt', anchors, baseColor: color.hex, maskQuality: quality, landmarkStatus: lm.status,
      anchorIssues: issues, needsReview: lm.status !== 'ok' || issues.length > 0 || quality !== 'ok', provider: MASK_PROVIDER,
    },
    texture, preview, ms: Math.round(performance.now() - t0),
  };
}
