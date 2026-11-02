import { describe, expect, it } from 'vitest';
import { PIPELINE_STAGES, PipelineStore } from '../src/domain/pipeline';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('PipelineStore', () => {
  it('starts idle for every stage', () => {
    const p = new PipelineStore();
    for (const s of PIPELINE_STAGES) expect(p.status(s)).toBe('idle');
  });

  it('changing the photo invalidates mask, shape and texture results', async () => {
    const p = new PipelineStore();
    p.setInput('photo_loaded', 'photo-A');
    await p.run('photo_loaded', async () => ({ photoId: 'A' }));
    p.setInput('category_confirmed', 'tshirt');
    p.setResult('category_confirmed', 'tshirt');
    p.setInput('mask_confirmed', 'mask-A');
    await p.run('mask_confirmed', async () => ({ maskId: 'mA' }));
    p.setInput('shape_confirmed', 'params-A');
    await p.run('shape_confirmed', async () => ({ length: 0.7 }));
    p.setInput('texture_ready', 'tex-A');
    await p.run('texture_ready', async () => ({ textureId: 'tA' }));
    expect(p.status('texture_ready')).toBe('success');

    // new photo -> everything after it is gone, nothing stale survives
    p.setInput('photo_loaded', 'photo-B');
    expect(p.status('photo_loaded')).toBe('idle');
    for (const s of ['category_confirmed', 'mask_confirmed', 'shape_confirmed', 'texture_ready', 'preview_ready', 'saved'] as const) {
      expect(p.status(s)).toBe('idle');
      expect(p.get(s).value).toBeNull();
      expect(p.inputVersion(s)).toBe('');
    }
  });

  it('changing the category keeps the photo but drops mask/shape/texture', async () => {
    const p = new PipelineStore();
    p.setInput('photo_loaded', 'photo-A');
    await p.run('photo_loaded', async () => 'A');
    p.setInput('category_confirmed', 'tshirt');
    p.setResult('category_confirmed', 'tshirt');
    p.setInput('mask_confirmed', 'm');
    await p.run('mask_confirmed', async () => 'mask');
    p.setInput('category_confirmed', 'pants');
    expect(p.status('photo_loaded')).toBe('success');
    expect(p.status('category_confirmed')).toBe('idle');
    expect(p.status('mask_confirmed')).toBe('idle');
    expect(p.get('mask_confirmed').value).toBeNull();
  });

  it('a stale async result cannot overwrite a newer input', async () => {
    const p = new PipelineStore();
    p.setInput('photo_loaded', 'photo-A');
    let resolveA!: (v: string) => void;
    const jobA = p.run('photo_loaded', () => new Promise<string>((r) => (resolveA = r)));
    // photo changes while job A is still running
    p.setInput('photo_loaded', 'photo-B');
    const appliedB = await p.run('photo_loaded', async () => 'result-B');
    expect(appliedB).toBe(true);
    resolveA('result-A'); // old job finishes late
    const appliedA = await jobA;
    expect(appliedA).toBe(false);
    expect(p.get('photo_loaded').value).toBe('result-B');
  });

  it('a superseded job for the same input is aborted and dropped', async () => {
    const p = new PipelineStore();
    p.setInput('photo_loaded', 'photo-A');
    let abortedSeen = false;
    const first = p.run('photo_loaded', (signal) => new Promise<string>((resolve) => {
      signal.addEventListener('abort', () => {
        abortedSeen = true;
        resolve('late');
      });
    }));
    const second = await p.run('photo_loaded', async () => 'fresh');
    expect(second).toBe(true);
    expect(await first).toBe(false);
    expect(abortedSeen).toBe(true);
    expect(p.get('photo_loaded').value).toBe('fresh');
  });

  it('cancel aborts the signal and marks the stage cancelled', async () => {
    const p = new PipelineStore();
    p.setInput('photo_loaded', 'photo-A');
    let aborted = false;
    const job = p.run('photo_loaded', (signal) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('aborted'));
    })));
    expect(p.status('photo_loaded')).toBe('running');
    expect(p.cancel('photo_loaded')).toBe(true);
    expect(aborted).toBe(true);
    expect(await job).toBe(false);
    expect(p.status('photo_loaded')).toBe('cancelled');
  });

  it('errors are recorded, not swallowed', async () => {
    const p = new PipelineStore();
    p.setInput('photo_loaded', 'photo-A');
    const applied = await p.run('photo_loaded', async () => {
      throw new Error('decoder failed');
    });
    expect(applied).toBe(false);
    expect(p.status('photo_loaded')).toBe('error');
    expect(p.get('photo_loaded').error).toBe('decoder failed');
  });

  it('refuses to run a stage whose predecessor has not succeeded', async () => {
    const p = new PipelineStore();
    p.setInput('mask_confirmed', 'm');
    await expect(p.run('mask_confirmed', async () => 1)).rejects.toThrow(/previous stage/);
  });

  it('emits events in order', async () => {
    const p = new PipelineStore();
    const events: string[] = [];
    p.subscribe((e) => events.push(`${e.type}:${e.stage}`));
    p.setInput('photo_loaded', 'A');
    await p.run('photo_loaded', async () => 1);
    p.setInput('photo_loaded', 'B');
    expect(events).toEqual(['job_started:photo_loaded', 'job_finished:photo_loaded', 'invalidated:photo_loaded']);
    await tick();
  });
});
