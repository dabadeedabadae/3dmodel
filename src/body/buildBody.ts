/**
 * M02 — procedural low-poly body mesh with FIXED topology (`body-basic-topo-1`).
 *
 * Parts (each a closed tube, so each is a manifold on its own):
 *   torso_head : crotch cap → 9 torso rings → neck → 5 head rings → top cap (M=10)
 *   arm_left/right : shoulder joint → wrist (5 rings) + hand (3 rings + cap)  (M=6)
 *   leg_left/right : hip joint → ankle (5 rings)  (M=6)
 *   foot_left/right: heel → toe rings around the Z axis (M=6)
 * Parts overlap at the joints on purpose (arm root inside the shoulder, foot
 * under the ankle) — the garment never sees those seams; collision queries use
 * the analytic frame (`anatomy.ts`), not this mesh.
 *
 * Deformation is always re-derived from params (`updateBody`), never
 * accumulated. The index buffer is identical for every parameter set.
 */
import * as THREE from 'three';
import { TORSO_RING_NAMES, computeFrame, ellipsePoint, type BodyFrame, type LimbAxis } from './anatomy';
import { clampBodyParams, defaultBodyParams, type BodyParams, type ClampNote } from './params';
import type { AvatarRegionName, AvatarSurface } from '../fitting/AvatarAdapter';
import type { WearerSide } from '../domain/sides';

// Low-poly on purpose (user reference: faceted figure): 10 segments around the torso/head, 6 around limbs.
export const M_TORSO = 10;
export const M_LIMB = 6;
/** torso/head rings start at the centre front so the low-poly chest/back have a centre edge (like the reference figure) */
export const TORSO_THETA0 = Math.PI / 2;

export type BodyPartName = 'torso_head' | 'arm_left' | 'arm_right' | 'leg_left' | 'leg_right' | 'foot_left' | 'foot_right';

export interface BodyRegionRange {
  region: AvatarRegionName;
  triangleStart: number;
  triangleCount: number;
}

export interface BodyPartMeta {
  name: BodyPartName;
  vertexStart: number;
  vertexCount: number;
  triangleStart: number;
  triangleCount: number;
  /** rings in order, each a list of vertex indices (global) */
  rings: { name: string; indices: number[] }[];
}

export interface BodyMesh {
  geometry: THREE.BufferGeometry;
  /** what was asked for (sliders), before anatomical clamps — clamps never accumulate */
  requested: BodyParams;
  /** applied (clamped) params */
  params: BodyParams;
  clamped: ClampNote[];
  frame: BodyFrame;
  parts: BodyPartMeta[];
  regions: BodyRegionRange[];
  stats: { vertices: number; triangles: number };
}

type V3 = [number, number, number];

/** Topology plan — built once; positions are filled per params. */
interface PartPlan {
  name: BodyPartName;
  region: AvatarRegionName | ((ringIndex: number) => AvatarRegionName);
  ringNames: string[];
  M: number;
  capBottom: boolean;
  capTop: boolean;
}

const TORSO_HEAD_RINGS = [...TORSO_RING_NAMES, 'neck_top', 'jaw', 'head_1', 'head_2', 'head_3', 'head_4'];
const ARM_RINGS = ['shoulder_joint', 'upper_mid', 'elbow', 'fore_mid', 'wrist', 'palm', 'knuckles', 'fingertips'];
const LEG_RINGS = ['hip_joint', 'thigh_mid', 'knee', 'calf', 'ankle'];
const FOOT_RINGS = ['heel', 'heel_mid', 'arch', 'ball', 'toes'];

const PLANS: PartPlan[] = [
  {
    name: 'torso_head',
    region: (i) => (i < TORSO_RING_NAMES.length ? 'torso' : i === TORSO_RING_NAMES.length ? 'neck' : 'head'),
    ringNames: TORSO_HEAD_RINGS,
    M: M_TORSO,
    capBottom: true,
    capTop: true,
  },
  { name: 'arm_left', region: 'arm_left', ringNames: ARM_RINGS, M: M_LIMB, capBottom: true, capTop: true },
  { name: 'arm_right', region: 'arm_right', ringNames: ARM_RINGS, M: M_LIMB, capBottom: true, capTop: true },
  { name: 'leg_left', region: 'leg_left', ringNames: LEG_RINGS, M: M_LIMB, capBottom: true, capTop: true },
  { name: 'leg_right', region: 'leg_right', ringNames: LEG_RINGS, M: M_LIMB, capBottom: true, capTop: true },
  { name: 'foot_left', region: 'foot_left', ringNames: FOOT_RINGS, M: M_LIMB, capBottom: true, capTop: true },
  { name: 'foot_right', region: 'foot_right', ringNames: FOOT_RINGS, M: M_LIMB, capBottom: true, capTop: true },
];

interface Topology {
  index: Uint32Array;
  vertexCount: number;
  parts: BodyPartMeta[];
  regions: BodyRegionRange[];
  /** per part: index of bottom/top cap vertex (or -1) */
  caps: Record<BodyPartName, { bottom: number; top: number }>;
}

let TOPO: Topology | null = null;

function buildTopology(): Topology {
  const idx: number[] = [];
  const parts: BodyPartMeta[] = [];
  const caps = {} as Topology['caps'];
  const regionTris: { region: AvatarRegionName; start: number; count: number }[] = [];
  let v = 0;
  for (const plan of PLANS) {
    const part: BodyPartMeta = { name: plan.name, vertexStart: v, vertexCount: 0, triangleStart: idx.length / 3, triangleCount: 0, rings: [] };
    const rings: number[][] = [];
    for (const rn of plan.ringNames) {
      const ring: number[] = [];
      for (let k = 0; k < plan.M; k++) ring.push(v++);
      rings.push(ring);
      part.rings.push({ name: rn, indices: ring });
    }
    let capBottom = -1,
      capTop = -1;
    if (plan.capBottom) capBottom = v++;
    if (plan.capTop) capTop = v++;
    caps[plan.name] = { bottom: capBottom, top: capTop };
    const regionOf = (ri: number): AvatarRegionName => (typeof plan.region === 'function' ? plan.region(ri) : plan.region);
    const pushTri = (a: number, b: number, c: number, region: AvatarRegionName) => {
      const last = regionTris[regionTris.length - 1];
      if (last && last.region === region && last.start + last.count === idx.length / 3) last.count++;
      else regionTris.push({ region, start: idx.length / 3, count: 1 });
      idx.push(a, b, c);
    };
    // bottom cap (fan, facing down => reverse order)
    if (capBottom >= 0) {
      const r0 = rings[0]!;
      for (let k = 0; k < plan.M; k++) pushTri(capBottom, r0[(k + 1) % plan.M]!, r0[k]!, regionOf(0));
    }
    // side quads: rings go "up" the part, θ increases CCW seen from +Y → outward = (k, k+1, next k+1) order
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r]!,
        B = rings[r + 1]!;
      const region = regionOf(r + 1);
      for (let k = 0; k < plan.M; k++) {
        const k1 = (k + 1) % plan.M;
        pushTri(A[k]!, A[k1]!, B[k1]!, region);
        pushTri(A[k]!, B[k1]!, B[k]!, region);
      }
    }
    if (capTop >= 0) {
      const rN = rings[rings.length - 1]!;
      for (let k = 0; k < plan.M; k++) pushTri(capTop, rN[k]!, rN[(k + 1) % plan.M]!, regionOf(rings.length - 1));
    }
    part.vertexCount = v - part.vertexStart;
    part.triangleCount = idx.length / 3 - part.triangleStart;
    parts.push(part);
  }
  return {
    index: new Uint32Array(idx),
    vertexCount: v,
    parts,
    regions: regionTris.map((r) => ({ region: r.region, triangleStart: r.start, triangleCount: r.count })),
    caps,
  };
}

export function bodyTopology(): Topology {
  if (!TOPO) {
    TOPO = buildTopology();
    // Orientation is a construction constant: measure the signed volume of each closed part once
    // (default params) and flip the winding of parts built inside-out, so the baked index is outward.
    const pos = bodyPositions(computeFrame(clampBodyParams({}).params));
    const idx = TOPO.index;
    for (const part of TOPO.parts) {
      let vol = 0;
      for (let t = part.triangleStart; t < part.triangleStart + part.triangleCount; t++) {
        const a = idx[t * 3]! * 3,
          b = idx[t * 3 + 1]! * 3,
          c = idx[t * 3 + 2]! * 3;
        vol +=
          (pos[a]! * (pos[b + 1]! * pos[c + 2]! - pos[b + 2]! * pos[c + 1]!) -
            pos[a + 1]! * (pos[b]! * pos[c + 2]! - pos[b + 2]! * pos[c]!) +
            pos[a + 2]! * (pos[b]! * pos[c + 1]! - pos[b + 1]! * pos[c]!)) /
          6;
      }
      if (vol < 0)
        for (let t = part.triangleStart; t < part.triangleStart + part.triangleCount; t++) {
          const tmp = idx[t * 3 + 1]!;
          idx[t * 3 + 1] = idx[t * 3 + 2]!;
          idx[t * 3 + 2] = tmp;
        }
    }
  }
  return TOPO;
}

// ---------------------------------------------------------------------------
// positions
// ---------------------------------------------------------------------------

function ringAround(center: V3, u: V3, w: V3, ra: number, rb: number, M: number, out: V3[]) {
  for (let k = 0; k < M; k++) {
    const t = (2 * Math.PI * k) / M;
    const c = Math.cos(t),
      s = Math.sin(t);
    out.push([center[0] + u[0] * ra * c + w[0] * rb * s, center[1] + u[1] * ra * c + w[1] * rb * s, center[2] + u[2] * ra * c + w[2] * rb * s]);
  }
}

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Limb rings: perpendicular to the local axis direction. u lies in the X-Y plane (across), w ≈ +Z (front). */
function limbRings(axis: LimbAxis, M: number, out: V3[], scaleAcross = 1, scaleFront = 1) {
  const J = axis.joints;
  for (let i = 0; i < J.length; i++) {
    const prev = J[Math.max(0, i - 1)]!.pos,
      next = J[Math.min(J.length - 1, i + 1)]!.pos;
    const d = norm(sub(next, prev));
    // w: front-ish perpendicular; u: across
    let w = norm(cross(d, [1, 0, 0]));
    if (w[2] < 0) w = [-w[0], -w[1], -w[2]];
    const u = norm(cross(w, d)); // u × w orientation chosen so that θ increases CCW seen from the "up" (d) direction
    const uu: V3 = axis.side === 'left' ? u : [-u[0], -u[1], -u[2]];
    // keep CCW seen from +Y-ish: for arms/legs d points DOWN, so flip ordering by negating w
    ringAround(J[i]!.pos, uu, [-w[0], -w[1], -w[2]], J[i]!.r * scaleAcross, J[i]!.r * scaleFront, M, out);
  }
}

export function bodyPositions(frame: BodyFrame): Float32Array {
  const topo = bodyTopology();
  const P: V3[] = new Array(topo.vertexCount);
  const put = (part: BodyPartMeta, ringIdx: number, pts: V3[]) => {
    const ring = part.rings[ringIdx]!.indices;
    for (let k = 0; k < ring.length; k++) P[ring[k]!] = pts[k]!;
  };
  const partByName = Object.fromEntries(topo.parts.map((p) => [p.name, p])) as Record<BodyPartName, BodyPartMeta>;

  // ---- torso + neck + head (one tube) ----
  {
    const part = partByName.torso_head;
    let ri = 0;
    for (const rn of TORSO_RING_NAMES) {
      const e = frame.torso[rn];
      const pts: V3[] = [];
      for (let k = 0; k < M_TORSO; k++) pts.push(ellipsePoint(e, TORSO_THETA0 + (2 * Math.PI * k) / M_TORSO));
      put(part, ri++, pts);
    }
    const H = frame.head;
    const neckTop: V3[] = [];
    for (let k = 0; k < M_TORSO; k++) {
      const t = TORSO_THETA0 + (2 * Math.PI * k) / M_TORSO;
      neckTop.push([frame.neck.r * Math.cos(t), frame.neck.yTop, -0.008 + frame.neck.r * 0.95 * Math.sin(t)]);
    }
    put(part, ri++, neckTop);
    // head profile: fraction of head height from chin, (width scale, depth scale, forward shift of centre)
    const chin = frame.heights.chin;
    const prof: [number, number, number, number][] = [
      [0.03, 0.72, 0.7, 0.018], // jaw/chin: pushed forward, never narrower than the neck
      [0.25, 0.93, 0.95, 0.0],
      [0.5, 1.0, 1.0, 0.0], // widest (ears / eyebrows)
      [0.76, 0.95, 0.95, -0.004],
      [0.93, 0.66, 0.7, -0.01],
    ];
    for (const [f, sw, sd, dz] of prof) {
      const pts: V3[] = [];
      const y = chin + f * H.h;
      for (let k = 0; k < M_TORSO; k++) {
        const t = TORSO_THETA0 + (2 * Math.PI * k) / M_TORSO;
        pts.push([(H.width / 2) * sw * Math.cos(t), y, H.cz + dz + (H.depth / 2) * sd * Math.sin(t)]);
      }
      put(part, ri++, pts);
    }
    const c = topo.caps.torso_head;
    P[c.bottom] = [0, frame.heights.crotch - 0.015, 0];
    P[c.top] = [0, frame.heights.head_top, H.cz - 0.01];
  }

  // ---- arms + hands ----
  for (const side of ['left', 'right'] as WearerSide[]) {
    const part = partByName[`arm_${side}`];
    const axis = frame.arms[side];
    const pts: V3[] = [];
    limbRings(axis, M_LIMB, pts);
    for (let i = 0; i < axis.joints.length; i++) put(part, i, pts.slice(i * M_LIMB, (i + 1) * M_LIMB));
    // hand continues along the forearm direction; palm faces the body (wide axis ≈ front-back)
    const J = axis.joints;
    const wrist = J[J.length - 1]!.pos,
      elbow = J[J.length - 3]!.pos;
    const d = norm(sub(wrist, elbow));
    const hl = frame.hand.length,
      hw = frame.hand.width,
      ht = frame.hand.thick;
    const hands: { f: number; w: number; t: number }[] = [
      { f: 0.12, w: 0.85, t: 1 },
      { f: 0.5, w: 1, t: 0.8 },
      { f: 1, w: 0.6, t: 0.35 },
    ];
    let w: V3 = norm(cross(d, [1, 0, 0]));
    if (w[2] < 0) w = [-w[0], -w[1], -w[2]];
    const u = norm(cross(w, d));
    const uu: V3 = side === 'left' ? u : [-u[0], -u[1], -u[2]];
    const base = axis.joints.length;
    hands.forEach((h, i) => {
      const center: V3 = [wrist[0] + d[0] * hl * h.f, wrist[1] + d[1] * hl * h.f, wrist[2] + d[2] * hl * h.f + 0.01 * h.f];
      const ring: V3[] = [];
      ringAround(center, uu, [-w[0], -w[1], -w[2]], (ht / 2) * h.t, (hw / 2) * h.w, M_LIMB, ring);
      put(part, base + i, ring);
    });
    const c = topo.caps[`arm_${side}`];
    const s0 = J[0]!.pos;
    P[c.bottom] = [s0[0] - d[0] * J[0]!.r * 0.6, s0[1] - d[1] * J[0]!.r * 0.6, s0[2]];
    P[c.top] = [wrist[0] + d[0] * hl * 1.03, wrist[1] + d[1] * hl * 1.03, wrist[2] + d[2] * hl + 0.01];
  }

  // ---- legs ----
  for (const side of ['left', 'right'] as WearerSide[]) {
    const part = partByName[`leg_${side}`];
    const axis = frame.legs[side];
    const pts: V3[] = [];
    limbRings(axis, M_LIMB, pts, 1, 1.05);
    for (let i = 0; i < axis.joints.length; i++) put(part, i, pts.slice(i * M_LIMB, (i + 1) * M_LIMB));
    const c = topo.caps[`leg_${side}`];
    const top = axis.joints[0]!.pos,
      bot = axis.joints[axis.joints.length - 1]!.pos;
    P[c.bottom] = [top[0], top[1] + axis.joints[0]!.r * 0.4, top[2]];
    P[c.top] = [bot[0], bot[1] - 0.02, bot[2]];
  }

  // ---- feet (rings around Z from heel to toes) ----
  for (const side of ['left', 'right'] as WearerSide[]) {
    const part = partByName[`foot_${side}`];
    const ankle = frame.legs[side].joints[frame.legs[side].joints.length - 1]!.pos;
    const L = frame.foot.length,
      W = frame.foot.width,
      Hh = frame.foot.height;
    // z offset of ring (fraction of L from heel), half width, height
    const prof: [number, number, number][] = [
      [-0.26, 0.55, 0.7],
      [-0.1, 0.9, 1.0],
      [0.2, 0.95, 0.95],
      [0.5, 1.0, 0.55],
      [0.72, 0.75, 0.3],
    ];
    prof.forEach(([f, sw, sh], i) => {
      const ring: V3[] = [];
      const cz = ankle[2] + f * L;
      const cy = (Hh * sh) / 2;
      for (let k = 0; k < M_LIMB; k++) {
        const t = (2 * Math.PI * k) / M_LIMB;
        // θ=0 → +X (wearer left) … CCW seen from +Z (toe direction) requires (x, y) = (cos, sin)
        ring.push([ankle[0] + (W / 2) * sw * Math.cos(t), cy + cy * Math.sin(t), cz]);
      }
      put(part, i, ring);
    });
    const c = topo.caps[`foot_${side}`];
    P[c.bottom] = [ankle[0], (Hh * 0.5) / 2, ankle[2] - 0.3 * L];
    P[c.top] = [ankle[0], (Hh * 0.3) / 2, ankle[2] + 0.76 * L];
  }

  const out = new Float32Array(topo.vertexCount * 3);
  for (let i = 0; i < topo.vertexCount; i++) {
    const p = P[i];
    if (!p) throw new Error(`body topology: vertex ${i} has no position`);
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  }
  return out;
}

export function buildBody(partial: Partial<BodyParams> = {}): BodyMesh {
  const sex = (partial.sex ?? 0) >= 0.5 ? 'female' : 'male';
  const requested: BodyParams = { ...defaultBodyParams(sex), ...partial };
  const { params, clamped } = clampBodyParams(requested);
  const frame = computeFrame(params);
  const topo = bodyTopology();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(bodyPositions(frame), 3));
  geometry.setIndex(new THREE.BufferAttribute(topo.index.slice(), 1));
  geometry.computeVertexNormals();
  // material groups per part (same material; lets the dev page colour parts)
  for (const part of topo.parts) geometry.addGroup(part.triangleStart * 3, part.triangleCount * 3, PLANS.findIndex((p) => p.name === part.name));
  return { geometry, requested, params, clamped, frame, parts: topo.parts, regions: topo.regions, stats: { vertices: topo.vertexCount, triangles: topo.index.length / 3 } };
}

/** Re-derives positions from params (never accumulates). Index buffer untouched. */
export function updateBody(mesh: BodyMesh, partial: Partial<BodyParams>): BodyMesh {
  mesh.requested = { ...mesh.requested, ...partial };
  const { params, clamped } = clampBodyParams(mesh.requested);
  const frame = computeFrame(params);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  (pos.array as Float32Array).set(bodyPositions(frame));
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.params = params;
  mesh.clamped = clamped;
  mesh.frame = frame;
  return mesh;
}

export function bodySurface(mesh: BodyMesh): AvatarSurface {
  return {
    positions: (mesh.geometry.attributes.position!.array as Float32Array).slice(),
    normals: (mesh.geometry.attributes.normal!.array as Float32Array).slice(),
    indices: (mesh.geometry.index!.array as Uint32Array).slice(),
    regions: mesh.regions.map((r) => ({ name: r.region, triangleStart: r.triangleStart, triangleCount: r.triangleCount })),
  };
}
