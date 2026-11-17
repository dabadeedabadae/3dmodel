/**
 * Stage I-10 — cloth solver (XPBD) for an imported garment.
 *
 * This is a position-based mass–spring solve, not a textile simulation: it gives hang, folds, stretch and
 * contact with the body, and it does NOT model shear stiffness per material, anisotropy, seams or real fabric
 * behaviour. Anything it produces is "как легло в симуляции", never "так сядет вещь".
 *
 * Constraints, all built from the garment's own mesh:
 *  • distance   — every unique edge, compliance = stretchiness (0 = inextensible)
 *  • bending    — the two opposite vertices of each pair of triangles sharing an edge, soft
 *  • collision  — against the body colliders, with friction applied to the tangential motion
 * Integration is Verlet with substeps; positions are always re-derived from the previous state, never
 * accumulated onto a stale buffer.
 */
import { type BodyColliders, resolvePoint } from './collider';

export interface ClothParams {
  /** metres per second²; negative y */
  gravity: number;
  /** XPBD compliance for stretch: 0 = inextensible, 1e-6 … 1e-4 = jersey-like */
  stretchCompliance: number;
  bendCompliance: number;
  /** velocity kept per second (air drag) */
  damping: number;
  /** tangential velocity kept on contact (0 = sticks, 1 = frictionless) */
  friction: number;
  /** fabric standoff from the body surface, metres */
  thickness: number;
  substeps: number;
  iterations: number;
}
export const DEFAULT_CLOTH: ClothParams = {
  gravity: -9.81,
  stretchCompliance: 2e-6,
  bendCompliance: 5e-3,
  damping: 0.02,
  friction: 0.35,
  thickness: 0.004,
  substeps: 4,
  iterations: 3,
};

export interface ClothModel {
  /** per-vertex normals, refreshed each frame: tells the collider which wall of a thick garment a vertex is on */
  normals: Float32Array | null;
  pos: Float32Array;
  prev: Float32Array;
  invMass: Float32Array;
  /** pairs of vertex ids + rest length */
  edges: Uint32Array;
  rest: Float32Array;
  bend: Uint32Array;
  bendRest: Float32Array;
  count: number;
  index: Uint32Array;
}

/** builds the constraint sets once; the topology never changes afterwards */
export function buildCloth(positions: Float32Array, index: Uint32Array): ClothModel {
  const n = positions.length / 3;
  const seen = new Map<number, number>();
  const e: number[] = [];
  // opposite vertices per shared edge → bending pairs
  const byEdge = new Map<number, number[]>();
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < index.length / 3; t++) {
    const v = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
    for (let k = 0; k < 3; k++) {
      const a = v[k]!, b = v[(k + 1) % 3]!, o = v[(k + 2) % 3]!;
      const kk = key(a, b);
      if (!seen.has(kk)) { seen.set(kk, e.length / 2); e.push(a, b); }
      const l = byEdge.get(kk);
      if (l) l.push(o); else byEdge.set(kk, [o]);
    }
  }
  const edges = new Uint32Array(e);
  const rest = new Float32Array(edges.length / 2);
  const d = (a: number, b: number) => Math.hypot(positions[a * 3]! - positions[b * 3]!, positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!);
  for (let i = 0; i < rest.length; i++) rest[i] = d(edges[i * 2]!, edges[i * 2 + 1]!);
  const bendPairs: number[] = [];
  for (const opp of byEdge.values()) if (opp.length === 2) bendPairs.push(opp[0]!, opp[1]!);
  const bend = new Uint32Array(bendPairs);
  const bendRest = new Float32Array(bend.length / 2);
  for (let i = 0; i < bendRest.length; i++) bendRest[i] = d(bend[i * 2]!, bend[i * 2 + 1]!);
  return { pos: new Float32Array(positions), prev: new Float32Array(positions), invMass: new Float32Array(n).fill(1), edges, rest, bend, bendRest, count: n, normals: null, index };
}

/** one frame of dt seconds */
/** area-weighted vertex normals, used by the collider to tell the two walls of a thick garment apart */
export function updateNormals(m: ClothModel): void {
  if (!m.normals) m.normals = new Float32Array(m.count * 3);
  m.normals.fill(0);
  for (let t = 0; t < m.index.length / 3; t++) {
    const a = m.index[t * 3]! * 3, b = m.index[t * 3 + 1]! * 3, c = m.index[t * 3 + 2]! * 3;
    const ux = m.pos[b]! - m.pos[a]!, uy = m.pos[b + 1]! - m.pos[a + 1]!, uz = m.pos[b + 2]! - m.pos[a + 2]!;
    const vx = m.pos[c]! - m.pos[a]!, vy = m.pos[c + 1]! - m.pos[a + 1]!, vz = m.pos[c + 2]! - m.pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { m.normals[o] = m.normals[o]! + nx; m.normals[o + 1] = m.normals[o + 1]! + ny; m.normals[o + 2] = m.normals[o + 2]! + nz; }
  }
  for (let i = 0; i < m.count; i++) {
    const l = Math.hypot(m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!) || 1e-9;
    m.normals[i * 3] = m.normals[i * 3]! / l; m.normals[i * 3 + 1] = m.normals[i * 3 + 1]! / l; m.normals[i * 3 + 2] = m.normals[i * 3 + 2]! / l;
  }
}

export function stepCloth(m: ClothModel, colliders: BodyColliders, p: ClothParams, dt: number): void {
  updateNormals(m);
  const h = dt / p.substeps;
  const h2 = h * h;
  const n = m.count;
  const keep = Math.pow(1 - p.damping, h);
  for (let s = 0; s < p.substeps; s++) {
    // predict
    for (let i = 0; i < n; i++) {
      if (m.invMass[i] === 0) continue;
      const i3 = i * 3;
      const vx = (m.pos[i3]! - m.prev[i3]!) * keep;
      const vy = (m.pos[i3 + 1]! - m.prev[i3 + 1]!) * keep + p.gravity * h2;
      const vz = (m.pos[i3 + 2]! - m.prev[i3 + 2]!) * keep;
      m.prev[i3] = m.pos[i3]!; m.prev[i3 + 1] = m.pos[i3 + 1]!; m.prev[i3 + 2] = m.pos[i3 + 2]!;
      m.pos[i3] = m.pos[i3]! + vx; m.pos[i3 + 1] = m.pos[i3 + 1]! + vy; m.pos[i3 + 2] = m.pos[i3 + 2]! + vz;
    }
    for (let it = 0; it < p.iterations; it++) {
      solveDistance(m, m.edges, m.rest, p.stretchCompliance / h2);
      solveDistance(m, m.bend, m.bendRest, p.bendCompliance / h2);
    }
    // collision + friction: the tangential part of this substep's motion is damped on contact
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const bx = m.pos[i3]!, by = m.pos[i3 + 1]!, bz = m.pos[i3 + 2]!;
      // the colliders overlap (the shoulder capsule sits inside the torso stack), so one pass can push a point
      // out of one and into another; three passes settle that
      let hit = false;
      for (let k = 0; k < 4; k++) if (resolvePoint(colliders, m.pos, i, p.thickness, m.normals)) hit = true; else break;
      if (!hit) continue;
      const nx = m.pos[i3]! - bx, ny = m.pos[i3 + 1]! - by, nz = m.pos[i3 + 2]! - bz;
      const nl = Math.hypot(nx, ny, nz) || 1e-9;
      const ux = nx / nl, uy = ny / nl, uz = nz / nl;
      let tx = m.pos[i3]! - m.prev[i3]!, ty = m.pos[i3 + 1]! - m.prev[i3 + 1]!, tz = m.pos[i3 + 2]! - m.prev[i3 + 2]!;
      // The normal component is DROPPED, not kept: keeping it fed the push-out back in as velocity every
      // substep, and the garment slowly climbed the body with gravity switched off (hem rose 53 cm in 120
      // frames). Contact here is perfectly inelastic; only the tangential slide survives, damped by friction.
      const dn = tx * ux + ty * uy + tz * uz;
      tx -= ux * dn; ty -= uy * dn; tz -= uz * dn;
      m.prev[i3] = m.pos[i3]! - tx * p.friction;
      m.prev[i3 + 1] = m.pos[i3 + 1]! - ty * p.friction;
      m.prev[i3 + 2] = m.pos[i3 + 2]! - tz * p.friction;
    }
  }
}

function solveDistance(m: ClothModel, pairs: Uint32Array, rest: Float32Array, alpha: number): void {
  for (let c = 0; c < rest.length; c++) {
    const a = pairs[c * 2]!, b = pairs[c * 2 + 1]!;
    const wa = m.invMass[a]!, wb = m.invMass[b]!;
    const w = wa + wb;
    if (w === 0) continue;
    const a3 = a * 3, b3 = b * 3;
    const dx = m.pos[a3]! - m.pos[b3]!, dy = m.pos[a3 + 1]! - m.pos[b3 + 1]!, dz = m.pos[a3 + 2]! - m.pos[b3 + 2]!;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-9) continue;
    const lambda = (d - rest[c]!) / (w + alpha);
    const sx = (dx / d) * lambda, sy = (dy / d) * lambda, sz = (dz / d) * lambda;
    m.pos[a3] = m.pos[a3]! - sx * wa; m.pos[a3 + 1] = m.pos[a3 + 1]! - sy * wa; m.pos[a3 + 2] = m.pos[a3 + 2]! - sz * wa;
    m.pos[b3] = m.pos[b3]! + sx * wb; m.pos[b3 + 1] = m.pos[b3 + 1]! + sy * wb; m.pos[b3 + 2] = m.pos[b3 + 2]! + sz * wb;
  }
}

/**
 * Stretch against the rest shape. Percentages are only reported for edges longer than `minRest`: this garment
 * joins its outer and inner wall with edges under a millimetre, and a tenth of a millimetre of motion on one of
 * those reads as hundreds of per cent. Those readings sent me chasing a tear that was not there, so the report
 * now carries both the filtered percentage and the worst ABSOLUTE error in millimetres.
 */
export function stretchStats(m: ClothModel, minRest = 0.004): { mean: number; max: number; over10: number; maxAbs_mm: number; shortEdges: number } {
  let sum = 0, max = 0, over = 0, n = 0, maxAbs = 0, short = 0;
  for (let c = 0; c < m.rest.length; c++) {
    const a = m.edges[c * 2]!, b = m.edges[c * 2 + 1]!;
    const d = Math.hypot(m.pos[a * 3]! - m.pos[b * 3]!, m.pos[a * 3 + 1]! - m.pos[b * 3 + 1]!, m.pos[a * 3 + 2]! - m.pos[b * 3 + 2]!);
    const abs = Math.abs(d - m.rest[c]!);
    maxAbs = Math.max(maxAbs, abs);
    if (m.rest[c]! < minRest) { short++; continue; }
    const r = abs / m.rest[c]!;
    sum += r; max = Math.max(max, r); if (r > 0.1) over++; n++;
  }
  return { mean: (sum / (n || 1)) * 100, max: max * 100, over10: over, maxAbs_mm: maxAbs * 1000, shortEdges: short };
}
