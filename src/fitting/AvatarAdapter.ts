/**
 * AvatarAdapter — the contract between the garment module and whatever body
 * model FitCast renders garments on.
 *
 * The module never touches the body implementation directly; it only reads
 * the canonical surface, landmarks and parameters through this interface and
 * listens for change events. This is what lets a test mannequin and the real
 * FitCast body be swapped without touching garment code.
 *
 * Conventions every adapter MUST follow (checked by tests/mannequin.test.ts):
 *  - units: metres (the FitCast chibi body is ~2.6 "metres" tall; it is a
 *    stylised scale, not a human one — garments are fitted relatively)
 *  - Y up, +Z is the body's front, +X is the WEARER's left side (a viewer
 *    facing the front sees it on screen-right). All *_left / *_right names
 *    are wearer sides — see domain/sides.ts for the image-side mapping.
 *  - origin at the centre between the feet, floor at y = 0
 *  - neutral standing pose, arms slightly away from the torso ("A-ish" pose)
 */

import type * as THREE from 'three';

export const AVATAR_CONVENTIONS = {
  units: 'meters',
  up: '+y',
  forward: '+z',
  origin: 'feet_center_on_floor',
  neutralPose: 'standing_arms_down',
} as const;

export interface AvatarParamSpec {
  name: string;
  min: number;
  max: number;
  default: number;
  /** Human-readable description; shown in UI. */
  label: string;
}

export interface AvatarLandmark {
  name: AvatarLandmarkName;
  position: [number, number, number];
}

export type AvatarLandmarkName =
  | 'head_top'
  | 'neck_base'
  | 'shoulder_left'
  | 'shoulder_right'
  | 'armpit_left'
  | 'armpit_right'
  | 'chest_center'
  | 'waist_center'
  | 'hip_center'
  | 'crotch'
  | 'wrist_left'
  | 'wrist_right'
  | 'knee_left'
  | 'knee_right'
  | 'floor_center';

export type AvatarRegionName = 'head' | 'neck' | 'torso' | 'arm_left' | 'arm_right' | 'leg_left' | 'leg_right' | 'foot_left' | 'foot_right';

export interface AvatarSurfaceRegion {
  name: AvatarRegionName;
  /** First triangle index (not vertex index) in `indices` and triangle count. */
  triangleStart: number;
  triangleCount: number;
}

/** Canonical body surface as an indexed triangle soup. Positions are in adapter space (see conventions). */
export interface AvatarSurface {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  regions: AvatarSurfaceRegion[];
}

export interface AvatarChangeEvent {
  adapterId: string;
  /** Params that changed. Empty when only the surface version changed for another reason. */
  changedParams: string[];
  /** Monotonic counter: increases on every change. Garments compare it to decide whether to refit. */
  surfaceVersion: number;
}

export interface AvatarAdapter {
  /** Stable adapter id, e.g. `test-chibi` or `fitcast-body`. */
  readonly id: string;
  /** Version of the underlying body model. */
  readonly version: string;
  /**
   * `test` adapters are explicitly NOT the FitCast body. Garments fitted
   * against them carry `avatarKind: 'test'` and the final pass stays blocked.
   */
  readonly kind: 'test' | 'production';
  readonly conventions: typeof AVATAR_CONVENTIONS;

  getParamSpec(): AvatarParamSpec[];
  getParams(): Record<string, number>;
  /** Sets params (clamped to spec) and emits a change event when something changed. */
  setParams(partial: Record<string, number>): void;

  /** Current surface version (increments with every change). */
  getSurfaceVersion(): number;
  getSurface(): AvatarSurface;
  getLandmarks(): AvatarLandmark[];
  getLandmark(name: AvatarLandmarkName): AvatarLandmark;

  /** Skeleton is optional. `null` means poses are unsupported (only the neutral pose exists). */
  getBones(): null | { names: string[] };

  onChange(cb: (e: AvatarChangeEvent) => void): () => void;

  /**
   * Optional: a renderable object for the dev page. The garment module never
   * relies on it; fitting uses `getSurface()` only.
   */
  createDisplayObject?(): THREE.Object3D;

  dispose(): void;
}
