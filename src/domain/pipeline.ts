/**
 * Pipeline state for one garment being processed.
 *
 *   photo_loaded -> category_confirmed -> mask_confirmed -> shape_confirmed
 *     -> texture_ready -> preview_ready -> saved
 *
 * Rules enforced here:
 *  - Each stage has idle/running/success/error/cancelled and an input version.
 *  - Changing an earlier stage invalidates every dependent (later) stage.
 *  - A job started for an older input version (or superseded by a newer job)
 *    can never write its result into the store: stale async responses are
 *    dropped, not applied.
 *  - Cancellation goes through AbortSignal so providers can stop real work.
 */

import type { StageResult, StageStatus } from './types';

export const PIPELINE_STAGES = [
  'photo_loaded',
  'category_confirmed',
  'mask_confirmed',
  'shape_confirmed',
  'texture_ready',
  'preview_ready',
  'saved',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

export interface PipelineEvent {
  type: 'stage_changed' | 'invalidated' | 'job_started' | 'job_finished' | 'job_dropped';
  stage: PipelineStage;
  jobId?: number;
  reason?: string;
}

type Listener = (e: PipelineEvent) => void;

interface JobHandle {
  jobId: number;
  inputVersion: string;
  controller: AbortController;
}

export class PipelineStore {
  private readonly results = new Map<PipelineStage, StageResult<unknown>>();
  private readonly inputs = new Map<PipelineStage, string>();
  private readonly jobs = new Map<PipelineStage, JobHandle>();
  private readonly listeners = new Set<Listener>();
  private versionCounter = 0;
  private jobCounter = 0;

  constructor() {
    for (const s of PIPELINE_STAGES) {
      this.results.set(s, { status: 'idle', inputVersion: '', value: null });
      this.inputs.set(s, '');
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: PipelineEvent) {
    for (const l of this.listeners) l(e);
  }

  get<T = unknown>(stage: PipelineStage): StageResult<T> {
    return this.results.get(stage) as StageResult<T>;
  }

  status(stage: PipelineStage): StageStatus {
    return this.get(stage).status;
  }

  inputVersion(stage: PipelineStage): string {
    return this.inputs.get(stage) ?? '';
  }

  /** Snapshot of all stages (for UI / debugging). */
  snapshot(): Record<PipelineStage, StageResult<unknown>> {
    const out = {} as Record<PipelineStage, StageResult<unknown>>;
    for (const s of PIPELINE_STAGES) out[s] = { ...this.get(s) };
    return out;
  }

  /**
   * Declare new inputs for a stage. Returns the new input version. Every later
   * stage is invalidated (its value dropped, status -> idle, running jobs
   * cancelled). The stage itself is reset to idle as well.
   */
  setInput(stage: PipelineStage, inputKey: string): string {
    this.versionCounter += 1;
    const version = `${inputKey}#${this.versionCounter}`;
    this.inputs.set(stage, version);
    this.invalidateFrom(stage, 'input_changed');
    return version;
  }

  /** Invalidate `stage` and everything after it. */
  invalidateFrom(stage: PipelineStage, reason = 'invalidated'): void {
    const from = stageIndex(stage);
    for (let i = from; i < PIPELINE_STAGES.length; i++) {
      const s = PIPELINE_STAGES[i]!;
      this.cancel(s, reason);
      const prev = this.results.get(s)!;
      if (prev.status !== 'idle' || prev.value !== null) {
        this.results.set(s, { status: 'idle', inputVersion: '', value: null });
        this.emit({ type: 'invalidated', stage: s, reason });
      }
      if (i > from) this.inputs.set(s, '');
    }
  }

  /** Cancel the running job of a stage (if any). The stage becomes `cancelled`. */
  cancel(stage: PipelineStage, reason = 'cancelled'): boolean {
    const job = this.jobs.get(stage);
    if (!job) return false;
    job.controller.abort(reason);
    this.jobs.delete(stage);
    this.results.set(stage, { status: 'cancelled', inputVersion: job.inputVersion, value: null });
    this.emit({ type: 'stage_changed', stage, jobId: job.jobId, reason });
    return true;
  }

  /**
   * Run `work` for a stage against its current input version. A previous job
   * for the same stage is aborted. The returned promise resolves to `true` if
   * the result was applied, `false` if it was dropped as stale/cancelled.
   */
  async run<T>(stage: PipelineStage, work: (signal: AbortSignal) => Promise<T>): Promise<boolean> {
    const inputVersion = this.inputVersion(stage);
    if (!inputVersion) {
      throw new Error(`pipeline: stage "${stage}" has no input; call setInput first`);
    }
    const previousStageOk = stageIndex(stage) === 0 || this.get(PIPELINE_STAGES[stageIndex(stage) - 1]!).status === 'success';
    if (!previousStageOk) {
      throw new Error(`pipeline: cannot run "${stage}" before the previous stage succeeded`);
    }

    this.cancel(stage, 'superseded');
    this.jobCounter += 1;
    const handle: JobHandle = { jobId: this.jobCounter, inputVersion, controller: new AbortController() };
    this.jobs.set(stage, handle);
    this.results.set(stage, { status: 'running', inputVersion, value: null });
    this.emit({ type: 'job_started', stage, jobId: handle.jobId });

    let value: T;
    try {
      value = await work(handle.controller.signal);
    } catch (err) {
      if (!this.isCurrent(stage, handle)) {
        this.emit({ type: 'job_dropped', stage, jobId: handle.jobId, reason: 'stale_error' });
        return false;
      }
      this.jobs.delete(stage);
      this.results.set(stage, {
        status: handle.controller.signal.aborted ? 'cancelled' : 'error',
        inputVersion,
        value: null,
        error: err instanceof Error ? err.message : String(err),
      });
      this.emit({ type: 'job_finished', stage, jobId: handle.jobId, reason: 'error' });
      return false;
    }

    if (!this.isCurrent(stage, handle)) {
      // Input changed or a newer job replaced us while we were running.
      this.emit({ type: 'job_dropped', stage, jobId: handle.jobId, reason: 'stale' });
      return false;
    }
    this.jobs.delete(stage);
    this.results.set(stage, { status: 'success', inputVersion, value });
    this.emit({ type: 'job_finished', stage, jobId: handle.jobId, reason: 'success' });
    return true;
  }

  /** Mark a stage as succeeded synchronously (e.g. a user confirmation). */
  setResult<T>(stage: PipelineStage, value: T): void {
    const inputVersion = this.inputVersion(stage);
    if (!inputVersion) throw new Error(`pipeline: stage "${stage}" has no input; call setInput first`);
    this.cancel(stage, 'replaced');
    this.results.set(stage, { status: 'success', inputVersion, value });
    this.emit({ type: 'stage_changed', stage });
  }

  private isCurrent(stage: PipelineStage, handle: JobHandle): boolean {
    const current = this.jobs.get(stage);
    return !!current && current.jobId === handle.jobId && this.inputVersion(stage) === handle.inputVersion;
  }
}
