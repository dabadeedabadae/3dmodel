// Moved from lowpoly-v2/src/blocking.ts on 2026-11-18 when lowpoly-v2 went to archive/ (I-45). Unchanged.
/**
 * Low-poly V2 — stage 03 blocking: SEPARATE volumes (allowed at this stage)
 * generated from config/proportions-female.json. Not the working mesh (stage 04).
 *
 * Space: metres, Y up, +Z face, +X wearer's left, origin on the floor (config/coordinates.json).
 * Every dimension is a fraction of stature H from the proportions file; nothing is hard-coded here
 * except the ring sampling. Volumes are "stacked ellipse rings" (a lathe with per-ring width/depth)
 * so the silhouette reads in front AND side views.
 */
import * as THREE from 'three';

export interface Proportions {
  version: string;
  height_m: number;
  heights_fraction_of_H: Record<string, number>;
  widths_fraction_of_H: Record<string, number>;
  angles_rad: Record<string, number>;
}

export interface Landmark {
  name: string;
  side?: 'left' | 'right';
  position: [number, number, number];
}

export interface Blocking {
  group: THREE.Group;
  landmarks: Landmark[];
  stats: { triangles: number; volumes: number };
  heights: Record<string, number>;
}

type V3 = [number, number, number];
export const RING_SEGMENTS = 8; // low-poly: 8 around every volume

/** ring k: centre, half-width (local u), half-depth (local w) */
interface Ring {
  c: V3;
  a: number;
  b: number;
}

/** Stacked-ring volume along an arbitrary axis; u ⟂ axis in the X-plane, w ≈ +Z. Closed with caps. */
function ringVolume(rings: Ring[], axisDir: V3, name: string, capScale = 0.4): THREE.Mesh {
  const d = new THREE.Vector3(...axisDir).normalize();
  let w = new THREE.Vector3().crossVectors(d, new THREE.Vector3(1, 0, 0));
  if (w.lengthSq() < 1e-8) w = new THREE.Vector3(0, 0, 1);
  w.normalize();
  if (w.z < 0) w.negate();
  const u = new THREE.Vector3().crossVectors(w, d).normalize();
  const pos: number[] = [];
  const idx: number[] = [];
  const M = RING_SEGMENTS;
  // rings start at the FRONT centre (θ = 90°) so the front/back have a centre edge (reference style)
  for (const r of rings) {
    for (let k = 0; k < M; k++) {
      const t = Math.PI / 2 + (2 * Math.PI * k) / M;
      const p = new THREE.Vector3(...r.c).addScaledVector(u, r.a * Math.cos(t)).addScaledVector(w, r.b * Math.sin(t));
      pos.push(p.x, p.y, p.z);
    }
  }
  const first = rings[0]!,
    last = rings[rings.length - 1]!;
  const cb = new THREE.Vector3(...first.c).addScaledVector(d, -Math.min(first.a, first.b) * capScale);
  const ct = new THREE.Vector3(...last.c).addScaledVector(d, Math.min(last.a, last.b) * capScale);
  const iCb = pos.length / 3;
  pos.push(cb.x, cb.y, cb.z);
  const iCt = pos.length / 3;
  pos.push(ct.x, ct.y, ct.z);
  for (let r = 0; r < rings.length - 1; r++)
    for (let k = 0; k < M; k++) {
      const a = r * M + k,
        b = r * M + ((k + 1) % M),
        c = (r + 1) * M + ((k + 1) % M),
        e = (r + 1) * M + k;
      idx.push(a, c, b, a, e, c);
    }
  for (let k = 0; k < M; k++) {
    idx.push(iCb, (k + 1) % M, k);
    const base = (rings.length - 1) * M;
    idx.push(iCt, base + k, base + ((k + 1) % M));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // orientation: make the signed volume positive (outward normals), whatever the axis direction
  if (signedVolume(g) < 0) {
    const ia = g.index!.array as Uint16Array | Uint32Array;
    for (let t = 0; t < ia.length; t += 3) {
      const tmp = ia[t + 1]!;
      ia[t + 1] = ia[t + 2]!;
      ia[t + 2] = tmp;
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#d9c2a7', flatShading: true, roughness: 0.85 }));
  m.name = name;
  return m;
}

export function signedVolume(g: THREE.BufferGeometry): number {
  const p = g.attributes.position!.array as ArrayLike<number>;
  const ia = g.index!.array as ArrayLike<number>;
  let v = 0;
  for (let t = 0; t < ia.length; t += 3) {
    const a = ia[t]! * 3,
      b = ia[t + 1]! * 3,
      c = ia[t + 2]! * 3;
    v += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  return v;
}

export function buildBlocking(P: Proportions): Blocking {
  const H = P.height_m;
  const h = (k: string) => P.heights_fraction_of_H[k]! * H;
  const w = (k: string) => P.widths_fraction_of_H[k]! * H;
  const group = new THREE.Group();
  group.name = 'lowpoly-v2-blocking';
  const landmarks: Landmark[] = [];
  const L = (name: string, p: V3, side?: 'left' | 'right') => landmarks.push(side ? { name, side, position: p } : { name, position: p });

  // ---- head (own volume, jaw → crown) ----
  const headH = h('head_top') - h('chin');
  const hw = w('head_width') / 2,
    hd = w('head_depth') / 2;
  const headRings: Ring[] = [
    [0.0, 0.55, 0.55, 0.012],
    [0.2, 0.88, 0.9, 0.0],
    [0.5, 1.0, 1.0, -0.004],
    [0.78, 0.92, 0.95, -0.008],
    [0.95, 0.55, 0.62, -0.012],
  ].map(([f, sw, sd, dz]) => ({ c: [0, h('chin') + f! * headH, -0.01 + dz!] as V3, a: hw * sw!, b: hd * sd! }));
  group.add(ringVolume(headRings, [0, 1, 0], 'head', 0.3));
  L('head_top', [0, h('head_top'), -0.01]);
  L('chin', [0, h('chin'), hd * 0.5]);

  // ---- neck ----
  const nr = w('neck_width') / 2;
  group.add(
    ringVolume(
      [
        { c: [0, h('neck_base') - 0.01, -0.008], a: nr * 1.1, b: nr * 1.05 },
        { c: [0, h('chin') + 0.005, -0.006], a: nr, b: nr },
      ],
      [0, 1, 0],
      'neck',
      0.2,
    ),
  );
  L('neck_base', [0, h('neck_base'), w('chest_depth') * 0.35]);

  // ---- torso: neck base → crotch (one volume, rings at the landmark levels) ----
  const sw = w('shoulder_width_acromions') / 2;
  const armR = w('upper_arm_width') / 2;
  const bust = w('bust_prominence');
  const torsoRings: Ring[] = [
    { c: [0, h('crotch') + 0.01, 0], a: w('hip_width') * 0.3, b: w('hip_depth') * 0.3 },
    { c: [0, h('hip'), 0], a: w('hip_width') / 2, b: w('hip_depth') / 2 },
    { c: [0, h('waist'), 0.005], a: w('waist_width') / 2, b: w('waist_depth') / 2 },
    { c: [0, h('chest') - 0.03, 0.01], a: (w('chest_width') / 2) * 0.96, b: w('chest_depth') / 2 + bust * 0.6 },
    { c: [0, h('chest'), 0.012], a: w('chest_width') / 2, b: w('chest_depth') / 2 + bust },
    { c: [0, h('armpit'), 0.0], a: w('chest_width') / 2, b: (w('chest_depth') / 2) * 0.98 },
    { c: [0, h('acromion') - armR * 0.6, -0.004], a: sw - armR * 0.1, b: (w('chest_depth') / 2) * 0.92 },
    { c: [0, h('acromion') + 0.005, -0.008], a: sw - armR * 0.6, b: (w('chest_depth') / 2) * 0.72 },
    { c: [0, h('neck_base'), -0.01], a: nr * 1.6, b: nr * 1.3 },
  ];
  group.add(ringVolume(torsoRings, [0, 1, 0], 'torso', 0.25));
  L('chest', [0, h('chest'), 0]);
  L('waist', [0, h('waist'), 0]);
  L('hip', [0, h('hip'), 0]);
  L('crotch', [0, h('crotch'), 0]);
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    L('acromion', [s * sw, h('acromion'), 0], side);
    L('armpit', [s * (w('chest_width') / 2), h('armpit'), 0], side);
  }

  // ---- arms (upper arm, forearm, hand as three volumes) ----
  const abd = P.angles_rad['arm_abduction']!;
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    const sh: V3 = [s * sw, h('acromion') - armR * 0.5, 0];
    const upperLen = h('acromion') - h('elbow');
    const foreLen = h('elbow') - h('wrist');
    const dir: V3 = [s * Math.sin(abd), -Math.cos(abd), 0];
    const at = (from: V3, len: number, zf = 0): V3 => [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len + zf];
    const elbow = at(sh, upperLen, P.angles_rad['elbow_forward']! * 0.1);
    const wrist = at(elbow, foreLen, 0.02);
    const ua = w('upper_arm_width') / 2,
      el = w('elbow_width') / 2,
      fa = w('forearm_width') / 2,
      wr = w('wrist_width') / 2;
    group.add(ringVolume([{ c: at(sh, -ua * 0.2), a: ua * 0.95, b: ua }, { c: at(sh, upperLen * 0.45), a: ua, b: ua * 1.02 }, { c: elbow, a: el, b: el * 1.05 }], dir, `upper_arm_${side}`, 0.9));
    group.add(ringVolume([{ c: elbow, a: el * 0.95, b: el }, { c: at(elbow, foreLen * 0.35, 0.007), a: fa, b: fa }, { c: wrist, a: wr, b: wr * 1.1 }], dir, `forearm_${side}`, 0.9));
    const hl = w('hand_length'),
      hw2 = w('hand_width') / 2,
      ht = w('hand_thickness') / 2;
    // palm faces the thigh: thin across X-ish (u), wide front-back (w)
    group.add(ringVolume([{ c: at(wrist, 0.0, 0.002), a: ht * 1.2, b: hw2 * 0.8 }, { c: at(wrist, hl * 0.45, 0.006), a: ht, b: hw2 }, { c: at(wrist, hl * 0.95, 0.01), a: ht * 0.5, b: hw2 * 0.6 }], dir, `hand_${side}`, 0.6));
    L('elbow', elbow, side);
    L('wrist', wrist, side);
  }

  // ---- legs (thigh, shin, foot) ----
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    const th = w('thigh_width') / 2,
      kn = w('knee_width') / 2,
      ca = w('calf_width') / 2,
      an = w('ankle_width') / 2;
    const hipX = s * (w('hip_width') / 2 - th);
    const kneeX = s * (w('hip_width') / 2 - th) * 0.85;
    const ankleX = s * (w('hip_width') / 2 - th) * 0.8;
    const thighTop: V3 = [hipX, h('hip') - 0.02, 0];
    const knee: V3 = [kneeX, h('knee'), 0.005];
    const ankle: V3 = [ankleX, h('ankle'), -0.01];
    group.add(
      ringVolume(
        [
          { c: thighTop, a: th, b: th * 1.05 },
          { c: [hipX * 0.95 + kneeX * 0.05, h('crotch') - 0.02, 0.003], a: th * 0.98, b: th * 1.05 },
          { c: [(hipX + kneeX) / 2, (h('crotch') + h('knee')) / 2, 0.006], a: th * 0.8, b: th * 0.85 },
          { c: knee, a: kn, b: kn * 1.05 },
        ],
        [kneeX - hipX, h('knee') - h('hip'), 0],
        `thigh_${side}`,
        0.9, // pointed caps hide inside the neighbouring volume (no flat "coin" at the knee)
      ),
    );
    group.add(
      ringVolume(
        [
          { c: knee, a: kn * 0.95, b: kn },
          { c: [(kneeX + ankleX) / 2, h('knee') - (h('knee') - h('ankle')) * 0.3, -0.012], a: ca, b: ca * 1.05 },
          { c: ankle, a: an, b: an * 1.1 },
        ],
        [ankleX - kneeX, h('ankle') - h('knee'), 0],
        `shin_${side}`,
        0.9,
      ),
    );
    const fl = w('foot_length'),
      fw = w('foot_width') / 2,
      fh = w('foot_height');
    group.add(
      ringVolume(
        [
          { c: [ankleX, fh * 0.45, -0.3 * fl], a: fw * 0.7, b: fh * 0.4 },
          { c: [ankleX, fh * 0.5, -0.05 * fl], a: fw, b: fh * 0.5 },
          { c: [ankleX, fh * 0.35, 0.45 * fl], a: fw, b: fh * 0.3 },
          { c: [ankleX, fh * 0.2, 0.7 * fl], a: fw * 0.8, b: fh * 0.18 },
        ],
        [0, 0, 1],
        `foot_${side}`,
        0.25,
      ),
    );
    L('knee', knee, side);
    L('ankle', ankle, side);
  }
  L('floor', [0, 0, 0]);

  let triangles = 0,
    volumes = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      volumes++;
      triangles += o.geometry.index!.count / 3;
    }
  });
  const heights: Record<string, number> = {};
  for (const k of Object.keys(P.heights_fraction_of_H)) heights[k] = h(k);
  return { group, landmarks, stats: { triangles, volumes }, heights };
}

/** Shoulder width as the plan defines it: distance between the paired acromion landmarks. */
export function shoulderWidth(landmarks: Landmark[]): number {
  const l = landmarks.find((x) => x.name === 'acromion' && x.side === 'left')!;
  const r = landmarks.find((x) => x.name === 'acromion' && x.side === 'right')!;
  return Math.hypot(l.position[0] - r.position[0], l.position[1] - r.position[1], l.position[2] - r.position[2]);
}
