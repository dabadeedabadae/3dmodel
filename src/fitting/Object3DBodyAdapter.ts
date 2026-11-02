/**
 * Object3DBodyAdapter — the minimal integration path to the REAL FitCast body.
 *
 * `frontend/app/model/Body.tsx` renders a React-Three-Fiber <group> of
 * primitive meshes. This adapter does not touch that file: it takes the
 * rendered THREE.Group (obtained in the frontend with a React ref around
 * <Body/>) and reads what is actually there:
 *
 *   AVAILABLE NOW (read from the live Object3D):
 *     - the canonical surface: every mesh's geometry in world space
 *     - per-part regions, either from mesh names (preferred — needs a one-line
 *       `name="..."` on each mesh in Body.tsx) or, for the unmodified file,
 *       from `chibiRegionHeuristic` (bounding-box rules that only hold for the
 *       current chibi layout; it is a stopgap and says so in `regionSource`)
 *     - landmarks derived from region bounding boxes (shoulder = highest arm
 *       vertex, wrist = lowest, neck base = bottom of the neck part, ...)
 *
 *   NOT AVAILABLE from Body.tsx and genuinely missing (see docs/INTEGRATION_BODY.md):
 *     - body parameters (there are none; `getParamSpec()` is empty)
 *     - a body version (caller must pass one — default is the file+date stamp)
 *     - change events (no params -> nothing changes; `notifyChanged()` exists for
 *       a future parametric body)
 *     - a skeleton / poses
 *
 * kind = 'production' only when the caller says the object IS the FitCast body;
 * tests use kind 'test'.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wearerSideFromX } from '../domain/sides';
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

export type RegionClassifier = (mesh: THREE.Mesh, worldBox: THREE.Box3) => AvatarRegionName | null;

export interface Object3DBodyAdapterOptions {
  id: string;
  version: string;
  kind: 'test' | 'production';
  /** How to assign meshes to regions. Default: by `mesh.name`. */
  regionOf?: RegionClassifier;
}

/** Region from mesh.name: head, ear -> head; neck; torso; arm_left/right; leg_*; foot_*. */
export const regionByName: RegionClassifier = (mesh) => {
  const n = mesh.name.toLowerCase();
  if (!n) return null;
  if (n.startsWith('head') || n.startsWith('ear')) return 'head';
  if (n.startsWith('neck')) return 'neck';
  if (n.startsWith('torso') || n.startsWith('body')) return 'torso';
  for (const part of ['arm', 'leg', 'foot'] as const) {
    if (n.startsWith(part)) {
      if (n.includes('left')) return `${part}_left`;
      if (n.includes('right')) return `${part}_right`;
      return null;
    }
  }
  return null;
};

/**
 * STOPGAP for the unmodified Body.tsx (no mesh names): classify by where the
 * part sits. Valid only for the current chibi layout (feet at y=0, head above
 * 1.6, arms at |x| > 0.3). Sides are WEARER sides: +X = left.
 */
export const chibiRegionHeuristic: RegionClassifier = (_mesh, box) => {
  const c = box.getCenter(new THREE.Vector3());
  const side = wearerSideFromX(c.x);
  if (c.y > 1.6) return 'head';
  if (c.y > 1.3 && Math.abs(c.x) < 0.3) return 'neck';
  if (c.y > 0.65 && Math.abs(c.x) < 0.3) return 'torso';
  if (c.y > 0.65 && side) return `arm_${side}`;
  if (c.y > 0.2 && side) return `leg_${side}`;
  if (side) return `foot_${side}`;
  return null;
};

export class Object3DBodyAdapter implements AvatarAdapter {
  readonly id: string;
  readonly version: string;
  readonly kind: 'test' | 'production';
  readonly conventions = AVATAR_CONVENTIONS;
  /** Which classifier produced the regions — surfaced so reports can say "heuristic". */
  readonly regionSource: 'name' | 'custom';

  private root: THREE.Object3D;
  private regionOf: RegionClassifier;
  private surfaceVersion = 1;
  private listeners = new Set<(e: AvatarChangeEvent) => void>();
  private cachedSurface: AvatarSurface | null = null;
  private cachedLandmarks: AvatarLandmark[] | null = null;
  private unassigned: string[] = [];

  constructor(root: THREE.Object3D, opts: Object3DBodyAdapterOptions) {
    this.root = root;
    this.id = opts.id;
    this.version = opts.version;
    this.kind = opts.kind;
    this.regionOf = opts.regionOf ?? regionByName;
    this.regionSource = opts.regionOf ? 'custom' : 'name';
  }

  /** Meshes that no classifier could place (empty = everything is accounted for). */
  getUnassignedMeshes(): string[] {
    this.getSurface();
    return this.unassigned.slice();
  }

  getParamSpec(): AvatarParamSpec[] {
    return []; // Body.tsx has no parameters
  }
  getParams(): Record<string, number> {
    return {};
  }
  setParams(): void {
    /* no parameters exist on the real body yet */
  }
  getSurfaceVersion(): number {
    return this.surfaceVersion;
  }
  getBones(): null {
    return null;
  }
  onChange(cb: (e: AvatarChangeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  /** Call after the underlying object changed (a future parametric body would call this). */
  notifyChanged(changedParams: string[] = []): void {
    this.surfaceVersion += 1;
    this.cachedSurface = null;
    this.cachedLandmarks = null;
    for (const l of this.listeners) l({ adapterId: this.id, changedParams, surfaceVersion: this.surfaceVersion });
  }

  getSurface(): AvatarSurface {
    if (this.cachedSurface) return this.cachedSurface;
    this.root.updateWorldMatrix(true, true);
    const byRegion = new Map<AvatarRegionName, THREE.BufferGeometry[]>();
    this.unassigned = [];
    const box = new THREE.Box3();
    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const g = (obj.geometry as THREE.BufferGeometry).clone();
      g.applyMatrix4(obj.matrixWorld);
      const ng = g.index ? g.toNonIndexed() : g;
      if (!ng.attributes.normal) ng.computeVertexNormals();
      box.setFromBufferAttribute(ng.attributes.position as THREE.BufferAttribute);
      const region = this.regionOf(obj, box);
      if (!region) {
        this.unassigned.push(obj.name || `${obj.type}#${obj.id}`);
        ng.dispose();
        if (ng !== g) g.dispose();
        return;
      }
      const clean = new THREE.BufferGeometry();
      clean.setAttribute('position', ng.attributes.position!);
      clean.setAttribute('normal', ng.attributes.normal!);
      (byRegion.get(region) ?? byRegion.set(region, []).get(region)!).push(clean);
      if (ng !== g) g.dispose();
    });
    const order: AvatarRegionName[] = ['head', 'neck', 'torso', 'arm_left', 'arm_right', 'leg_left', 'leg_right', 'foot_left', 'foot_right'];
    const geoms: THREE.BufferGeometry[] = [];
    const regions: AvatarSurface['regions'] = [];
    let cursor = 0;
    for (const r of order) {
      const list = byRegion.get(r);
      if (!list) continue;
      let count = 0;
      for (const g of list) {
        geoms.push(g);
        count += g.attributes.position!.count / 3;
      }
      regions.push({ name: r, triangleStart: cursor, triangleCount: count });
      cursor += count;
    }
    if (geoms.length === 0) throw new Error('Object3DBodyAdapter: no meshes could be assigned to a region');
    const merged = mergeGeometries(geoms, false);
    if (!merged) throw new Error('Object3DBodyAdapter: mergeGeometries failed');
    const positions = merged.attributes.position!.array as Float32Array;
    const normals = merged.attributes.normal!.array as Float32Array;
    const indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    for (const g of geoms) g.dispose();
    merged.dispose();
    this.cachedSurface = { positions, normals, indices, regions };
    return this.cachedSurface;
  }

  getLandmarks(): AvatarLandmark[] {
    if (this.cachedLandmarks) return this.cachedLandmarks;
    const s = this.getSurface();
    const region = (name: AvatarRegionName) => s.regions.find((r) => r.name === name) ?? null;
    const extreme = (name: AvatarRegionName, pick: 'maxY' | 'minY'): [number, number, number] | null => {
      const r = region(name);
      if (!r) return null;
      let best: [number, number, number] | null = null;
      for (let t = r.triangleStart; t < r.triangleStart + r.triangleCount; t++) {
        for (let k = 0; k < 3; k++) {
          const i = s.indices[t * 3 + k]! * 3;
          const y = s.positions[i + 1]!;
          if (!best || (pick === 'maxY' ? y > best[1] : y < best[1])) best = [s.positions[i]!, y, s.positions[i + 2]!];
        }
      }
      return best;
    };
    const bbox = (name: AvatarRegionName): THREE.Box3 | null => {
      const r = region(name);
      if (!r) return null;
      const b = new THREE.Box3();
      const v = new THREE.Vector3();
      for (let t = r.triangleStart; t < r.triangleStart + r.triangleCount; t++)
        for (let k = 0; k < 3; k++) b.expandByPoint(v.fromArray(s.positions, s.indices[t * 3 + k]! * 3));
      return b;
    };
    const torso = bbox('torso');
    if (!torso) throw new Error('Object3DBodyAdapter: torso region is required for landmarks');
    const headTop = extreme('head', 'maxY');
    const neck = bbox('neck');
    const out: AvatarLandmark[] = [];
    const push = (name: AvatarLandmarkName, p: [number, number, number] | null) => {
      if (p) out.push({ name, position: p });
    };
    push('head_top', headTop ? [0, headTop[1], 0] : null);
    push('neck_base', [0, neck ? neck.min.y : torso.max.y, 0]);
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      const arm = bbox(`arm_${side}`);
      const shoulder = extreme(`arm_${side}`, 'maxY');
      push(`shoulder_${side}`, shoulder);
      // armpit: torso side just below the torso top (same heuristic as TestMannequinAdapter)
      push(`armpit_${side}`, arm ? [sign * torso.max.x, torso.max.y - 0.05, 0] : null);
      push(`wrist_${side}`, extreme(`arm_${side}`, 'minY'));
      const leg = bbox(`leg_${side}`);
      push(`knee_${side}`, leg ? [leg.getCenter(new THREE.Vector3()).x, leg.getCenter(new THREE.Vector3()).y, 0] : null);
    }
    const torsoR = (torso.max.x - torso.min.x) / 2;
    push('chest_center', [0, torso.max.y - 0.1, 0]);
    push('waist_center', [0, (torso.max.y + torso.min.y) / 2, 0]);
    push('hip_center', [0, torso.min.y + torsoR, 0]);
    push('crotch', [0, torso.min.y, 0]);
    push('floor_center', [0, 0, 0]);
    this.cachedLandmarks = out;
    return out;
  }

  getLandmark(name: AvatarLandmarkName): AvatarLandmark {
    const l = this.getLandmarks().find((x) => x.name === name);
    if (!l) throw new Error(`Object3DBodyAdapter: landmark ${name} not derivable from the given object`);
    return l;
  }

  createDisplayObject(): THREE.Object3D {
    return this.root; // the live body itself
  }

  dispose(): void {
    this.listeners.clear();
    this.cachedSurface = null;
    this.cachedLandmarks = null;
  }
}
