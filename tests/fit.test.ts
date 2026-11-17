import { describe, expect, it } from 'vitest';
import { computeFrame } from '../src/body/anatomy';
import { BODY_PRESETS, defaultBodyParams } from '../src/body/params';
import { fitTShirtToBody } from '../src/fitting/fitTShirt';
import { defaultTShirtParams } from '../src/templates/tshirt/params';

const frameOf = (id: string) => {
  const pr = BODY_PRESETS.find((p) => p.id === id)!;
  return computeFrame({ ...defaultBodyParams(pr.sex), ...pr.params });
};

describe('F01–F02 fitTShirtToBody', () => {
  it('fit-to-body mode: no vertex inside the body, arm inside sleeves, for all presets', () => {
    for (const pr of BODY_PRESETS) {
      const f = fitTShirtToBody(defaultTShirtParams(), frameOf(pr.id), pr.id, { fitToBody: true });
      expect(f.checks.filter((c) => !c.pass && c.level === 'fail').map((c) => c.name + ': ' + c.detail), pr.id).toEqual([]);
      expect(f.status).not.toBe('intersects');
    }
  });
  it('scale comes from the chosen anchor only; photo params are never modified in place', () => {
    const p = defaultTShirtParams();
    const copy = { ...p };
    const frame = frameOf('male-m');
    const fc = fitTShirtToBody(p, frame, 'b', { anchor: 'chest', fitToBody: true });
    const fs = fitTShirtToBody(p, frame, 'b', { anchor: 'shoulder', fitToBody: true });
    expect(fc.scale).toBeCloseTo((frame.torso.chest.a + 0.03) / p.chestHalfWidth, 9);
    expect(fs.scale).toBeCloseTo((frame.params.shoulderWidth / 2 + 0.008) / p.shoulderHalfWidth, 9);
    expect(p).toEqual(copy);
  });
  it('as-photographed mode keeps every template param and moves no vertex; statuses are reported', () => {
    const p = defaultTShirtParams();
    const f = fitTShirtToBody(p, frameOf('female-m'), 'b', { fitToBody: false });
    expect(f.fitAdjust).toEqual([]);
    expect(f.params).toEqual(p);
    expect(f.pushedVertices).toBe(0);
    expect(f.rings.length).toBeGreaterThan(5);
    expect(f.rings.every((r) => ['tight', 'ok', 'loose', 'free'].includes(r.status))).toBe(true);
  });
  it('is deterministic and never accumulates (same input → identical positions)', () => {
    const p = defaultTShirtParams();
    const frame = frameOf('male-l');
    const a = fitTShirtToBody(p, frame, 'b');
    const b = fitTShirtToBody(p, frame, 'b');
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
  it('fitAdjust only widens and explains; a tiny tee on a large body needs more adjustments than on a small one', () => {
    const tiny = { ...defaultTShirtParams(), chestHalfWidth: 0.3, hemHalfWidth: 0.3, shoulderHalfWidth: 0.3, cuffRadius: 0.06 };
    const big = fitTShirtToBody(tiny, frameOf('male-l'), 'b', { anchor: 'shoulder' });
    for (const a of big.fitAdjust) {
      expect(a.to).toBeGreaterThan(a.from);
      expect(a.reason.length).toBeGreaterThan(0);
    }
    expect(big.status).not.toBe('intersects');
  });
});
