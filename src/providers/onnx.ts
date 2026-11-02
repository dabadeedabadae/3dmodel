/**
 * Thin wrapper over onnxruntime-web so providers do not depend on how the
 * runtime is configured. Works in the browser (wasm / webgpu) and in node
 * (wasm) — scripts/eval-fixtures.ts uses the same providers as the page.
 *
 * Model files live in public/models/ (served by Vite at /models/...). In node,
 * pass a filesystem path instead of a URL.
 */
import * as ort from 'onnxruntime-web';

export type OrtSession = ort.InferenceSession;
export const OrtTensor = ort.Tensor;

export interface OnnxOptions {
  /** Prefer WebGPU when available (browser only). Default false: wasm everywhere for reproducibility. */
  preferWebGpu?: boolean;
  /** Number of wasm threads (browser needs cross-origin isolation for >1). */
  wasmThreads?: number;
}

let configured = false;
export function configureOrt(opts: OnnxOptions = {}): void {
  if (configured) return;
  configured = true;
  if (typeof window !== 'undefined') {
    // Vite serves node_modules/onnxruntime-web/dist/*.wasm when copied to public/ort/ (see vite.config.ts)
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = opts.wasmThreads ?? 1;
  }
}

export async function loadSession(modelPathOrUrl: string, opts: OnnxOptions = {}): Promise<OrtSession> {
  configureOrt(opts);
  const providers: ort.InferenceSession.ExecutionProviderConfig[] = [];
  if (opts.preferWebGpu && typeof navigator !== 'undefined' && 'gpu' in navigator) providers.push('webgpu');
  providers.push('wasm');
  return ort.InferenceSession.create(modelPathOrUrl, { executionProviders: providers, graphOptimizationLevel: 'all' });
}

export function float32Tensor(data: Float32Array, dims: number[]): ort.Tensor {
  return new ort.Tensor('float32', data, dims);
}
