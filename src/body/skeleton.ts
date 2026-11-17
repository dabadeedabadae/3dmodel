/**
 * M03 — skeleton and analytic skin weights for the procedural body.
 *
 * 17 bones in a plain hierarchy; joint positions come from the same frame as
 * the mesh, so the rest pose IS the generated mesh (skinning with identity
 * bone transforms reproduces the vertices exactly — checked by tests).
 * Weights are assigned per ring (max 2 bones per vertex, blended at joints),
 * which is enough for a low-poly mannequin and keeps the result predictable.
 * Poses themselves are a P-stage; here only the rest pose exists.
 */
import * as THREE from 'three';
import type { BodyFrame } from './anatomy';
import type { BodyMesh } from './buildBody';

export const BODY_BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder_left',
  'upper_arm_left',
  'forearm_left',
  'hand_left',
  'thigh_left',
  'shin_left',
  'foot_left',
  'shoulder_right',
  'upper_arm_right',
  'forearm_right',
  'hand_right',
  'thigh_right',
  'shin_right',
  'foot_right',
] as const;
export type BodyBoneName = (typeof BODY_BONE_NAMES)[number];

export interface BoneDef {
  name: BodyBoneName;
  parent: BodyBoneName | null;
  /** joint position in body space (metres) */
  head: [number, number, number];
}

export function boneDefs(f: BodyFrame): BoneDef[] {
  const h = f.heights;
  const A = (s: 'left' | 'right', i: number) => f.arms[s].joints[i]!.pos;
  const L = (s: 'left' | 'right', i: number) => f.legs[s].joints[i]!.pos;
  const defs: BoneDef[] = [
    { name: 'hips', parent: null, head: [0, h.hip, 0] },
    { name: 'spine', parent: 'hips', head: [0, h.waist, 0] },
    { name: 'chest', parent: 'spine', head: [0, h.underbust, 0] },
    { name: 'neck', parent: 'chest', head: [0, h.neck_base, -0.01] },
    { name: 'head', parent: 'neck', head: [0, h.chin, f.head.cz] },
  ];
  for (const s of ['left', 'right'] as const) {
    const sx = s === 'left' ? 1 : -1;
    defs.push(
      { name: `shoulder_${s}`, parent: 'chest', head: [sx * f.neck.r * 1.2, h.neck_base - 0.02, 0] },
      { name: `upper_arm_${s}`, parent: `shoulder_${s}`, head: A(s, 0) },
      { name: `forearm_${s}`, parent: `upper_arm_${s}`, head: A(s, 2) },
      { name: `hand_${s}`, parent: `forearm_${s}`, head: A(s, 4) },
      { name: `thigh_${s}`, parent: 'hips', head: L(s, 0) },
      { name: `shin_${s}`, parent: `thigh_${s}`, head: L(s, 2) },
      { name: `foot_${s}`, parent: `shin_${s}`, head: L(s, 4) },
    );
  }
  return defs;
}

export interface SkinData {
  skinIndex: Uint16Array; // 4 per vertex
  skinWeight: Float32Array; // 4 per vertex
  bones: BoneDef[];
}

const RING_WEIGHTS: Record<string, [BodyBoneName | 'SIDE_ARM', number][]> = {
  // torso_head rings
  crotch: [['hips', 1]],
  hip: [['hips', 1]],
  waist: [
    ['hips', 0.5],
    ['spine', 0.5],
  ],
  underbust: [
    ['spine', 0.5],
    ['chest', 0.5],
  ],
  chest: [['chest', 1]],
  armpit: [['chest', 1]],
  deltoid: [
    ['chest', 0.6],
    ['SIDE_ARM', 0.4],
  ],
  shoulder: [
    ['chest', 0.8],
    ['SIDE_ARM', 0.2],
  ],
  neck_base: [
    ['chest', 0.4],
    ['neck', 0.6],
  ],
  neck_top: [
    ['neck', 0.5],
    ['head', 0.5],
  ],
  jaw: [['head', 1]],
  head_1: [['head', 1]],
  head_2: [['head', 1]],
  head_3: [['head', 1]],
  head_4: [['head', 1]],
};
const LIMB_WEIGHTS = (side: 'left' | 'right'): Record<string, [BodyBoneName, number][]> => ({
  shoulder_joint: [[`upper_arm_${side}`, 1]],
  upper_mid: [[`upper_arm_${side}`, 1]],
  elbow: [
    [`upper_arm_${side}`, 0.5],
    [`forearm_${side}`, 0.5],
  ],
  fore_mid: [[`forearm_${side}`, 1]],
  wrist: [
    [`forearm_${side}`, 0.5],
    [`hand_${side}`, 0.5],
  ],
  palm: [[`hand_${side}`, 1]],
  knuckles: [[`hand_${side}`, 1]],
  fingertips: [[`hand_${side}`, 1]],
  hip_joint: [[`thigh_${side}`, 1]],
  thigh_mid: [[`thigh_${side}`, 1]],
  knee: [
    [`thigh_${side}`, 0.5],
    [`shin_${side}`, 0.5],
  ],
  calf: [[`shin_${side}`, 1]],
  ankle: [
    [`shin_${side}`, 0.6],
    [`foot_${side}`, 0.4],
  ],
  heel: [[`foot_${side}`, 1]],
  heel_mid: [[`foot_${side}`, 1]],
  arch: [[`foot_${side}`, 1]],
  ball: [[`foot_${side}`, 1]],
  toes: [[`foot_${side}`, 1]],
});

export function computeSkin(mesh: BodyMesh): SkinData {
  const bones = boneDefs(mesh.frame);
  const boneIndex = new Map<string, number>(bones.map((b, i) => [b.name, i]));
  const n = mesh.stats.vertices;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const pos = mesh.geometry.attributes.position!.array as Float32Array;
  const setV = (vi: number, w: [string, number][]) => {
    let sum = 0;
    for (const [, x] of w) sum += x;
    w.forEach(([name, x], k) => {
      skinIndex[vi * 4 + k] = boneIndex.get(name)!;
      skinWeight[vi * 4 + k] = x / sum;
    });
  };
  const sideOf = (vi: number): 'left' | 'right' => (pos[vi * 3]! >= 0 ? 'left' : 'right');
  for (const part of mesh.parts) {
    const limbSide: 'left' | 'right' | null = part.name.endsWith('_left') ? 'left' : part.name.endsWith('_right') ? 'right' : null;
    const table = limbSide ? LIMB_WEIGHTS(limbSide) : null;
    const chestA = mesh.frame.torso.chest.a;
    for (const ring of part.rings) {
      for (const vi of ring.indices) {
        let w: [string, number][];
        if (table) w = table[ring.name] ?? [[`upper_arm_${limbSide}`, 1]];
        else {
          const spec = RING_WEIGHTS[ring.name] ?? [['chest', 1]];
          const x = Math.abs(pos[vi * 3]!);
          w = spec.map(([b, v]): [string, number] => {
            if (b !== 'SIDE_ARM') return [b, v];
            // only the lateral part of the deltoid/shoulder rings follows the arm
            const lateral = Math.max(0, Math.min(1, (x - chestA * 0.75) / Math.max(0.01, chestA * 0.35)));
            return [`upper_arm_${sideOf(vi)}`, v * lateral];
          });
          // give the dropped SIDE_ARM share back to the first bone
          const total = w.reduce((a, [, v]) => a + v, 0);
          if (total < 0.999) w[0] = [w[0]![0], w[0]![1] + (1 - total)];
          w = w.filter(([, v]) => v > 1e-6);
        }
        setV(vi, w);
      }
    }
    // caps follow the adjacent ring's first vertex
    const capB = part.vertexStart + part.vertexCount - 2,
      capT = part.vertexStart + part.vertexCount - 1;
    const first = part.rings[0]!.indices[0]!,
      last = part.rings[part.rings.length - 1]!.indices[0]!;
    for (let k = 0; k < 4; k++) {
      skinIndex[capB * 4 + k] = skinIndex[first * 4 + k]!;
      skinWeight[capB * 4 + k] = skinWeight[first * 4 + k]!;
      skinIndex[capT * 4 + k] = skinIndex[last * 4 + k]!;
      skinWeight[capT * 4 + k] = skinWeight[last * 4 + k]!;
    }
  }
  return { skinIndex, skinWeight, bones };
}

/** THREE.Skeleton in the rest pose + attributes on the geometry. Returns the SkinnedMesh. */
export function makeSkinnedMesh(mesh: BodyMesh, material: THREE.Material | THREE.Material[]): { skinned: THREE.SkinnedMesh; skeleton: THREE.Skeleton; bonesByName: Record<string, THREE.Bone> } {
  const skin = computeSkin(mesh);
  mesh.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skin.skinIndex, 4));
  mesh.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skin.skinWeight, 4));
  const bones: THREE.Bone[] = [];
  const byName: Record<string, THREE.Bone> = {};
  for (const d of skin.bones) {
    const b = new THREE.Bone();
    b.name = d.name;
    bones.push(b);
    byName[d.name] = b;
  }
  skin.bones.forEach((d, i) => {
    const b = bones[i]!;
    const head = new THREE.Vector3(...d.head);
    if (d.parent) {
      const p = byName[d.parent]!;
      const ph = skin.bones.find((x) => x.name === d.parent)!.head;
      b.position.copy(head).sub(new THREE.Vector3(...ph));
      p.add(b);
    } else b.position.copy(head);
  });
  const skinned = new THREE.SkinnedMesh(mesh.geometry, material);
  const root = bones[0]!;
  skinned.add(root);
  const skeleton = new THREE.Skeleton(bones);
  root.updateMatrixWorld(true);
  skinned.bind(skeleton);
  return { skinned, skeleton, bonesByName: byName };
}
