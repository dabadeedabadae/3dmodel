import { describe, expect, it } from 'vitest';
import { WEARER_SIDE_X_SIGN } from '../src/domain/sides';
import { AVATAR_CONVENTIONS } from '../src/fitting/AvatarAdapter';
import { TEST_MANNEQUIN_ID, TestMannequinAdapter } from '../src/fitting/TestMannequinAdapter';

describe('TestMannequinAdapter (TEST body, not FitCast Body.tsx)', () => {
  it('declares itself as a test adapter with the shared conventions', () => {
    const a = new TestMannequinAdapter();
    expect(a.kind).toBe('test');
    expect(a.id).toBe(TEST_MANNEQUIN_ID);
    expect(a.version).toContain('Body.tsx');
    expect(a.conventions).toBe(AVATAR_CONVENTIONS);
    expect(a.getBones()).toBeNull();
    a.dispose();
  });

  it('surface is finite, non-empty, feet on the floor, head on top', () => {
    const a = new TestMannequinAdapter();
    const s = a.getSurface();
    expect(s.positions.length).toBeGreaterThan(1000);
    expect(s.indices.length % 3).toBe(0);
    let minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < s.positions.length; i += 3) {
      expect(Number.isFinite(s.positions[i]!)).toBe(true);
      minY = Math.min(minY, s.positions[i + 1]!);
      maxY = Math.max(maxY, s.positions[i + 1]!);
    }
    // Body.tsx: feet ellipsoid bottom at y = 0.08 - 0.17*0.7 = -0.039; head top at 1.95 + 0.62*1.02
    expect(minY).toBeCloseTo(0.08 - 0.17 * 0.7, 2);
    expect(maxY).toBeCloseTo(1.95 + 0.62 * 1.02, 2);
    const regions = s.regions.map((r) => r.name);
    expect(regions).toEqual(['head', 'neck', 'torso', 'arm_right', 'arm_left', 'leg_right', 'leg_left', 'foot_right', 'foot_left']);
    a.dispose();
  });

  it('landmarks match Body.tsx numbers at default params', () => {
    const a = new TestMannequinAdapter();
    expect(a.getLandmark('floor_center').position).toEqual([0, 0, 0]);
    expect(a.getLandmark('neck_base').position[1]).toBeCloseTo(1.42 - 0.09, 5);
    const sr = a.getLandmark('shoulder_right').position;
    const sl = a.getLandmark('shoulder_left').position;
    expect(sl[0]).toBeGreaterThan(0.46); // wearer's LEFT is +X, tilted outward from the arm centre x = 0.46
    expect(sl[1]).toBeCloseTo(0.98 + Math.cos(0.28) * (0.15 + 0.135), 5); // top of the arm cap
    expect(sl[0] * WEARER_SIDE_X_SIGN.left).toBeGreaterThan(0);
    expect(sr[0]).toBeCloseTo(-sl[0], 6);
    expect(sl[1]).toBeCloseTo(sr[1], 6);
    a.dispose();
  });

  it('setParams clamps, bumps surfaceVersion and notifies once per change', () => {
    const a = new TestMannequinAdapter();
    const events: string[][] = [];
    const off = a.onChange((e) => events.push(e.changedParams));
    const v0 = a.getSurfaceVersion();
    a.setParams({ torsoScale: 99 }); // clamped to max 1.3
    expect(a.getParams()['torsoScale']).toBe(1.3);
    expect(a.getSurfaceVersion()).toBe(v0 + 1);
    a.setParams({ torsoScale: 1.3 }); // no change -> no event
    expect(a.getSurfaceVersion()).toBe(v0 + 1);
    a.setParams({ unknownParam: 5 }); // ignored
    expect(events).toEqual([['torsoScale']]);
    off();
    a.setParams({ height: 1.1 });
    expect(events.length).toBe(1);
    // torso surface actually changed
    const s = a.getSurface();
    let maxX = 0;
    const torso = s.regions.find((r) => r.name === 'torso')!;
    for (let t = torso.triangleStart; t < torso.triangleStart + torso.triangleCount; t++) {
      for (let k = 0; k < 3; k++) maxX = Math.max(maxX, Math.abs(s.positions[s.indices[t * 3 + k]! * 3]!));
    }
    expect(maxX).toBeCloseTo(0.36 * 1.3, 2);
    a.dispose();
  });
});
