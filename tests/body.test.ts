import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bodyCapsules, capsuleSignedDistance, computeFrame, torsoCrossSection } from '../src/body/anatomy';
import { buildBody, updateBody } from '../src/body/buildBody';
import { checkBodyFixedTopology, checkBodyMesh, sampleBodyParamSets } from '../src/body/checks';
import { BODY_PARAM_LIMITS, BODY_PARAM_NAMES, BODY_PRESETS, clampBodyParams, defaultBodyParams, ellipseHalfWidth, ellipsePerimeter } from '../src/body/params';
import { ProceduralBodyAdapter } from '../src/body/ProceduralBodyAdapter';
import { BODY_BONE_NAMES, computeSkin, makeSkinnedMesh } from '../src/body/skeleton';
import { AVATAR_CONVENTIONS } from '../src/fitting/AvatarAdapter';

describe('M01 body params', () => {
  it('defaults are inside limits for both sexes and need no clamps', () => {
    for (const sex of ['male', 'female'] as const) {
      const d = defaultBodyParams(sex);
      for (const n of BODY_PARAM_NAMES) {
        expect(d[n]).toBeGreaterThanOrEqual(BODY_PARAM_LIMITS[n].min);
        expect(d[n]).toBeLessThanOrEqual(BODY_PARAM_LIMITS[n].max);
      }
      expect(clampBodyParams(d).clamped).toEqual([]);
    }
  });
  it('ellipse helpers: perimeter of a circle, half-width inverse', () => {
    expect(ellipsePerimeter(1, 1)).toBeCloseTo(2 * Math.PI, 6);
    const a = ellipseHalfWidth(1.0, 0.7);
    expect(ellipsePerimeter(a, a * 0.7)).toBeCloseTo(1.0, 6);
  });
  it('anatomical rules tighten and report: waist ≤ chest, limbs taper, legs fit under hips', () => {
    const r = clampBodyParams({ waistCirc: 1.3, chestCirc: 0.9, hipCirc: 0.9, forearmCirc: 0.36, upperArmCirc: 0.2, calfCirc: 0.5, thighCirc: 0.4 });
    const names = r.clamped.map((c) => c.name);
    expect(names).toContain('waistCirc');
    expect(r.params.waistCirc).toBeLessThanOrEqual(r.params.chestCirc * 0.98 + 1e-9);
    expect(r.params.forearmCirc).toBeLessThanOrEqual(r.params.upperArmCirc + 1e-9);
    expect(r.params.calfCirc).toBeLessThanOrEqual(r.params.thighCirc * 0.85 + 1e-9);
    for (const c of r.clamped) expect(c.reason.length).toBeGreaterThan(3);
  });
  it('segments never exceed the height', () => {
    const r = clampBodyParams({ legRatio: 0.51, torsoRatio: 0.37, headRatio: 6.8 });
    const head = r.params.height / r.params.headRatio;
    expect(r.params.legRatio * r.params.height + r.params.torsoRatio * r.params.height + head + 0.3 * head).toBeLessThanOrEqual(r.params.height + 1e-6);
  });
  it('monotonic: larger chest circumference → wider chest ellipse; taller → higher landmarks', () => {
    const a = computeFrame(defaultBodyParams('male'));
    const b = computeFrame(clampBodyParams({ chestCirc: 1.1 }).params);
    expect(b.torso.chest.a).toBeGreaterThan(a.torso.chest.a);
    const c = computeFrame(clampBodyParams({ height: 1.9 }).params);
    expect(c.heights.neck_base).toBeGreaterThan(a.heights.neck_base);
    expect(c.heights.head_top).toBeCloseTo(1.9, 9);
  });
  it('cross-section is null outside the torso and interpolates inside', () => {
    const f = computeFrame(defaultBodyParams('female'));
    expect(torsoCrossSection(f, 0.1)).toBeNull();
    const e = torsoCrossSection(f, (f.heights.waist + f.heights.hip) / 2)!;
    expect(e.a).toBeGreaterThan(Math.min(f.torso.waist.a, f.torso.hip.a) - 1e-9);
    expect(e.a).toBeLessThan(Math.max(f.torso.waist.a, f.torso.hip.a) + 1e-9);
  });
});

describe('M02 body mesh', () => {
  it('canonical male and female pass all geometry checks; topology fixed', () => {
    for (const sex of ['male', 'female'] as const) {
      const m = buildBody(defaultBodyParams(sex));
      const r = checkBodyMesh(m);
      expect(r.results.filter((x) => !x.pass).map((x) => x.name + ': ' + x.detail)).toEqual([]);
      m.geometry.dispose();
    }
    expect(checkBodyFixedTopology(4).pass).toBe(true);
  });
  it('presets and 40 random parameter sets pass (clamps keep them human)', () => {
    for (const pr of BODY_PRESETS) {
      const m = buildBody({ ...defaultBodyParams(pr.sex), ...pr.params });
      expect(checkBodyMesh(m).ok, pr.id).toBe(true);
    }
    for (const p of sampleBodyParamSets(40, 99)) expect(checkBodyMesh(buildBody(p)).ok).toBe(true);
  });
  it('updateBody re-derives positions (no accumulation): A→B→A equals A', () => {
    const m = buildBody();
    const a = (m.geometry.attributes.position!.array as Float32Array).slice();
    updateBody(m, { chestCirc: 1.2, height: 1.9 });
    updateBody(m, { chestCirc: 0.98, height: 1.75 });
    const back = m.geometry.attributes.position!.array as Float32Array;
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i]! - back[i]!));
    expect(maxDiff).toBeLessThan(1e-6);
  });
  it('capsule distance: torso centre is inside, far point outside', () => {
    const m = buildBody();
    const caps = bodyCapsules(m.frame);
    expect(capsuleSignedDistance(caps, 0, m.frame.heights.chest, 0)).toBeLessThan(0);
    expect(capsuleSignedDistance(caps, 1, 1, 1)).toBeGreaterThan(0.3);
  });
});

describe('M03 skeleton', () => {
  it('weights sum to 1 and reference valid bones', () => {
    const m = buildBody();
    const s = computeSkin(m);
    for (let v = 0; v < m.stats.vertices; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += s.skinWeight[v * 4 + k]!;
        expect(s.skinIndex[v * 4 + k]!).toBeLessThan(s.bones.length);
      }
      expect(sum).toBeCloseTo(1, 5);
    }
    expect(s.bones.map((b) => b.name)).toEqual([...BODY_BONE_NAMES]);
  });
  it('rest pose reproduces the mesh exactly (skinned position == generated position)', () => {
    const m = buildBody(defaultBodyParams('female'));
    const { skinned } = makeSkinnedMesh(m, new THREE.MeshBasicMaterial());
    skinned.updateMatrixWorld(true);
    skinned.skeleton.update();
    const pos = m.geometry.attributes.position!;
    const tmp = new THREE.Vector3();
    let maxDiff = 0;
    for (let i = 0; i < pos.count; i += 7) {
      skinned.getVertexPosition(i, tmp);
      maxDiff = Math.max(maxDiff, tmp.distanceTo(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))));
    }
    expect(maxDiff).toBeLessThan(1e-5);
  });
});

describe('M04 ProceduralBodyAdapter', () => {
  it('implements the AvatarAdapter contract: conventions, landmarks, change events, bones', () => {
    const a = new ProceduralBodyAdapter();
    expect(a.conventions).toBe(AVATAR_CONVENTIONS);
    expect(a.kind).toBe('production');
    expect(a.getBones()!.names.length).toBe(BODY_BONE_NAMES.length);
    expect(a.getLandmark('floor_center').position).toEqual([0, 0, 0]);
    expect(a.getLandmark('shoulder_left').position[0]).toBeGreaterThan(0); // wearer left = +X
    expect(a.getLandmark('shoulder_right').position[0]).toBeLessThan(0);
    const events: string[][] = [];
    a.onChange((e) => events.push(e.changedParams));
    const v0 = a.getSurfaceVersion();
    a.setParams({ height: 1.9 });
    expect(a.getSurfaceVersion()).toBe(v0 + 1);
    expect(events[0]).toContain('height');
    a.setParams({ height: 1.9 });
    expect(a.getSurfaceVersion()).toBe(v0 + 1); // no-op change emits nothing
    const s = a.getSurface();
    expect(s.regions.map((r) => r.name)).toContain('torso');
    expect(a.getCrossSection(a.getFrame().heights.waist)!.a).toBeGreaterThan(0.1);
    a.dispose();
  });
});
