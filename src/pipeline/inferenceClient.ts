/**
 * Promise API over the inference worker with job ids and AbortSignal support.
 * Aborting a job does not stop the wasm computation mid-way (not possible),
 * but the result is dropped and never delivered; `terminate()` kills the
 * worker outright (used when a photo is replaced while a job runs).
 */
import type { RasterImage } from '../image/raster';
import type { CategoryResult } from '../providers/CategoryProvider';
import type { SegmentationResult } from '../providers/SegmentationProvider';
import type { WorkerRequest, WorkerResponse } from './worker';

export interface ProvidersInfo {
  category: { id: string; version: string; description: string };
  segmentation: { id: string; version: string; description: string };
  loadMs: number;
  backend: string;
}

export class InferenceClient {
  private worker: Worker | null = null;
  private jobCounter = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private loaded: Promise<ProvidersInfo> | null = null;
  info: ProvidersInfo | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'loaded') return; // handled by load()
      if (m.type === 'error') {
        if (m.jobId !== undefined) {
          this.pending.get(m.jobId)?.reject(new Error(m.message));
          this.pending.delete(m.jobId);
        } else {
          for (const p of this.pending.values()) p.reject(new Error(m.message));
          this.pending.clear();
        }
        return;
      }
      const p = this.pending.get(m.jobId);
      if (!p) return; // dropped (aborted) job
      this.pending.delete(m.jobId);
      p.resolve(m.result);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'worker error'));
      this.pending.clear();
    };
    return this.worker;
  }

  /** Loads models (fetches weights the first time). Safe to call repeatedly. */
  load(): Promise<ProvidersInfo> {
    if (this.loaded) return this.loaded;
    const w = this.ensureWorker();
    this.loaded = new Promise<ProvidersInfo>((resolve, reject) => {
      const onMsg = (ev: MessageEvent<WorkerResponse>) => {
        if (ev.data.type === 'loaded') {
          w.removeEventListener('message', onMsg);
          this.info = { category: ev.data.category, segmentation: ev.data.segmentation, loadMs: ev.data.loadMs, backend: ev.data.backend };
          resolve(this.info);
        } else if (ev.data.type === 'error' && ev.data.jobId === undefined) {
          w.removeEventListener('message', onMsg);
          this.loaded = null;
          reject(new Error(ev.data.message));
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'load' } satisfies WorkerRequest);
    });
    return this.loaded;
  }

  private run<T>(type: 'category' | 'segment', image: RasterImage, signal?: AbortSignal): Promise<T> {
    const w = this.ensureWorker();
    const jobId = ++this.jobCounter;
    // copy so the caller keeps its buffer
    const data = image.data.slice().buffer;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));
      this.pending.set(jobId, { resolve: resolve as (v: unknown) => void, reject });
      signal?.addEventListener('abort', () => {
        if (this.pending.delete(jobId)) reject(new Error('aborted'));
      });
      w.postMessage({ type, jobId, image: { width: image.width, height: image.height, data } } satisfies WorkerRequest, [data]);
    });
  }

  category(image: RasterImage, signal?: AbortSignal): Promise<CategoryResult> {
    return this.run<CategoryResult>('category', image, signal);
  }

  segment(image: RasterImage, signal?: AbortSignal): Promise<SegmentationResult> {
    return this.run<SegmentationResult>('segment', image, signal);
  }

  /** Kill the worker (drops all pending jobs). The next call starts a fresh one and reloads weights (browser-cached). */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.loaded = null;
    this.info = null;
    for (const p of this.pending.values()) p.reject(new Error('terminated'));
    this.pending.clear();
  }
}
