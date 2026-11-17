/**
 * Stage I-04 — skeleton and posing for the imported body.
 *
 * The mesh arrives in a T-pose with no rig. The joints are not guessed: every one is derived from the landmarks
 * that were measured on the mesh itself (stage I-01), so the rest pose reproduces the mesh EXACTLY and bone
 * positions follow the sliders. Skin weights come from the same smooth region fields the deformation uses, so a
 * posed arm and a deformed arm agree about where the arm begins.
 *
 * Posing is linear blend skinning done on the CPU over 1123 vertices — no GPU skinning, no exported animation.
 */
import * as THREE from 'three';
import type { BodyAsset } from './asset';
import { armholeHalfWidth } from './measure';

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upper_arm_left', 'forearm_left', 'hand_left',
  'upper_arm_right', 'forearm_right', 'hand_right',
  'thigh_left', 'shin_left', 'foot_left',
  'thigh_right', 'shin_right', 'foot_right',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** head of the bone in body space (metres) */
  head: [number, number, number];
}

export interface Pose {
  /** rotation per bone, radians, applied in its parent's frame (XYZ order) */
  [bone: string]: [number, number, number];
}
/** arms down along the body, a few degrees out — the neutral pose the garment contract asks for */
export const A_POSE_DEGREES = { shoulder: 62, elbow: 6 };

/** joint positions from the measured landmarks and the actual silhouette of the posed-neutral mesh */
export function buildSkeleton(asset: BodyAsset, positions: Float32Array): BoneDef[] {
  const L = asset.landmarks;
  const n = positions.length / 3;
  let maxY = -Infinity, tipX = 0;
  for (let i = 0; i < n; i++) {
    maxY = Math.max(maxY, positions[i * 3 + 1]!);
    tipX = Math.max(tipX, Math.abs(positions[i * 3]!));
  }
  const k = maxY / L.height;
  const armY = ((asset.armBand.low + asset.armBand.high) / 2) * k;
  // the arm root is the torso's own half-width at the armhole (one definition, see measure.ts)
  const armIn = armholeHalfWidth(asset, positions).half;
  const elbowX = armIn + (tipX - armIn) * 0.42;
  const wristX = armIn + (tipX - armIn) * 0.8;
  // legs: each thigh's centre from the crotch slice
  let legX = 0,
    cnt = 0;
  for (let i = 0; i < n; i++) {
    const y = positions[i * 3 + 1]!;
    if (y > L.crotch * k * 0.82 && y < L.crotch * k * 0.9 && positions[i * 3]! > 0.01) { legX += positions[i * 3]!; cnt++; }
  }
  legX = cnt ? legX / cnt : 0.08;
  const kneeY = L.crotch * k * 0.52;
  const ankleY = L.crotch * k * 0.08;
  const defs: BoneDef[] = [
    { name: 'hips', parent: null, head: [0, L.crotch * k, 0] },
    { name: 'spine', parent: 'hips', head: [0, L.waist * k, 0] },
    { name: 'chest', parent: 'spine', head: [0, L.chest * k, 0] },
    { name: 'neck', parent: 'chest', head: [0, L.neck_base * k, 0] },
    { name: 'head', parent: 'neck', head: [0, L.neck_base * k + (maxY - L.neck_base * k) * 0.25, 0] },
  ];
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    defs.push(
      { name: `upper_arm_${side}` as BoneName, parent: 'chest', head: [s * armIn, armY, 0] },
      { name: `forearm_${side}` as BoneName, parent: `upper_arm_${side}` as BoneName, head: [s * elbowX, armY, 0] },
      { name: `hand_${side}` as BoneName, parent: `forearm_${side}` as BoneName, head: [s * wristX, armY, 0] },
      { name: `thigh_${side}` as BoneName, parent: 'hips', head: [s * legX, L.crotch * k, 0] },
      { name: `shin_${side}` as BoneName, parent: `thigh_${side}` as BoneName, head: [s * legX, kneeY, 0] },
      { name: `foot_${side}` as BoneName, parent: `shin_${side}` as BoneName, head: [s * legX, ankleY, 0] },
    );
  }
  return defs;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface Skin {
  /** 4 bone indices and 4 weights per vertex, weights sum to 1 */
  index: Uint16Array;
  weight: Float32Array;
  bones: BoneDef[];
}

/** smooth weights from the same region fields the deformation uses: no painted weights, nothing hand-tuned */
export function computeSkin(asset: BodyAsset, positions: Float32Array, bones: BoneDef[]): Skin {
  const L = asset.landmarks;
  const n = positions.length / 3;
  let maxY = -Infinity, tipX = 0;
  for (let i = 0; i < n; i++) { maxY = Math.max(maxY, positions[i * 3 + 1]!); tipX = Math.max(tipX, Math.abs(positions[i * 3]!)); }
  const k = maxY / L.height;
  const id = (nm: string) => bones.findIndex((b) => b.name === nm);
  const bx = (nm: string) => Math.abs(bones[id(nm)]!.head[0]);
  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!, y = positions[i * 3 + 1]!;
    const side = x >= 0 ? 'left' : 'right';
    const ax = Math.abs(x);
    const w: [number, number][] = [];
    // arm chain: blend along the arm, fading in across the armhole
    // the height gate separates the arm from the chest ONLY near the shoulder; further out along the arm it must
    // release, or the lower vertices of the hand keep a chest weight, stay behind when the hand turns and fold
    const root = bx(`upper_arm_${side}`);
    const far = smooth(root * 1.5, root * 2.2, ax);
    const yGate = smooth(asset.armBand.low * k - 0.07, asset.armBand.low * k + 0.01, y);
    const inArm = smooth(root * 0.92, root * 1.35, ax) * Math.max(yGate, far);
    if (inArm > 0.001) {
      // the blend bands are ABSOLUTE and centred on the joints: a band proportional to the arm length covered
      // the whole hand, and the fingers folded through each other as soon as the hand bone turned
      const e = bx(`forearm_${side}`), h = bx(`hand_${side}`);
      const wHand = smooth(h - 0.02, h + 0.02, ax);
      const wFore = smooth(e - 0.03, e + 0.03, ax) - wHand;
      const wUp = 1 - wHand - Math.max(wFore, 0);
      w.push([id(`upper_arm_${side}`), inArm * Math.max(wUp, 0)], [id(`forearm_${side}`), inArm * Math.max(wFore, 0)], [id(`hand_${side}`), inArm * wHand]);
    }
    // leg chain below the crotch
    const inLeg = (1 - smooth(L.crotch * k - 0.05, L.crotch * k + 0.03, y)) * (1 - inArm);
    if (inLeg > 0.001) {
      const kneeY = bones[id(`shin_${side}`)]!.head[1], ankleY = bones[id(`foot_${side}`)]!.head[1];
      const wFoot = 1 - smooth(ankleY - 0.03, ankleY + 0.05, y);
      const wShin = (1 - smooth(kneeY - 0.06, kneeY + 0.08, y)) - wFoot;
      const wThigh = 1 - wFoot - Math.max(wShin, 0);
      w.push([id(`thigh_${side}`), inLeg * Math.max(wThigh, 0)], [id(`shin_${side}`), inLeg * Math.max(wShin, 0)], [id(`foot_${side}`), inLeg * wFoot]);
    }
    // spine chain for whatever is left
    const rest = clamp(1 - inArm - inLeg, 0, 1);
    if (rest > 0.001) {
      const wHead = smooth(L.neck_base * k, L.neck_base * k + (maxY - L.neck_base * k) * 0.35, y);
      const wNeck = smooth(L.chest * k + (L.neck_base - L.chest) * k * 0.45, L.neck_base * k, y) - wHead;
      const wChest = smooth(L.waist * k, L.chest * k, y) - wHead - Math.max(wNeck, 0);
      const wSpine = smooth(L.crotch * k, L.waist * k, y) - Math.max(wChest, 0) - Math.max(wNeck, 0) - wHead;
      const wHips = 1 - wHead - Math.max(wNeck, 0) - Math.max(wChest, 0) - Math.max(wSpine, 0);
      w.push([id('hips'), rest * Math.max(wHips, 0)], [id('spine'), rest * Math.max(wSpine, 0)], [id('chest'), rest * Math.max(wChest, 0)], [id('neck'), rest * Math.max(wNeck, 0)], [id('head'), rest * wHead]);
    }
    w.sort((a, b) => b[1] - a[1]);
    const top = w.slice(0, 4);
    const sum = top.reduce((s, p) => s + p[1], 0) || 1;
    for (let j = 0; j < 4; j++) {
      index[i * 4 + j] = top[j] ? top[j]![0] : 0;
      weight[i * 4 + j] = top[j] ? top[j]![1] / sum : 0;
    }
  }
  return { index, weight, bones };
}

/** world matrix per bone for a pose; rest matrices when the pose is empty */
function boneMatrices(bones: BoneDef[], pose: Pose): THREE.Matrix4[] {
  const local: THREE.Matrix4[] = [];
  const world: THREE.Matrix4[] = [];
  bones.forEach((b, i) => {
    const parent = b.parent ? bones.findIndex((p) => p.name === b.parent) : -1;
    const ph = parent >= 0 ? bones[parent]!.head : [0, 0, 0];
    const r = pose[b.name] ?? [0, 0, 0];
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));
    m.setPosition(b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]);
    local[i] = m;
    world[i] = parent >= 0 ? new THREE.Matrix4().multiplyMatrices(world[parent]!, m) : m.clone();
  });
  return world;
}

/** linear blend skinning: rest positions → posed positions. An empty pose returns the input unchanged. */
export function applyPose(positions: Float32Array, skin: Skin, pose: Pose): Float32Array {
  const rest = boneMatrices(skin.bones, {});
  const posed = boneMatrices(skin.bones, pose);
  const skinMat = rest.map((r, i) => new THREE.Matrix4().multiplyMatrices(posed[i]!, r.clone().invert()));
  const out = new Float32Array(positions.length);
  const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    v.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    acc.set(0, 0, 0);
    for (let j = 0; j < 4; j++) {
      const w = skin.weight[i * 4 + j]!;
      if (w === 0) continue;
      tmp.copy(v).applyMatrix4(skinMat[skin.index[i * 4 + j]!]!).multiplyScalar(w);
      acc.add(tmp);
    }
    out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
  }
  return out;
}

/** T-pose → arms down. Rotation about Z brings a +X arm downward on the left, and −Z does it on the right. */
export function aPose(shoulderDeg = A_POSE_DEGREES.shoulder, elbowDeg = A_POSE_DEGREES.elbow): Pose {
  const r = (d: number) => (d * Math.PI) / 180;
  return {
    upper_arm_left: [0, 0, -r(shoulderDeg)],
    forearm_left: [0, 0, -r(elbowDeg)],
    upper_arm_right: [0, 0, r(shoulderDeg)],
    forearm_right: [0, 0, r(elbowDeg)],
  };
}
