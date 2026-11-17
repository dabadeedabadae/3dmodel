// Moved from lowpoly-v2/src/mesh.ts on 2026-11-18 when lowpoly-v2 went to archive/ (I-45). Unchanged.
/**
 * Low-poly V2 — stage 04: ONE closed, connected working mesh with fixed topology.
 *
 * Topology (built once, `topology()`), positions from a `BodyFrame` (built from the proportions file):
 *   torso tube  M_T = 14 columns, θ starts at the FRONT centre (col 0), back centre = col 7,
 *               wearer's left (+X) around col 3.5, right (−X) around col 10.5
 *   rows        0 crotch_ring (pelvis bottom; split into two leg loops by the crotch chord 0—7)
 *               1 hip  2 waist  3 underbust  4 chest  5 armpit  6 arm_mid  7 acromion  8 neck_base
 *               9 neck_top  10 jaw  11..14 head  (+ top cap)
 *   armholes    quads removed at rows 5..6 × cols 2..4 (left, +X) and 10..12 (right) → 8-vertex loops,
 *               arm tubes of 8 segments continue from them (elbow, forearm, wrist, palm, knuckles, tips, cap)
 *   legs        loop = half of the crotch ring (8 vertices) + the shared crotch chord; thigh, knee, calf,
 *               ankle, then the foot bends forward (instep, ball, toes, cap)
 * Everything shares vertices: no overlapping primitives, zero boundary edges, manifold, outward.
 * Semantic groups per vertex and a basic per-part cylindrical UV are attributes of the geometry.
 */
import * as THREE from 'three';
import type { Proportions } from './blocking';

export const M_T = 14; // torso / neck / head columns
export const M_L = 8; // limb segments (fixed by the 2×2-quad armhole and the half-ring leg loop)
export const TOPOLOGY_VERSION = 'lowpoly-v2-topo-2';
export const BODY_VERSION = 'lowpoly-v2-body-0.2';

export type V3 = [number, number, number];
export type Side = 'left' | 'right';
export type GroupName = 'head' | 'neck' | 'torso' | 'pelvis' | 'upper_arm_left' | 'upper_arm_right' | 'forearm_left' | 'forearm_right' | 'hand_left' | 'hand_right' | 'thigh_left' | 'thigh_right' | 'shin_left' | 'shin_right' | 'foot_left' | 'foot_right';
export const GROUP_NAMES: GroupName[] = ['head', 'neck', 'torso', 'pelvis', 'upper_arm_left', 'upper_arm_right', 'forearm_left', 'forearm_right', 'hand_left', 'hand_right', 'thigh_left', 'thigh_right', 'shin_left', 'shin_right', 'foot_left', 'foot_right'];

const TORSO_ROWS = [
  'crotch_ring',
  'seat', // buttock level: widest behind
  'hip', // greatest hip circumference
  'belly',
  'waist',
  'underbust',
  'bust',
  'chest_upper',
  'armpit',
  'arm_mid',
  'acromion',
  'neck_base',
  'neck_mid',
  'neck_top',
  'jaw',
  'head_1',
  'head_2',
  'head_3',
  'head_4',
] as const;
export type TorsoRow = (typeof TORSO_ROWS)[number];
const ROW = Object.fromEntries(TORSO_ROWS.map((n, i) => [n, i])) as Record<TorsoRow, number>;
const ARM_RINGS = ['armhole', 'deltoid', 'bicep', 'upper_mid', 'elbow', 'fore_upper', 'fore_mid', 'wrist', 'palm', 'knuckles', 'tips'] as const;
const LEG_RINGS = ['crotch_loop', 'thigh_top', 'thigh_upper', 'thigh_mid', 'above_knee', 'knee', 'below_knee', 'calf', 'lower_calf', 'ankle', 'instep', 'ball', 'toes'] as const;
export type ArmRing = (typeof ARM_RINGS)[number];
export type LegRing = (typeof LEG_RINGS)[number];

/** armhole loop as [row, col] in loop order (underarm first, counter-clockwise seen from outside) */
function armholeLoop(side: Side): [number, number][] {
  const r0 = ROW.armpit,
    r1 = ROW.arm_mid,
    r2 = ROW.acromion;
  const c = side === 'left' ? [2, 3, 4] : [12, 11, 10]; // col 3.5 is +X (wearer's left) — see colTheta; mirrored order so both loops run the same way
  return [
    [r0, c[1]!],
    [r0, c[2]!],
    [r1, c[2]!],
    [r2, c[2]!],
    [r2, c[1]!],
    [r2, c[0]!],
    [r1, c[0]!],
    [r0, c[0]!],
  ];
}
/** leg loop: half of the crotch ring, 8 vertices, from the front centre over the side to the back centre */
function legLoop(side: Side): number[] {
  return side === 'left' ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 13, 12, 11, 10, 9, 8, 7];
}

export interface Topology {
  index: Uint32Array;
  vertexCount: number;
  /** logical id helpers */
  grid: (row: number, col: number) => number;
  arm: (side: Side, ring: number, m: number) => number; // ring ≥ 1 (ring 0 = armhole grid vertices)
  leg: (side: Side, ring: number, m: number) => number; // ring ≥ 1 (ring 0 = crotch ring vertices)
  headCap: number;
  handCap: Record<Side, number>;
  footCap: Record<Side, number>;
  group: Uint8Array; // GroupName index per vertex
  rings: { name: string; ids: number[] }[];
  triangleGroups: { group: GroupName; start: number; count: number }[];
}

let TOPO: Topology | null = null;
export function topology(): Topology {
  if (TOPO) return TOPO;
  const grid = (row: number, col: number) => row * M_T + (((col % M_T) + M_T) % M_T);
  const gridCount = TORSO_ROWS.length * M_T;
  const armBase = gridCount;
  const armRings = ARM_RINGS.length - 1; // ring 0 reuses grid ids
  const arm = (side: Side, ring: number, m: number) => armBase + (side === 'left' ? 0 : armRings * M_L) + (ring - 1) * M_L + (m % M_L);
  const legBase = armBase + 2 * armRings * M_L;
  const legRings = LEG_RINGS.length - 1;
  const leg = (side: Side, ring: number, m: number) => legBase + (side === 'left' ? 0 : legRings * M_L) + (ring - 1) * M_L + (m % M_L);
  let v = legBase + 2 * legRings * M_L;
  const headCap = v++;
  const handCap: Record<Side, number> = { left: v++, right: v++ };
  const footCap: Record<Side, number> = { left: v++, right: v++ };
  const vertexCount = v;
  const group = new Uint8Array(vertexCount);
  const G = (name: GroupName) => GROUP_NAMES.indexOf(name);
  const idx: number[] = [];
  const triangleGroups: Topology['triangleGroups'] = [];
  let curGroup: GroupName | null = null;
  const tri = (a: number, b: number, c: number, g: GroupName) => {
    if (g !== curGroup) {
      triangleGroups.push({ group: g, start: idx.length / 3, count: 0 });
      curGroup = g;
    }
    triangleGroups[triangleGroups.length - 1]!.count++;
    idx.push(a, b, c);
  };
  const quad = (a: number, b: number, c: number, d: number, g: GroupName) => {
    tri(a, b, c, g);
    tri(a, c, d, g);
  };
  const rowGroup = (row: number): GroupName => (row <= ROW.hip ? 'pelvis' : row <= ROW.neck_base ? 'torso' : row <= ROW.jaw ? 'neck' : 'head');
  // vertex groups for grid
  for (let r = 0; r < TORSO_ROWS.length; r++) for (let c = 0; c < M_T; c++) group[grid(r, c)] = G(rowGroup(r));
  group[headCap] = G('head');
  // removed spans for the armholes: rows armpit..arm_mid (2 rows) × col spans [2,3] and [10,11]
  const removed = new Set<string>();
  for (const r of [ROW.armpit, ROW.arm_mid]) for (const c of [2, 3, 10, 11]) removed.add(`${r}:${c}`);
  // torso + neck + head quads
  for (let r = 0; r < TORSO_ROWS.length - 1; r++)
    for (let c = 0; c < M_T; c++) {
      if (removed.has(`${r}:${c}`)) continue;
      quad(grid(r, c), grid(r, c + 1), grid(r + 1, c + 1), grid(r + 1, c), rowGroup(r + 1));
    }
  // head cap
  const top = TORSO_ROWS.length - 1;
  for (let c = 0; c < M_T; c++) tri(headCap, grid(top, c), grid(top, c + 1), 'head');
  // arms
  const rings: Topology['rings'] = [];
  for (let r = 0; r < TORSO_ROWS.length; r++) rings.push({ name: TORSO_ROWS[r]!, ids: Array.from({ length: M_T }, (_, c) => grid(r, c)) });
  for (const side of ['left', 'right'] as Side[]) {
    const loop = armholeLoop(side).map(([r, c]) => grid(r, c));
    const ringIds = (ring: number) => (ring === 0 ? loop : Array.from({ length: M_L }, (_, m) => arm(side, ring, m)));
    for (let ring = 1; ring < ARM_RINGS.length; ring++) {
      const g: GroupName = ring <= 4 ? `upper_arm_${side}` : ring <= 7 ? `forearm_${side}` : `hand_${side}`;
      for (let m = 0; m < M_L; m++) group[arm(side, ring, m)] = G(g);
      const A = ringIds(ring - 1),
        B = ringIds(ring);
      for (let m = 0; m < M_L; m++) quad(A[m]!, A[(m + 1) % M_L]!, B[(m + 1) % M_L]!, B[m]!, g);
      rings.push({ name: `${ARM_RINGS[ring]}_${side}`, ids: B });
    }
    const tips = ringIds(ARM_RINGS.length - 1);
    group[handCap[side]] = G(`hand_${side}`);
    for (let m = 0; m < M_L; m++) tri(handCap[side], tips[m]!, tips[(m + 1) % M_L]!, `hand_${side}`);
    rings.push({ name: `armhole_${side}`, ids: loop });
  }
  // legs
  for (const side of ['left', 'right'] as Side[]) {
    const loop = legLoop(side).map((c) => grid(ROW.crotch_ring, c));
    const ringIds = (ring: number) => (ring === 0 ? loop : Array.from({ length: M_L }, (_, m) => leg(side, ring, m)));
    for (let ring = 1; ring < LEG_RINGS.length; ring++) {
      const g: GroupName = ring <= 5 ? `thigh_${side}` : ring <= 9 ? `shin_${side}` : `foot_${side}`;
      for (let m = 0; m < M_L; m++) group[leg(side, ring, m)] = G(g);
      const A = ringIds(ring - 1),
        B = ringIds(ring);
      for (let m = 0; m < M_L; m++) quad(A[m]!, A[(m + 1) % M_L]!, B[(m + 1) % M_L]!, B[m]!, g);
      rings.push({ name: `${LEG_RINGS[ring]}_${side}`, ids: B });
    }
    const toes = ringIds(LEG_RINGS.length - 1);
    group[footCap[side]] = G(`foot_${side}`);
    for (let m = 0; m < M_L; m++) tri(footCap[side], toes[m]!, toes[(m + 1) % M_L]!, `foot_${side}`);
    rings.push({ name: `crotch_loop_${side}`, ids: loop });
  }
  // --- make winding consistent by propagation over shared edges (tubes attached with mirrored loops) ---
  orientConsistently(idx);
  // --- compact: drop vertices that no face uses (the middle armhole vertices of the arm_mid row) ---
  const used = new Uint8Array(vertexCount);
  for (const i of idx) used[i] = 1;
  const remap = new Int32Array(vertexCount).fill(-1);
  let nv = 0;
  for (let i = 0; i < vertexCount; i++) if (used[i]) remap[i] = nv++;
  const R = (f: (...a: never[]) => number) => (...a: never[]) => remap[f(...a)]!;
  const index = new Uint32Array(idx.map((i) => remap[i]!));
  const group2 = new Uint8Array(nv);
  for (let i = 0; i < vertexCount; i++) if (remap[i]! >= 0) group2[remap[i]!] = group[i]!;
  const rings2 = rings.map((r) => ({ name: r.name, ids: r.ids.map((i) => remap[i]!).filter((i) => i >= 0) }));
  TOPO = {
    index,
    vertexCount: nv,
    grid: R(grid as (...a: never[]) => number) as Topology['grid'],
    arm: R(arm as (...a: never[]) => number) as Topology['arm'],
    leg: R(leg as (...a: never[]) => number) as Topology['leg'],
    headCap: remap[headCap]!,
    handCap: { left: remap[handCap.left]!, right: remap[handCap.right]! },
    footCap: { left: remap[footCap.left]!, right: remap[footCap.right]! },
    group: group2,
    rings: rings2,
    triangleGroups,
  };
  return TOPO;
}

/** Flip triangles so that every shared edge is traversed in opposite directions by its two faces (BFS from triangle 0). */
function orientConsistently(idx: number[]): void {
  const tCount = idx.length / 3;
  const edgeTris = new Map<string, number[]>();
  const key = (u: number, v: number) => (u < v ? `${u}_${v}` : `${v}_${u}`);
  for (let t = 0; t < tCount; t++)
    for (let k = 0; k < 3; k++) {
      const e = key(idx[t * 3 + k]!, idx[t * 3 + ((k + 1) % 3)]!);
      (edgeTris.get(e) ?? edgeTris.set(e, []).get(e)!).push(t);
    }
  const visited = new Uint8Array(tCount);
  const dirOf = (t: number, u: number, v: number) => {
    for (let k = 0; k < 3; k++) if (idx[t * 3 + k] === u && idx[t * 3 + ((k + 1) % 3)] === v) return 1;
    return -1;
  };
  const flip = (t: number) => {
    const tmp = idx[t * 3 + 1]!;
    idx[t * 3 + 1] = idx[t * 3 + 2]!;
    idx[t * 3 + 2] = tmp;
  };
  for (let s = 0; s < tCount; s++) {
    if (visited[s]) continue;
    visited[s] = 1;
    const stack = [s];
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const u = idx[t * 3 + k]!,
          v = idx[t * 3 + ((k + 1) % 3)]!;
        for (const o of edgeTris.get(key(u, v))!) {
          if (o === t || visited[o]) continue;
          if (dirOf(o, u, v) === 1) flip(o); // same direction → inconsistent → flip
          visited[o] = 1;
          stack.push(o);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// frame (positions of every ring) from the proportions file
// ---------------------------------------------------------------------------
export interface Ring {
  c: V3;
  /** half-width across (u) and half-depth (w) */
  a: number;
  b: number;
  /** axis direction (ring plane normal) */
  n: V3;
  /** forward bulge (bust) on the front half */
  bulge?: number;
  /** metres by which the SIDES of the ring drop below its centre (shoulder slope); horizontal rings only */
  drop?: number;
}
export interface BodyFrame {
  height: number;
  torso: Record<TorsoRow, Ring>;
  arms: Record<Side, Record<Exclude<ArmRing, 'armhole'>, Ring>>;
  legs: Record<Side, Record<Exclude<LegRing, 'crotch_loop'>, Ring>>;
  heights: Record<string, number>;
  joints: Record<Side, { shoulder: V3; elbow: V3; wrist: V3; hip: V3; knee: V3; ankle: V3 }>;
}

const nrm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function frameFromProportions(P: Proportions): BodyFrame {
  const H = P.height_m;
  const h = (k: string) => P.heights_fraction_of_H[k]! * H;
  const w = (k: string) => P.widths_fraction_of_H[k]! * H;
  const up: V3 = [0, 1, 0];
  const nr = w('neck_width') / 2;
  const sw = w('shoulder_width_acromions') / 2;
  const armR = w('upper_arm_width') / 2;
  const bust = w('bust_prominence');
  const cw = w('chest_width') / 2,
    cd = w('chest_depth') / 2;
  const hw = w('hip_width') / 2,
    hd = w('hip_depth') / 2;
  const ww = w('waist_width') / 2,
    wd = w('waist_depth') / 2;
  const headH = h('head_top') - h('chin');
  const HW = w('head_width') / 2,
    HD = w('head_depth') / 2;
  const R = (y: number, a: number, b: number, z = 0, bulge = 0, drop = 0): Ring => ({ c: [0, y, z], a, b, n: up, bulge, drop });
  const sh2 = (a: number, b: number) => ({ a, b });
  void sh2;
  const hipY = h('hip'),
    crotchY = h('crotch'),
    waistY = h('waist'),
    bustY = h('chest'),
    armpitY = h('armpit'),
    acrY = h('acromion');
  const torso: BodyFrame['torso'] = {
    // pelvis: narrow between the legs, buttocks behind, widest at the hip line
    crotch_ring: R(crotchY + 0.02, hw * 0.95, hd * 0.86),
    seat: R(crotchY + (hipY - crotchY) * 0.55, hw * 0.99, hd * 1.03, -0.012 * H),
    hip: R(hipY, hw, hd, -0.006 * H),
    belly: R(hipY + (waistY - hipY) * 0.55, (hw + ww) / 2, (hd + wd) / 2, 0.002 * H),
    waist: R(waistY, ww, wd, 0.004),
    // ribcage: underbust crease, then the bust
    underbust: R(waistY + (bustY - waistY) * 0.62, cw * 0.93, cd * 0.95, 0.006, bust * 0.35),
    bust: R(bustY, cw, cd, 0.008, bust),
    chest_upper: R(bustY + (armpitY - bustY) * 0.6, cw * 0.97, cd * 0.92, 0.004, bust * 0.3),
    armpit: R(armpitY, cw * 0.95, cd * 0.86, 0.0),
    arm_mid: R(armpitY + (acrY - armpitY) * 0.55, Math.max(cw * 1.02, sw * 0.82), cd * 0.86, -0.003, 0, (acrY - armpitY) * 0.18),
    acromion: R(acrY, sw * 0.78, cd * 0.72, -0.008, 0, (acrY - armpitY) * 0.5),
    neck_base: R(h('neck_base'), nr * 1.3, nr * 1.2, -0.01, 0, (acrY - armpitY) * 0.12),
    neck_mid: R(h('neck_base') + (h('chin') - h('neck_base')) * 0.5, nr * 1.08, nr * 1.06, -0.008),
    neck_top: R(h('chin') - 0.004, nr * 0.97, nr * 1.0, -0.006),
    jaw: R(h('chin') + headH * 0.06, HW * 0.72, HD * 0.66, 0.008),
    head_1: R(h('chin') + headH * 0.28, HW * 0.96, HD * 0.95, -0.004),
    head_2: R(h('chin') + headH * 0.52, HW, HD, -0.012),
    head_3: R(h('chin') + headH * 0.76, HW * 0.95, HD * 0.95, -0.014),
    head_4: R(h('chin') + headH * 0.93, HW * 0.66, HD * 0.7, -0.018),
  };
  const heights: Record<string, number> = {};
  for (const k of Object.keys(P.heights_fraction_of_H)) heights[k] = h(k);
  const abd = P.angles_rad['arm_abduction']!;
  const arms = {} as BodyFrame['arms'];
  const legs = {} as BodyFrame['legs'];
  const joints = {} as BodyFrame['joints'];
  for (const side of ['left', 'right'] as Side[]) {
    const s = side === 'left' ? 1 : -1;
    const dir: V3 = nrm([s * Math.sin(abd), -Math.cos(abd), 0]);
    const sh: V3 = [s * sw, h('acromion') - armR * 0.55, -0.002];
    const upperLen = h('acromion') - h('elbow');
    const foreLen = h('elbow') - h('wrist');
    const at = (from: V3, t: number, dz = 0): V3 => [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t + dz];
    const elbow = at(sh, upperLen, 0.008);
    const wrist = at(elbow, foreLen, 0.022);
    const el = w('elbow_width') / 2,
      fa = w('forearm_width') / 2,
      wr = w('wrist_width') / 2;
    const hl = w('hand_length'),
      hw2 = w('hand_width') / 2,
      ht = w('hand_thickness') / 2;
    const AR = (c: V3, a: number, b: number): Ring => ({ c, a, b, n: dir });
    arms[side] = {
      // first arm ring sits at the underarm, just outside the ribcage: the quads from the armhole loop form the deltoid cap
      deltoid: AR([s * (cw * 0.95 + armR * 1.12), armpitY, -0.002], armR * 1.04, armR * 1.04), // flattened + lifted outward in positionsFromFrame
      bicep: AR(at(sh, upperLen * 0.33, 0.002), armR * 1.0, armR * 1.02),
      upper_mid: AR(at(sh, upperLen * 0.68, 0.004), armR * 0.9, armR * 0.93),
      elbow: AR(elbow, el, el * 1.05),
      fore_upper: AR(at(elbow, foreLen * 0.25, 0.006), fa * 1.04, fa * 1.04),
      fore_mid: AR(at(elbow, foreLen * 0.6, 0.012), fa * 0.86, fa * 0.88),
      wrist: AR(wrist, wr * 1.05, wr * 1.25),
      palm: AR(at(wrist, hl * 0.35, 0.006), ht * 1.05, hw2),
      knuckles: AR(at(wrist, hl * 0.62, 0.01), ht * 0.95, hw2 * 0.98),
      tips: AR(at(wrist, hl * 0.97, 0.014), ht * 0.45, hw2 * 0.55),
    };
    const th = w('thigh_width') / 2,
      kn = w('knee_width') / 2,
      ca = w('calf_width') / 2,
      an = w('ankle_width') / 2;
    // thighs: both must fit under the pelvis without touching → across-width capped at half the pelvis, depth compensates (same area)
    const thA = Math.min(th, (hw * 0.97) / 2 / 1.02);
    const thB = (th * th) / thA;
    const hipX = s * Math.max(thA * 1.02, hw * 0.97 - thA);
    const kneeX = hipX * 0.88;
    const ankleX = hipX * 0.84;
    const hipJ: V3 = [hipX, h('crotch') - 0.01, 0];
    const knee: V3 = [kneeX, h('knee'), 0.004];
    const ankle: V3 = [ankleX, h('ankle'), -0.012];
    const dThigh = nrm([kneeX - hipX, h('knee') - (h('crotch') - 0.01), 0]);
    const dShin = nrm([ankleX - kneeX, h('ankle') - h('knee'), 0]);
    const fl = w('foot_length'),
      fw = w('foot_width') / 2,
      fh = Math.min(w('foot_height'), h('ankle') * 0.95); // the instep ring must stay below the ankle ring
    const lerpX = (t: number) => hipX + (kneeX - hipX) * t;
    const lerpY = (t: number) => (crotchY - 0.035) + (h('knee') - (crotchY - 0.035)) * t;
    const shinX = (t: number) => kneeX + (ankleX - kneeX) * t;
    const shinY = (t: number) => h('knee') + (h('ankle') - h('knee')) * t;
    legs[side] = {
      thigh_top: { c: [hipX, crotchY - 0.02, 0.002], a: thA, b: thB * 1.02, n: dThigh },
      thigh_upper: { c: [lerpX(0.22), lerpY(0.22), 0.004], a: thA * 0.95, b: thB * 0.97, n: dThigh },
      thigh_mid: { c: [lerpX(0.58), lerpY(0.58), 0.006], a: Math.min(thA, th * 0.84), b: (th * 0.86 * th * 0.86) / Math.min(thA, th * 0.84), n: dThigh },
      above_knee: { c: [lerpX(0.86), lerpY(0.86), 0.005], a: kn * 1.05, b: kn * 1.12, n: dThigh },
      knee: { c: knee, a: kn, b: kn * 1.06, n: nrm([dThigh[0] + dShin[0], dThigh[1] + dShin[1], 0]) },
      below_knee: { c: [shinX(0.12), shinY(0.12), -0.004], a: kn * 0.92, b: kn * 0.96, n: dShin },
      // calf belly: thickest just below the knee, projecting backwards
      calf: { c: [shinX(0.3), shinY(0.3), -0.012], a: ca, b: ca * 1.12, n: dShin },
      lower_calf: { c: [shinX(0.62), shinY(0.62), -0.008], a: ca * 0.72, b: ca * 0.78, n: dShin },
      ankle: { c: ankle, a: an, b: an * 1.15, n: nrm([0, -1, 0.15]) },
      instep: { c: [ankleX, fh * 0.5, -0.02 * fl], a: fw * 0.95, b: fh * 0.38, n: nrm([0, -0.55, 0.84]) },
      ball: { c: [ankleX, fh * 0.32, 0.42 * fl], a: fw, b: fh * 0.3, n: nrm([0, -0.15, 0.99]) },
      toes: { c: [ankleX, fh * 0.2, 0.72 * fl], a: fw * 0.8, b: fh * 0.17, n: [0, 0, 1] },
    };
    joints[side] = { shoulder: sh, elbow, wrist, hip: hipJ, knee, ankle };
  }
  return { height: H, torso, arms, legs, heights, joints };
}

// ---------------------------------------------------------------------------
// positions
// ---------------------------------------------------------------------------
interface Frame {
  u: THREE.Vector3;
  w: THREE.Vector3;
}
/** Default frame of a ring: w ≈ +Z (front), u = w × n. */
function ringFrame(r: Ring): Frame {
  const n = new THREE.Vector3(...r.n).normalize();
  let w = new THREE.Vector3().crossVectors(n, new THREE.Vector3(1, 0, 0));
  if (w.lengthSq() < 1e-8) w.set(0, 0, 1);
  w.normalize();
  if (w.z < 0) w.negate();
  const u = new THREE.Vector3().crossVectors(w, n).normalize();
  return { u, w };
}
function ringPointF(r: Ring, f: Frame, theta: number): V3 {
  const c = Math.cos(theta),
    s = Math.sin(theta);
  const bulge = r.bulge && s > 0 ? r.bulge * Math.pow(s, 1.4) * Math.max(0, 1 - Math.abs(c) * 0.35) : 0;
  const p = new THREE.Vector3(...r.c).addScaledVector(f.u, r.a * c).addScaledVector(f.w, (r.b + bulge) * s);
  if (r.drop) p.y -= r.drop * Math.abs(c) * Math.abs(c);
  return [p.x, p.y, p.z];
}
function ringPoint(r: Ring, theta: number): V3 {
  return ringPointF(r, ringFrame(r), theta);
}
/**
 * Frames along a tube by parallel transport: the first ring uses its default frame, every next frame is the
 * previous one rotated by the minimal rotation n_prev → n_cur. No flips at bends (knee, ankle→foot) or when a
 * ring normal points the other way.
 */
function tubeFrames(rings: Ring[]): Frame[] {
  const out: Frame[] = [];
  let prev: Frame | null = null,
    prevN: THREE.Vector3 | null = null;
  for (const r of rings) {
    const n = new THREE.Vector3(...r.n).normalize();
    if (!prev || !prevN) {
      prev = ringFrame(r);
    } else {
      const q = new THREE.Quaternion().setFromUnitVectors(prevN, n);
      prev = { u: prev.u.clone().applyQuaternion(q).normalize(), w: prev.w.clone().applyQuaternion(q).normalize() };
    }
    prevN = n;
    out.push(prev);
  }
  return out;
}

/** θ of torso column c: front centre at col 0 (θ = π/2); u = −X so col 3.5 (θ = π) is +X = wearer's left. */
const colTheta = (c: number) => Math.PI / 2 + (2 * Math.PI * c) / M_T;

export function positionsFromFrame(F: BodyFrame): Float32Array {
  const T = topology();
  const P = new Float32Array(T.vertexCount * 3);
  const set = (i: number, p: V3) => {
    P[i * 3] = p[0];
    P[i * 3 + 1] = p[1];
    P[i * 3 + 2] = p[2];
  };
  TORSO_ROWS.forEach((name, r) => {
    const ring = F.torso[name];
    for (let c = 0; c < M_T; c++) set(T.grid(r, c), ringPoint(ring, colTheta(c)));
  });
  set(T.headCap, [0, F.height, F.torso.head_4.c[2] - 0.004]);
  for (const side of ['left', 'right'] as Side[]) {
    // arm: the armhole loop lies on the (near-vertical) torso side, so projecting it along the arm axis is
    // ill-defined; the loop ORDER is fixed instead: underarm → back → top → front (see armholeLoop), which in the
    // ring frame (θ = 0 is "up/outward" for the left arm, "down/inward" for the right) is π + m·π/4 / −m·π/4.
    const A = F.arms[side];
    // half-step offset: the two underarm loop vertices (cols 3/4 resp. 11/10) straddle the inner side of the arm
    const phi = Array.from({ length: M_L }, (_, m) => (side === 'left' ? Math.PI - Math.PI / 8 + (m * Math.PI) / 4 : Math.PI / 8 - (m * Math.PI) / 4));
    const armRingNames = ARM_RINGS.slice(1) as Exclude<ArmRing, 'armhole'>[];
    const armFrames = tubeFrames(armRingNames.map((rn) => A[rn]));
    armRingNames.forEach((rn, k) => {
      const ring = A[rn];
      for (let m = 0; m < M_L; m++) {
        const p = ringPointF(ring, armFrames[k]!, phi[m]!);
        if (k === 0) {
          // arm root: inner side stays at the underarm level (no dip into the torso), outer side rises over the
          // humeral head so the deltoid reads as a cap instead of a shelf
          const outward = ((p[0] - ring.c[0]) * (side === 'left' ? 1 : -1)) / ring.a; // −1 inner … +1 outer
          p[1] = ring.c[1] + Math.max(0, outward) * ring.a * 1.15;
        }
        set(T.arm(side, k + 1, m), p);
      }
    });
    const tips = A.tips;
    set(T.handCap[side], [tips.c[0] + tips.n[0] * 0.012, tips.c[1] + tips.n[1] * 0.012, tips.c[2] + tips.n[2] * 0.012]);
    // leg: the crotch half-loop (front centre → side → back centre) + chord maps to a full ring with the chord
    // on the inner side: left ring frame θ = 0 is outward, right θ = 0 is inward (u = w × n).
    const L = F.legs[side];
    const lphi = Array.from({ length: M_L }, (_, m) => (side === 'left' ? (3 * Math.PI) / 4 - (m * Math.PI) / 4 : Math.PI / 4 + (m * Math.PI) / 4));
    const legRingNames = LEG_RINGS.slice(1) as Exclude<LegRing, 'crotch_loop'>[];
    const legFrames = tubeFrames(legRingNames.map((rn) => L[rn]));
    legRingNames.forEach((rn, k) => {
      const ring = L[rn];
      for (let m = 0; m < M_L; m++) set(T.leg(side, k + 1, m), ringPointF(ring, legFrames[k]!, lphi[m]!));
    });
    const toes = L.toes;
    set(T.footCap[side], [toes.c[0], toes.c[1] - 0.004, toes.c[2] + 0.015]);
  }
  return P;
}

function signedVolumeOf(p: Float32Array, ia: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < ia.length; t += 3) {
    const a = ia[t]! * 3,
      b = ia[t + 1]! * 3,
      c = ia[t + 2]! * 3;
    v += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  return v;
}

export interface BodyMeshV2 {
  geometry: THREE.BufferGeometry;
  frame: BodyFrame;
  topology: Topology;
  stats: { vertices: number; triangles: number };
}

export function buildBodyMesh(P: Proportions): BodyMeshV2 {
  const frame = frameFromProportions(P);
  const T = topology();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positionsFromFrame(frame), 3));
  const index = T.index.slice();
  // global outward: the propagation makes winding consistent; the sign is fixed here once from the signed volume
  if (signedVolumeOf(geometry.attributes.position!.array as Float32Array, index) < 0)
    for (let t = 0; t < index.length; t += 3) {
      const tmp = index[t + 1]!;
      index[t + 1] = index[t + 2]!;
      index[t + 2] = tmp;
    }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(basicUV(T), 2));
  geometry.setAttribute('group', new THREE.BufferAttribute(T.group.slice(), 1));
  for (const g of T.triangleGroups) geometry.addGroup(g.start * 3, g.count * 3, GROUP_NAMES.indexOf(g.group));
  geometry.computeVertexNormals();
  return { geometry, frame, topology: T, stats: { vertices: T.vertexCount, triangles: T.index.length / 3 } };
}

/** Re-derive positions from a new frame (never accumulates). */
export function updateBodyMesh(mesh: BodyMeshV2, P: Proportions): BodyMeshV2 {
  mesh.frame = frameFromProportions(P);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  (pos.array as Float32Array).set(positionsFromFrame(mesh.frame));
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  return mesh;
}

/** Basic cylindrical UV per island (torso column, arm/leg ring index); good enough for a checker, not a production unwrap. */
function basicUV(T: Topology): Float32Array {
  const uv = new Float32Array(T.vertexCount * 2);
  const put = (i: number, u: number, v: number) => {
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  };
  const rows = TORSO_ROWS.length;
  for (let r = 0; r < rows; r++) for (let c = 0; c < M_T; c++) put(T.grid(r, c), 0.02 + (c / M_T) * 0.46, 0.05 + (r / (rows - 1)) * 0.9);
  put(T.headCap, 0.25, 0.98);
  for (const side of ['left', 'right'] as Side[]) {
    const u0 = side === 'left' ? 0.52 : 0.76;
    for (let ring = 1; ring < ARM_RINGS.length; ring++) for (let m = 0; m < M_L; m++) put(T.arm(side, ring, m), u0 + (m / M_L) * 0.22, 0.55 + (ring / ARM_RINGS.length) * 0.4);
    put(T.handCap[side], u0 + 0.11, 0.97);
    for (let ring = 1; ring < LEG_RINGS.length; ring++) for (let m = 0; m < M_L; m++) put(T.leg(side, ring, m), u0 + (m / M_L) * 0.22, 0.05 + (ring / LEG_RINGS.length) * 0.45);
    put(T.footCap[side], u0 + 0.11, 0.52);
  }
  return uv;
}

export { TORSO_ROWS, ARM_RINGS, LEG_RINGS, ROW, armholeLoop, legLoop };
