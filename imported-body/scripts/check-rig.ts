/**
 * Blocking check for the rig: skin weights valid, rest pose reproduces the mesh exactly, and the neutral A-pose
 * passes the same geometry checks as the T-pose. The shoulder angle is backed off until the EXACT
 * self-intersection test passes — the test is never weakened to make the pose fit.
 *   node --import tsx imported-body/scripts/check-rig.ts
 */
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { checkBodyMesh } from '../src/geom/meshChecks';
import { loadAsset } from '../src/load';
import { deform, type Weights } from '../src/deform';
import { aPose, applyPose, buildSkeleton, computeSkin, BONE_NAMES } from '../src/rig';

const asset = loadAsset();
const fails: string[] = [];
const geom = (p: Float32Array) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(Array.from(asset.index));
  let maxY = -Infinity;
  for (let i = 0; i < p.length / 3; i++) maxY = Math.max(maxY, p[i * 3 + 1]!);
  const r = checkBodyMesh({ geometry: g, frame: { height: maxY } } as any, { minTriangles: 1500, maxTriangles: 3000 });
  g.dispose();
  return r.checks.filter((c) => !c.pass && c.level === 'fail');
};

const base = deform(asset, {});
const bones = buildSkeleton(asset, base);
const skin = computeSkin(asset, base, bones);
// 1. weights
let badSum = 0, badIdx = 0;
for (let i = 0; i < base.length / 3; i++) {
  let s = 0;
  for (let j = 0; j < 4; j++) { s += skin.weight[i * 4 + j]!; if (skin.index[i * 4 + j]! >= bones.length) badIdx++; }
  if (Math.abs(s - 1) > 1e-5) badSum++;
}
console.log(`${badSum || badIdx ? 'FAIL' : 'PASS'}  skin_weights — ${bones.length} bones, ${badSum} vertices whose weights do not sum to 1, ${badIdx} out-of-range indices`);
if (badSum || badIdx) fails.push('skin_weights');
console.log(`${bones.length === BONE_NAMES.length ? 'PASS' : 'FAIL'}  bone_set — ${bones.map((b) => b.name).length} bones`);

// 2. rest pose must reproduce the mesh exactly
const rest = applyPose(base, skin, {});
let maxDiff = 0;
for (let i = 0; i < base.length; i++) maxDiff = Math.max(maxDiff, Math.abs(base[i]! - rest[i]!));
console.log(`${maxDiff < 1e-6 ? 'PASS' : 'FAIL'}  rest_pose_identity — max difference ${maxDiff.toExponential(2)} m`);
if (!(maxDiff < 1e-6)) fails.push('rest_pose_identity');

// 3. neutral A-pose, over the shape range, with the angle backed off until the exact check passes
const shapes: { label: string; w: Partial<Weights> }[] = [
  { label: 'base', w: {} },
  { label: 'athletic', w: { chest: 0.8, waist: -0.6, shoulders: 1, arms: 0.7, thighs: 0.4 } },
  { label: 'round', w: { chest: 0.4, waist: 1, hip: 0.8, arms: 0.2, thighs: 0.6 } },
  { label: 'all+1', w: { chest: 1, waist: 1, hip: 1, shoulders: 1, arms: 1, thighs: 1 } },
  { label: 'all-1', w: { chest: -1, waist: -1, hip: -1, shoulders: -1, arms: -1, thighs: -1 } },
];
const poses: Record<string, number> = {};
for (const s of shapes) {
  const p0 = deform(asset, s.w);
  const sk = computeSkin(asset, p0, buildSkeleton(asset, p0));
  let used = NaN, failed: string[] = ['not attempted'];
  for (let deg = 62; deg >= 30; deg -= 1) {
    const p = applyPose(p0, sk, aPose(deg));
    const f = geom(p);
    if (!f.length) { used = deg; failed = []; break; }
    failed = f.map((c) => `${c.name}: ${c.detail}`);
  }
  poses[s.label] = used;
  const ok = Number.isFinite(used);
  if (!ok) fails.push(`a_pose_${s.label}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  a_pose ${s.label.padEnd(10)} shoulder ${ok ? used + '°' : '—'}${failed.length ? ' — ' + failed.join('; ') : ''}`);
}
mkdirSync('imported-body/reports', { recursive: true });
writeFileSync('imported-body/reports/stage-I04-rig.json', JSON.stringify({ generatedAt: new Date().toISOString(), bones: bones.map((b) => ({ ...b })), restPoseMaxDiff: maxDiff, verifiedShoulderDegrees: poses, fails }, null, 2));
console.log(fails.length ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(fails.length ? 1 : 0);
