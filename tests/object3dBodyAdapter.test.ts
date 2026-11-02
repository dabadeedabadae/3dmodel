import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chibiRegionHeuristic, Object3DBodyAdapter, regionByName } from '../src/fitting/Object3DBodyAdapter';
import { TestMannequinAdapter } from '../src/fitting/TestMannequinAdapter';

/**
 * A plain three.js transcription of frontend/app/model/Body.tsx (same
 * primitives, positions, scales, rotations; NO names) — what a React ref
 * around <Body/> hands us today.
 */
function unnamedChibiGroup(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const mesh = (geo: THREE.BufferGeometry, pos: [number, number, number], opts: { scale?: [number, number, number]; rotZ?: number } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (opts.scale) m.scale.set(...opts.scale);
    if (opts.rotZ) m.rotation.z = opts.rotZ;
    g.add(m);
    return m;
  };
  mesh(new THREE.SphereGeometry(0.62, 48, 48), [0, 1.95, 0], { scale: [1, 1.02, 0.98] });
  mesh(new THREE.SphereGeometry(0.14, 24, 24), [-0.6, 1.78, -0.02], { scale: [0.5, 1, 0.7] });
  mesh(new THREE.SphereGeometry(0.14, 24, 24), [0.6, 1.78, -0.02], { scale: [0.5, 1, 0.7] });
  mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 20), [0, 1.42, 0]);
  mesh(new THREE.CapsuleGeometry(0.36, 0.34, 12, 32), [0, 1.0, 0]);
  mesh(new THREE.CapsuleGeometry(0.135, 0.3, 10, 20), [-0.46, 0.98, 0], { rotZ: 0.28 });
  mesh(new THREE.CapsuleGeometry(0.135, 0.3, 10, 20), [0.46, 0.98, 0], { rotZ: -0.28 });
  mesh(new THREE.CapsuleGeometry(0.16, 0.18, 10, 20), [-0.2, 0.32, 0]);
  mesh(new THREE.CapsuleGeometry(0.16, 0.18, 10, 20), [0.2, 0.32, 0]);
  mesh(new THREE.SphereGeometry(0.17, 24, 24), [-0.2, 0.08, 0.08], { scale: [1, 0.7, 1.5] });
  mesh(new THREE.SphereGeometry(0.17, 24, 24), [0.2, 0.08, 0.08], { scale: [1, 0.7, 1.5] });
  return g;
}

describe('Object3DBodyAdapter (integration path to the real Body.tsx)', () => {
  it('reads the unmodified chibi group with the bbox heuristic and reproduces the test mannequin landmarks', () => {
    const group = unnamedChibiGroup();
    const a = new Object3DBodyAdapter(group, { id: 'body-tsx-transcript', version: 'test', kind: 'test', regionOf: chibiRegionHeuristic });
    expect(a.regionSource).toBe('custom');
    expect(a.getUnassignedMeshes()).toEqual([]);
    const s = a.getSurface();
    expect(s.regions.map((r) => r.name)).toEqual(['head', 'neck', 'torso', 'arm_left', 'arm_right', 'leg_left', 'leg_right', 'foot_left', 'foot_right']);
    const ref = new TestMannequinAdapter();
    for (const name of ['head_top', 'neck_base', 'shoulder_left', 'shoulder_right', 'wrist_left', 'wrist_right', 'crotch'] as const) {
      const p = a.getLandmark(name).position;
      const q = ref.getLandmark(name).position;
      // derived from the mesh surface, so a vertex-sampling tolerance applies
      expect(Math.abs(p[1] - q[1]), `${name}.y ${p[1]} vs ${q[1]}`).toBeLessThan(0.06);
      expect(Math.sign(p[0])).toBe(Math.sign(q[0]));
    }
    expect(a.getLandmark('shoulder_left').position[0]).toBeGreaterThan(0); // wearer's left = +X
    expect(a.getParamSpec()).toEqual([]);
    expect(a.getBones()).toBeNull();
    ref.dispose();
    a.dispose();
  });

  it('with mesh names it needs no heuristic and reports unassigned meshes', () => {
    const group = unnamedChibiGroup();
    const names = ['head', 'ear_left', 'ear_right', 'neck', 'torso', 'arm_right', 'arm_left', 'leg_right', 'leg_left', 'foot_right', 'foot_left'];
    group.children.forEach((c, i) => (c.name = names[i]!));
    const extra = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
    extra.name = 'hat';
    group.add(extra);
    const a = new Object3DBodyAdapter(group, { id: 'named', version: 'test', kind: 'test' });
    expect(a.regionSource).toBe('name');
    expect(a.getUnassignedMeshes()).toEqual(['hat']);
    expect(regionByName(extra, new THREE.Box3())).toBeNull();
    expect(a.getLandmark('wrist_left').position[0]).toBeGreaterThan(0);
    a.dispose();
  });

  it('notifyChanged bumps the surface version and re-reads the object', () => {
    const group = unnamedChibiGroup();
    const a = new Object3DBodyAdapter(group, { id: 'x', version: 'test', kind: 'test', regionOf: chibiRegionHeuristic });
    const v0 = a.getSurfaceVersion();
    const head0 = a.getLandmark('head_top').position[1];
    let seen = 0;
    a.onChange(() => seen++);
    group.children[0]!.position.y += 0.1;
    a.notifyChanged();
    expect(a.getSurfaceVersion()).toBe(v0 + 1);
    expect(seen).toBe(1);
    expect(a.getLandmark('head_top').position[1]).toBeCloseTo(head0 + 0.1, 5);
    a.dispose();
  });
});
