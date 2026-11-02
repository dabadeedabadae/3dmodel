import { describe, expect, it } from 'vitest';
import { checkFixedTopology, checkTShirtMesh, sampleParamSets } from '../src/templates/checks';
import { buildTShirt, updateTShirt } from '../src/templates/tshirt/buildTShirt';
import { clampTShirtParams, defaultTShirtParams, TSHIRT_PARAM_LIMITS, TSHIRT_TOPOLOGY_VERSION } from '../src/templates/tshirt/params';
import { armholeRingElevation } from '../src/templates/tshirt/rows';
import { CATEGORY_TEMPLATE, templateForCategory } from '../src/templates/registry';

describe('tshirt-basic geometry', () => {
  it('canonical shirt passes every blocking check', () => {
    const m = buildTShirt();
    const r = checkTShirtMesh(m, { stretchTolerance: 1.5 });
    const failures = r.results.filter((x) => !x.pass && x.level === 'fail').map((x) => `${x.name}: ${x.detail}`);
    expect(failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(m.topologyVersion).toBe(TSHIRT_TOPOLOGY_VERSION);
    m.geometry.dispose();
  });

  it('has exactly four openings: hem(16), neck(16), two cuffs(8)', () => {
    const m = buildTShirt();
    const r = checkTShirtMesh(m);
    expect(r.summary.boundaryLoops).toEqual([8, 8, 16, 16]);
    m.geometry.dispose();
  });

  it('has five UV islands with their own material groups', () => {
    const m = buildTShirt();
    expect(m.islands.map((i) => i.name)).toEqual(['front', 'back', 'sleeve_left', 'sleeve_right', 'collar']);
    expect(m.geometry.groups.length).toBe(5);
    expect(new Set(m.geometry.groups.map((g) => g.materialIndex)).size).toBe(5);
    m.geometry.dispose();
  });

  it('is low-poly', () => {
    const m = buildTShirt();
    expect(m.stats.triangles).toBeLessThan(400);
    expect(m.stats.triangles).toBe(272);
    m.geometry.dispose();
  });

  it('keeps topology and UVs fixed across random parameter sets', () => {
    expect(checkFixedTopology(10).pass).toBe(true);
  });

  it('passes blocking checks for random in-range parameter sets', () => {
    for (const p of sampleParamSets(12, 7)) {
      const m = buildTShirt(p);
      const r = checkTShirtMesh(m, { stretchTolerance: 3 });
      const failures = r.results.filter((x) => !x.pass && x.level === 'fail').map((x) => `${x.name}: ${x.detail}`);
      expect(failures, JSON.stringify(p)).toEqual([]);
      m.geometry.dispose();
    }
  });

  it('updateTShirt deforms in place from the canonical base without accumulation', () => {
    const m = buildTShirt();
    const basePos = Float32Array.from(m.geometry.attributes.position!.array as Float32Array);
    updateTShirt(m, { length: 0.9 });
    updateTShirt(m, { length: 0.5 });
    updateTShirt(m, defaultTShirtParams());
    const again = m.geometry.attributes.position!.array as Float32Array;
    for (let i = 0; i < basePos.length; i++) expect(again[i]).toBeCloseTo(basePos[i]!, 6);
    m.geometry.dispose();
  });

  it('clamps out-of-range parameters and reports it', () => {
    const r = clampTShirtParams({ length: 5, sleeveLength: -1, neckHalfWidth: 0.3, shoulderHalfWidth: 0.3 });
    expect(r.params.length).toBe(TSHIRT_PARAM_LIMITS.length.max);
    expect(r.params.sleeveLength).toBe(TSHIRT_PARAM_LIMITS.sleeveLength.min);
    expect(r.params.neckHalfWidth).toBeLessThan(r.params.shoulderHalfWidth);
    expect(r.clamped.map((c) => c.name)).toContain('length');
    expect(r.clamped.map((c) => c.name)).toContain('neckHalfWidth');
  });

  describe('sleeve rise rule', () => {
    it('boxy cut (shoulder == chest) is allowed at sleeveAngle 0 without clamping', () => {
      const r = clampTShirtParams({ chestHalfWidth: 0.5, shoulderHalfWidth: 0.5, sleeveAngle: 0 });
      expect(r.clamped.map((c) => c.name)).not.toContain('shoulderHalfWidth');
      expect(armholeRingElevation(r.params)).toBeLessThanOrEqual(0.005);
    });
    it('narrow shoulder at sleeveAngle 0 is widened to the chest (no rising sleeve)', () => {
      const r = clampTShirtParams({ chestHalfWidth: 0.5, shoulderHalfWidth: 0.4, sleeveAngle: 0 });
      const c = r.clamped.find((x) => x.name === 'shoulderHalfWidth');
      expect(c).toBeDefined();
      expect(r.params.shoulderHalfWidth).toBeGreaterThan(0.49);
    });
    it('narrow shoulder is allowed as far as the sleeve tilt compensates', () => {
      const r = clampTShirtParams({ chestHalfWidth: 0.5, shoulderHalfWidth: 0.42, armholeDepth: 0.3, sleeveAngle: 0.5 });
      expect(r.clamped.map((c) => c.name)).not.toContain('shoulderHalfWidth');
      const m = buildTShirt(r.params);
      const res = checkTShirtMesh(m).results.find((x) => x.name === 'sleeves_do_not_rise')!;
      expect(res.pass).toBe(true);
      m.geometry.dispose();
    });
    it('the former "wings" case renders with sleeves horizontal or down', () => {
      const wings = { length: 0.9, chestHalfWidth: 0.58, hemHalfWidth: 0.62, sleeveLength: 0.4, neckHalfWidth: 0.24 };
      const m = buildTShirt(wings);
      const res = checkTShirtMesh(m).results.find((x) => x.name === 'sleeves_do_not_rise')!;
      expect(res.pass, res.detail).toBe(true);
      expect(armholeRingElevation(m.params)).toBeLessThanOrEqual(m.params.sleeveAngle);
      m.geometry.dispose();
    });
  });

  it('registry: only tshirt has a template; pants/skirt/other are null', () => {
    expect(CATEGORY_TEMPLATE).toEqual({ tshirt: 'tshirt-basic', pants: null, skirt: null, other: null });
    expect(templateForCategory('pants')).toBeNull();
    expect(templateForCategory('tshirt')?.topologyVersion).toBe(TSHIRT_TOPOLOGY_VERSION);
  });
});
