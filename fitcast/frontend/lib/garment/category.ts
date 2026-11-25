'use client';
/**
 * Photo → suggested garment type, on this device (I-75). MobileNetV2-12 (ONNX model zoo, ImageNet-1k,
 * Apache-2.0, 14 MB, served from /ml) with the ONNX zoo preprocessing: shorter side 256, centre crop 224,
 * ImageNet mean/std. Classes are mapped to garment types in garmentType.ts — the same map the module's
 * evaluation uses (3dmodel: npm run eval:type). The photo is not sent anywhere for this.
 * The result is a suggestion: the wardrobe form pre-selects it, says so, and offers the alternatives.
 */
import { centerCropSquare, resizeRaster, softmax, toCHWFloat, type RasterImage } from './raster';
import { suggestGarmentType, type TypeSuggestion } from './garmentType';
import { shapeFacts } from './shape';

export const TYPE_PROVIDER = 'mobilenetv2-12.onnx;imagenet→type map-v1;outline-v1';

type Ort = typeof import('onnxruntime-web/wasm');
let modelPromise: Promise<{ ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession; labels: string[] }> | null = null;

function loadModel() {
  modelPromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    const [session, synset] = await Promise.all([
      ort.InferenceSession.create('/ml/mobilenetv2-12.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }),
      fetch('/ml/synset.txt').then((r) => { if (!r.ok) throw new Error('synset ' + r.status); return r.text(); }),
    ]);
    const labels = synset.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^n\d+\s+/, ''));
    if (labels.length !== 1000) throw new Error(`synset: expected 1000 labels, got ${labels.length}`);
    return { ort, session, labels };
  })().catch((e) => { modelPromise = null; throw e; });
  return modelPromise;
}

async function decode(file: Blob): Promise<RasterImage> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = 256 / Math.min(bmp.width, bmp.height);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // transparent PNGs: white, as in the evaluation
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { width: w, height: h, data: new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data) };
}

export async function suggestTypeFromPhoto(file: Blob): Promise<TypeSuggestion & { ms: number }> {
  const t0 = performance.now();
  // the garment's outline (two legs, sleeves, a hem that widens) corrects the texture-driven classes (I-80);
  // without a mask the classifier answers alone, as before
  const outline = import('./analyze').then((m) => m.segmentPhoto(file))
    .then((s) => (s.quality === 'empty' ? null : shapeFacts(s.mask, s.img.width, s.img.height))).catch(() => null);
  const [{ ort, session, labels }, img] = await Promise.all([loadModel(), decode(file)]);
  const square = centerCropSquare(resizeRaster(img, img.width, img.height)).image;
  const chw = toCHWFloat(resizeRaster(square, 224, 224), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
  const out = await session.run({ input: new ort.Tensor('float32', chw, [1, 3, 224, 224]) });
  const probs = softmax(out[session.outputNames[0]!]!.data as Float32Array);
  return { ...suggestGarmentType(probs, labels, await outline), ms: Math.round(performance.now() - t0) };
}
