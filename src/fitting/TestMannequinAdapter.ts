/**
 * TEST MANNEQUIN ADAPTER — explicitly NOT the FitCast body.
 *
 * The real FitCast body lives in `frontend/app/model/Body.tsx` as a
 * React-Three-Fiber JSX tree of primitives (sphere head, capsule torso,
 * capsule limbs). It exposes no parameters, no versions, no landmarks and no
 * surface API — it only renders. Until that body gets a programmatic API,
 * this adapter reproduces its exact primitive layout numerically (same
 * radii, positions and tilts copied from Body.tsx on 2026-10-29) so that
 * garments fitted here will line up with the chibi body later.
 *
 * Added for testing only (the real body has none of these):
 *  - `torsoScale`, `shoulderWidth`, `height` parameters, so stage 04+ can be
 *    exercised against a *changing* body.
 *
 * Integration status: BLOCKED — see docs/STATUS.md "Integration blocker".
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AVATAR_CONVENTIONS,
  type AvatarAdapter,
  type AvatarChangeEvent,
  type AvatarLandmark,
  type AvatarLandmarkName,
  type AvatarParamSpec,
  type AvatarRegionName,
  type AvatarSurface,
} from './AvatarAdapter';

export const TEST_MANNEQUIN_ID = 'test-chibi';
/** Bump when the copied primitive layout changes. "src" names the file it mirrors. */
export const TEST_MANNEQUIN_VERSION = '1.0.0+src.frontend.app.model.Body.tsx@2026-10-29';

/** Numbers copied verbatim from frontend/app/model/Body.tsx (feet at y = 0). */
const CHIBI = {
  head: { r: 0.62, y: 1.95, scale: [1, 1.02, 0.98] as const },
  ear: { r: 0.14, x: 0.6, y: 1.78, z: -0.02, scale: [0.5, 1, 0.7] as const },
  neck: { rTop: 0.16, rBottom: 0.2, h: 0.18, y: 1.42 },
  torso: { r: 0.36, len: 0.34, y: 1.0 },
  arm: { r: 0.135, len: 0.3, x: 0.46, y: 0.98, tilt: 0.28 },
  leg: { r: 0.16, len: 0.18, x: 0.2, y: 0.32 },
  foot: { r: 0.17, x: 0.2, y: 0.08, z: 0.08, scale: [1, 0.7, 1.5] as const },
};

const PARAM_SPEC: AvatarParamSpec[] = [
  { name: 'height', min: 0.85, max: 1.15, default: 1, label: 'TEST: overall height scale' },
  { name: 'torsoScale', min: 0.8, max: 1.3, default: 1, label: 'TEST: torso radius scale' },
  { name: 'shoulderWidth', min: 0.85, max: 1.25, default: 1, label: 'TEST: arm spread scale' },
];

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

interface Part {
  region: AvatarRegionName;
  geometry: THREE.BufferGeometry;
}

export class TestMannequinAdapter implements AvatarAdapter {
  readonly id = TEST_MANNEQUIN_ID;
  readonly version = TEST_MANNEQUIN_VERSION;
  readonly kind = 'test' as const;
  readonly conventions = AVATAR_CONVENTIONS;

  private params: Record<string, number> = Object.fromEntries(PARAM_SPEC.map((p) => [p.name, p.default]));
  private surfaceVersion = 1;
  private listeners = new Set<(e: AvatarChangeEvent) => void>();
  private cachedSurface: AvatarSurface | null = null;
  private cachedLandmarks: AvatarLandmark[] | null = null;
  private displayObjects = new Set<THREE.Group>();

  getParamSpec(): AvatarParamSpec[] {
    return PARAM_SPEC.map((p) => ({ ...p }));
  }

  getParams(): Record<string, number> {
    return { ...this.params };
  }

  setParams(partial: Record<string, number>): void {
    const changed: string[] = [];
    for (const spec of PARAM_SPEC) {
      const v = partial[spec.name];
      if (v === undefined || Number.isNaN(v)) continue;
      const c = clamp(v, spec.min, spec.max);
      if (c !== this.params[spec.name]) {
        this.params[spec.name] = c;
        changed.push(spec.name);
      }
    }
    if (changed.length === 0) return;
    this.surfaceVersion += 1;
    this.cachedSurface = null;
    this.cachedLandmarks = null;
    for (const g of this.displayObjects) this.rebuildDisplay(g);
    const e: AvatarChangeEvent = { adapterId: this.id, changedParams: changed, surfaceVersion: this.surfaceVersion };
    for (const l of this.listeners) l(e);
  }

  getSurfaceVersion(): number {
    return this.surfaceVersion;
  }

  getBones(): null {
    return null; // no skeleton: only the neutral pose exists
  }

  onChange(cb: (e: AvatarChangeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------

  /** Builds the primitive parts in adapter space, applying test params. */
  private buildParts(): Part[] {
    const H = this.params['height']!;
    const T = this.params['torsoScale']!;
    const S = this.params['shoulderWidth']!;
    const parts: Part[] = [];
    const add = (region: AvatarRegionName, g: THREE.BufferGeometry) => parts.push({ region, geometry: g });

    const head = new THREE.SphereGeometry(CHIBI.head.r, 24, 18);
    head.scale(...CHIBI.head.scale);
    head.translate(0, CHIBI.head.y * H, 0);
    add('head', head);
    for (const side of [-1, 1] as const) {
      const ear = new THREE.SphereGeometry(CHIBI.ear.r, 12, 10);
      ear.scale(...CHIBI.ear.scale);
      ear.translate(side * CHIBI.ear.x, CHIBI.ear.y * H, CHIBI.ear.z);
      add('head', ear);
    }
    const neck = new THREE.CylinderGeometry(CHIBI.neck.rTop * T, CHIBI.neck.rBottom * T, CHIBI.neck.h, 16);
    neck.translate(0, CHIBI.neck.y * H, 0);
    add('neck', neck);

    const torso = new THREE.CapsuleGeometry(CHIBI.torso.r * T, CHIBI.torso.len, 8, 24);
    torso.translate(0, CHIBI.torso.y * H, 0);
    add('torso', torso);

    for (const side of [-1, 1] as const) {
      const arm = new THREE.CapsuleGeometry(CHIBI.arm.r, CHIBI.arm.len, 6, 16);
      // Body.tsx: arm at x=-0.46 has rotation.z=+0.28, arm at x=+0.46 has rotation.z=-0.28
      arm.rotateZ(-side * CHIBI.arm.tilt);
      arm.translate(side * CHIBI.arm.x * S, CHIBI.arm.y * H, 0);
      add(side > 0 ? 'arm_left' : 'arm_right', arm); // wearer's left = +X
    }
    for (const side of [-1, 1] as const) {
      const leg = new THREE.CapsuleGeometry(CHIBI.leg.r, CHIBI.leg.len, 6, 16);
      leg.translate(side * CHIBI.leg.x, CHIBI.leg.y * H, 0);
      add(side > 0 ? 'leg_left' : 'leg_right', leg);
    }
    for (const side of [-1, 1] as const) {
      const foot = new THREE.SphereGeometry(CHIBI.foot.r, 16, 12);
      foot.scale(...CHIBI.foot.scale);
      foot.translate(side * CHIBI.foot.x, CHIBI.foot.y, CHIBI.foot.z);
      add(side > 0 ? 'foot_left' : 'foot_right', foot);
    }
    return parts;
  }

  getSurface(): AvatarSurface {
    if (this.cachedSurface) return this.cachedSurface;
    const parts = this.buildParts();
    const regions: AvatarSurface['regions'] = [];
    let triangleCursor = 0;
    const geoms = parts.map((p) => {
      const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
      const triCount = g.attributes.position!.count / 3;
      const last = regions[regions.length - 1];
      if (last && last.name === p.region) last.triangleCount += triCount;
      else regions.push({ name: p.region, triangleStart: triangleCursor, triangleCount: triCount });
      triangleCursor += triCount;
      // keep only position + normal so merge succeeds regardless of uv presence
      const clean = new THREE.BufferGeometry();
      clean.setAttribute('position', g.attributes.position!);
      clean.setAttribute('normal', g.attributes.normal!);
      return clean;
    });
    const merged = mergeGeometries(geoms, false);
    if (!merged) throw new Error('TestMannequinAdapter: mergeGeometries failed');
    const pos = merged.attributes.position!.array as Float32Array;
    const nor = merged.attributes.normal!.array as Float32Array;
    const indices = new Uint32Array(pos.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    for (const p of parts) p.geometry.dispose();
    for (const g of geoms) g.dispose();
    merged.dispose();
    this.cachedSurface = { positions: pos, normals: nor, indices, regions };
    return this.cachedSurface;
  }

  getLandmarks(): AvatarLandmark[] {
    if (this.cachedLandmarks) return this.cachedLandmarks;
    const H = this.params['height']!;
    const T = this.params['torsoScale']!;
    const S = this.params['shoulderWidth']!;
    const armTop = (side: -1 | 1): [number, number, number] => {
      // highest point of the arm capsule (top of the cap), tilted outward (see Body.tsx)
      const t = CHIBI.arm.len / 2 + CHIBI.arm.r;
      return [side * (CHIBI.arm.x * S + Math.sin(CHIBI.arm.tilt) * t), CHIBI.arm.y * H + Math.cos(CHIBI.arm.tilt) * t, 0];
    };
    const armBottom = (side: -1 | 1): [number, number, number] => {
      const t = -(CHIBI.arm.len / 2 + CHIBI.arm.r);
      return [side * (CHIBI.arm.x * S + Math.sin(CHIBI.arm.tilt) * t), CHIBI.arm.y * H + Math.cos(CHIBI.arm.tilt) * t, 0];
    };
    const torsoTop = CHIBI.torso.y * H + CHIBI.torso.len / 2;
    const lm: AvatarLandmark[] = [
      { name: 'head_top', position: [0, (CHIBI.head.y + CHIBI.head.r * CHIBI.head.scale[1]) * H, 0] },
      { name: 'neck_base', position: [0, (CHIBI.neck.y - CHIBI.neck.h / 2) * H, 0] },
      // wearer's LEFT is +X (domain/sides.ts)
      { name: 'shoulder_left', position: armTop(1) },
      { name: 'shoulder_right', position: armTop(-1) },
      { name: 'armpit_left', position: [CHIBI.torso.r * T, torsoTop - 0.05, 0] },
      { name: 'armpit_right', position: [-CHIBI.torso.r * T, torsoTop - 0.05, 0] },
      { name: 'chest_center', position: [0, torsoTop - 0.1, 0] },
      { name: 'waist_center', position: [0, CHIBI.torso.y * H, 0] },
      { name: 'hip_center', position: [0, (CHIBI.torso.y - CHIBI.torso.len / 2) * H, 0] },
      { name: 'crotch', position: [0, (CHIBI.torso.y - CHIBI.torso.len / 2) * H - CHIBI.torso.r * T, 0] },
      { name: 'wrist_left', position: armBottom(1) },
      { name: 'wrist_right', position: armBottom(-1) },
      { name: 'knee_left', position: [CHIBI.leg.x, CHIBI.leg.y * H, 0] },
      { name: 'knee_right', position: [-CHIBI.leg.x, CHIBI.leg.y * H, 0] },
      { name: 'floor_center', position: [0, 0, 0] },
    ];
    this.cachedLandmarks = lm;
    return lm;
  }

  getLandmark(name: AvatarLandmarkName): AvatarLandmark {
    const l = this.getLandmarks().find((x) => x.name === name);
    if (!l) throw new Error(`TestMannequinAdapter: unknown landmark ${name}`);
    return l;
  }

  // ---------------------------------------------------------------------
  // Display (dev page only)
  // ---------------------------------------------------------------------

  createDisplayObject(): THREE.Object3D {
    const g = new THREE.Group();
    g.name = 'TEST mannequin (not FitCast Body)';
    this.rebuildDisplay(g);
    this.displayObjects.add(g);
    return g;
  }

  private rebuildDisplay(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    const surf = this.getSurface();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(surf.normals, 3));
    // Plain grey; the object name and the UI label say TEST so nobody mistakes it for the production body.
    const mat = new THREE.MeshStandardMaterial({ color: '#b9bcc6', roughness: 0.85, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'test-mannequin-surface';
    g.add(mesh);
  }

  dispose(): void {
    for (const g of this.displayObjects) {
      for (const c of g.children) {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      }
      g.clear();
    }
    this.displayObjects.clear();
    this.listeners.clear();
    this.cachedSurface = null;
    this.cachedLandmarks = null;
  }
}
