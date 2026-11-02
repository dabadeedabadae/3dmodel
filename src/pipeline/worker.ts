/**
 * Inference worker: hosts the category and segmentation providers so the
 * UI thread never blocks on onnxruntime (wasm, single thread by default).
 *
 * Messages in:  { type:'load' } | { type:'category'|'segment', jobId, image: {width,height,data:ArrayBuffer} } | { type:'dispose' }
 * Messages out: { type:'loaded', ... } | { type:'result', jobId, result } | { type:'error', jobId?, message }
 */
import * as ort from 'onnxruntime-web';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { RasterImage } from '../image/raster';
import { ImageNetCategoryProvider, type CategoryResult } from '../providers/CategoryProvider';
import { U2NetpSegmentationProvider, type SegmentationResult } from '../providers/SegmentationProvider';

export type WorkerRequest =
  | { type: 'load' }
  | { type: 'category'; jobId: number; image: { width: number; height: number; data: ArrayBuffer } }
  | { type: 'segment'; jobId: number; image: { width: number; height: number; data: ArrayBuffer } }
  | { type: 'dispose' };

export type WorkerResponse =
  | { type: 'loaded'; category: { id: string; version: string; description: string }; segmentation: { id: string; version: string; description: string }; loadMs: number; backend: string }
  | { type: 'result'; jobId: number; kind: 'category'; result: CategoryResult }
  | { type: 'result'; jobId: number; kind: 'segment'; result: SegmentationResult; transfer?: undefined }
  | { type: 'error'; jobId?: number; message: string };

const abs = (u: string) => new URL(u, self.location.href).href;
ort.env.wasm.wasmPaths = { wasm: abs(ortWasmUrl), mjs: abs(ortMjsUrl) };
ort.env.wasm.numThreads = 1; // >1 needs cross-origin isolation; keep deterministic

const modelBase = new URL(import.meta.env.BASE_URL + 'models/', self.location.href).href;
let category: ImageNetCategoryProvider | null = null;
let segmentation: U2NetpSegmentationProvider | null = null;

async function ensureLoaded(): Promise<{ loadMs: number }> {
  const t0 = performance.now();
  if (!category) {
    const synset = await (await fetch(modelBase + 'synset.txt')).text();
    category = new ImageNetCategoryProvider(modelBase + 'mobilenetv2-12.onnx', synset);
    await category.load();
  }
  if (!segmentation) {
    segmentation = new U2NetpSegmentationProvider(modelBase + 'u2netp.onnx');
    await segmentation.load();
  }
  return { loadMs: performance.now() - t0 };
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      const { loadMs } = await ensureLoaded();
      post({
        type: 'loaded',
        category: { id: category!.id, version: category!.version, description: category!.description },
        segmentation: { id: segmentation!.id, version: segmentation!.version, description: segmentation!.description },
        loadMs,
        backend: 'wasm',
      });
      return;
    }
    if (msg.type === 'dispose') {
      await category?.dispose();
      await segmentation?.dispose();
      category = null;
      segmentation = null;
      return;
    }
    await ensureLoaded();
    const image: RasterImage = { width: msg.image.width, height: msg.image.height, data: new Uint8ClampedArray(msg.image.data) };
    if (msg.type === 'category') {
      const result = await category!.suggest(image);
      post({ type: 'result', jobId: msg.jobId, kind: 'category', result });
    } else if (msg.type === 'segment') {
      const result = await segmentation!.segment(image);
      post({ type: 'result', jobId: msg.jobId, kind: 'segment', result }, [result.soft.buffer, result.binary.buffer, result.thresholded.buffer]);
    }
  } catch (e) {
    post({ type: 'error', jobId: 'jobId' in msg ? msg.jobId : undefined, message: e instanceof Error ? e.message : String(e) });
  }
};
