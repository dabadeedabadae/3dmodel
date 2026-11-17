/**
 * Verified neutral pose: the shoulder angle is reduced one degree at a time until the EXACT self-intersection
 * test passes. The test is never relaxed to make a pose fit — a pose that cannot be verified is not used.
 * Browser-safe (the geometry checks carry no node-only imports).
 */
import * as THREE from 'three';
import { checkBodyMesh } from './geom/meshChecks';
import type { BodyAsset } from './asset';
import { aPose, applyPose, A_POSE_DEGREES, type Skin } from './rig';

export interface VerifiedPose {
  positions: Float32Array;
  shoulderDegrees: number;
  verified: boolean;
  failed: string[];
}

export function poseIsClean(asset: BodyAsset, p: Float32Array): string[] {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(Array.from(asset.index));
  let maxY = -Infinity;
  for (let i = 0; i < p.length / 3; i++) maxY = Math.max(maxY, p[i * 3 + 1]!);
  const r = checkBodyMesh({ geometry: g, frame: { height: maxY } } as any, { minTriangles: 1500, maxTriangles: 3000 });
  g.dispose();
  return r.checks.filter((c) => !c.pass && c.level === 'fail').map((c) => `${c.name}: ${c.detail}`);
}

export function verifiedAPose(asset: BodyAsset, positions: Float32Array, skin: Skin, from = A_POSE_DEGREES.shoulder, to = 30): VerifiedPose {
  let failed: string[] = [];
  for (let deg = from; deg >= to; deg -= 1) {
    const p = applyPose(positions, skin, aPose(deg));
    failed = poseIsClean(asset, p);
    if (!failed.length) return { positions: p, shoulderDegrees: deg, verified: true, failed: [] };
  }
  return { positions, shoulderDegrees: NaN, verified: false, failed };
}
