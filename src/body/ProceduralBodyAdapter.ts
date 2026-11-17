/**
 * ProceduralBodyAdapter — the project's own mannequin behind the
 * `AvatarAdapter` contract (M01–M04). Not a copy of the FitCast chibi body and
 * not a downloaded avatar: generated from `BodyParams` (see params.ts).
 *
 * Extras beyond the contract (used by fitting, F-stages):
 *   getFrame()            analytic frame (heights, torso ellipses, limb axes)
 *   getCrossSection(y)    torso ellipse at height y (null outside the torso)
 *   getCapsules()         collision capsules
 *   getBodyParams()/setBodyParams()  typed params + clamp notes
 */
import * as THREE from 'three';
import { bodyCapsules, computeFrame, torsoCrossSection, type BodyFrame, type Capsule, type Ellipse } from './anatomy';
import { buildBody, bodySurface, updateBody, type BodyMesh } from './buildBody';
import { landmarksFromFrame, type BodyLandmark } from './landmarks';
import { BODY_PARAM_LIMITS, BODY_PARAM_NAMES, BODY_TEMPLATE_ID, BODY_TEMPLATE_VERSION, bodySex, type BodyParams, type ClampNote } from './params';
import { BODY_BONE_NAMES, makeSkinnedMesh } from './skeleton';
import { AVATAR_CONVENTIONS, type AvatarAdapter, type AvatarChangeEvent, type AvatarLandmark, type AvatarLandmarkName, type AvatarParamSpec, type AvatarSurface } from '../fitting/AvatarAdapter';

export class ProceduralBodyAdapter implements AvatarAdapter {
  readonly id = BODY_TEMPLATE_ID;
  readonly version = BODY_TEMPLATE_VERSION;
  /** our own mannequin; garments fitted on it are not "test" fits, but it is still not the FitCast Body.tsx */
  readonly kind = 'production' as const;
  readonly conventions = AVATAR_CONVENTIONS;

  private mesh: BodyMesh;
  private surfaceVersion = 1;
  private listeners = new Set<(e: AvatarChangeEvent) => void>();
  private displays = new Set<{ group: THREE.Group; material: THREE.MeshStandardMaterial }>();

  constructor(initial: Partial<BodyParams> = {}) {
    this.mesh = buildBody(initial);
  }

  getParamSpec(): AvatarParamSpec[] {
    const sex = bodySex(this.mesh.params);
    return BODY_PARAM_NAMES.map((n) => ({ name: n, min: BODY_PARAM_LIMITS[n].min, max: BODY_PARAM_LIMITS[n].max, default: BODY_PARAM_LIMITS[n].default[sex], label: BODY_PARAM_LIMITS[n].label }));
  }
  getParams(): Record<string, number> {
    return { ...this.mesh.params };
  }
  getBodyParams(): BodyParams {
    return { ...this.mesh.params };
  }
  getClampNotes(): ClampNote[] {
    return this.mesh.clamped.map((c) => ({ ...c }));
  }
  setParams(partial: Record<string, number>): void {
    this.setBodyParams(partial as Partial<BodyParams>);
  }
  setBodyParams(partial: Partial<BodyParams>): ClampNote[] {
    const before = { ...this.mesh.params };
    updateBody(this.mesh, partial);
    const changed = BODY_PARAM_NAMES.filter((n) => Math.abs(before[n] - this.mesh.params[n]) > 1e-12);
    if (changed.length) {
      this.surfaceVersion++;
      for (const d of this.displays) this.refreshDisplay(d.group);
      const e: AvatarChangeEvent = { adapterId: this.id, changedParams: changed, surfaceVersion: this.surfaceVersion };
      for (const l of this.listeners) l(e);
    }
    return this.mesh.clamped;
  }
  getSurfaceVersion(): number {
    return this.surfaceVersion;
  }
  getSurface(): AvatarSurface {
    return bodySurface(this.mesh);
  }
  getLandmarks(): AvatarLandmark[] {
    return landmarksFromFrame(this.mesh.frame) as AvatarLandmark[];
  }
  getAllLandmarks(): BodyLandmark[] {
    return landmarksFromFrame(this.mesh.frame);
  }
  getLandmark(name: AvatarLandmarkName): AvatarLandmark {
    const l = this.getLandmarks().find((x) => x.name === name);
    if (!l) throw new Error(`landmark ${name} not available`);
    return l;
  }
  getBones(): { names: string[] } {
    return { names: [...BODY_BONE_NAMES] };
  }
  onChange(cb: (e: AvatarChangeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  getFrame(): BodyFrame {
    return this.mesh.frame;
  }
  getCrossSection(y: number): Ellipse | null {
    return torsoCrossSection(this.mesh.frame, y);
  }
  getCapsules(): Capsule[] {
    return bodyCapsules(this.mesh.frame);
  }
  getMesh(): BodyMesh {
    return this.mesh;
  }

  createDisplayObject(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'procedural-body';
    const material = new THREE.MeshStandardMaterial({ color: '#d9c2a7', roughness: 0.8, metalness: 0, flatShading: true });
    this.displays.add({ group, material });
    this.refreshDisplay(group);
    return group;
  }
  private refreshDisplay(group: THREE.Group) {
    const entry = [...this.displays].find((d) => d.group === group)!;
    for (const c of [...group.children]) {
      group.remove(c);
      if (c instanceof THREE.SkinnedMesh) c.skeleton.dispose();
    }
    // the skinned mesh shares the adapter's geometry; bones are rebuilt from the current frame
    const { skinned } = makeSkinnedMesh(this.mesh, entry.material);
    skinned.name = 'procedural-body-mesh';
    group.add(skinned);
  }

  dispose(): void {
    for (const d of this.displays) {
      d.material.dispose();
      for (const c of d.group.children) if (c instanceof THREE.SkinnedMesh) c.skeleton.dispose();
      d.group.clear();
    }
    this.displays.clear();
    this.mesh.geometry.dispose();
    this.listeners.clear();
  }
}

export { computeFrame };
