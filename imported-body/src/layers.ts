/**
 * Stage I-61 — geometry helpers for layered figures: one visible base (the reference's head, arms and shoes)
 * with garments laid OVER a hidden body instead of a body rebuilt for every outfit.
 *
 *   • windingNumber — inside/outside of a (possibly not perfectly closed) triangle soup, robust where shells
 *     overlap (the generalised winding number sums solid angles; > 0.5 means inside);
 *   • countIntersections — triangles of one mesh crossed by edges of another and vice versa (Möller–Trumbore),
 *     with a uniform grid so a few thousand triangles stay fast.
 */
export type Vec = Float64Array | number[];
export interface Soup { p: Vec; tris: number[] }

const FOUR_PI = 4 * Math.PI;

export function bboxOf(s: Soup): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of new Set(s.tris)) for (let k = 0; k < 3; k++) {
    b[k] = Math.min(b[k]!, s.p[v * 3 + k]!); b[k + 3] = Math.max(b[k + 3]!, s.p[v * 3 + k]!);
  }
  return b;
}

/** |generalised winding number| of point (x,y,z) with respect to the soup; ~1 inside a closed shell, ~0 outside */
export function windingNumber(s: Soup, x: number, y: number, z: number, bb?: number[]): number {
  if (bb && (x < bb[0]! || y < bb[1]! || z < bb[2]! || x > bb[3]! || y > bb[4]! || z > bb[5]!)) return 0;
  const p = s.p;
  let w = 0;
  for (let t = 0; t < s.tris.length; t += 3) {
    const a = s.tris[t]! * 3, b = s.tris[t + 1]! * 3, c = s.tris[t + 2]! * 3;
    const ax = p[a]! - x, ay = p[a + 1]! - y, az = p[a + 2]! - z;
    const bx = p[b]! - x, by = p[b + 1]! - y, bz = p[b + 2]! - z;
    const cx = p[c]! - x, cy = p[c + 1]! - y, cz = p[c + 2]! - z;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
    w += 2 * Math.atan2(det, den);
  }
  return Math.abs(w / FOUR_PI);
}

/** area-weighted vertex normals, oriented outward per connected shell (by the sign of its enclosed volume) */
export function vertexNormals(p: Vec, tris: number[], n: number): Float64Array {
  const nn = new Float64Array(n * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]! * 3, b = tris[t + 1]! * 3, c = tris[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nn[v] += fx; nn[v + 1] += fy; nn[v + 2] += fz; }
  }
  // shells and the sign of their volume
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let t = 0; t < tris.length; t += 3) { parent[find(tris[t]!)] = find(tris[t + 1]!); parent[find(tris[t + 1]!)] = find(tris[t + 2]!); }
  const vol = new Map<number, number>();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]! * 3, b = tris[t + 1]! * 3, c = tris[t + 2]! * 3;
    const v6 = p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
    const r = find(tris[t]!);
    vol.set(r, (vol.get(r) ?? 0) + v6);
  }
  for (let i = 0; i < n; i++) {
    const s = (vol.get(find(i)) ?? 1) < 0 ? -1 : 1;
    const l = Math.hypot(nn[i * 3]!, nn[i * 3 + 1]!, nn[i * 3 + 2]!) || 1;
    for (let k = 0; k < 3; k++) nn[i * 3 + k] = (s * nn[i * 3 + k]!) / l;
  }
  return nn;
}

function segTri(p: Vec, o: number[], d: number[], a: number, b: number, c: number): boolean {
  const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
  const e2x = p[c]! - p[a]!, e2y = p[c + 1]! - p[a + 1]!, e2z = p[c + 2]! - p[a + 2]!;
  const hx = d[1]! * e2z - d[2]! * e2y, hy = d[2]! * e2x - d[0]! * e2z, hz = d[0]! * e2y - d[1]! * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-14) return false;
  const f = 1 / det;
  const sx = o[0]! - p[a]!, sy = o[1]! - p[a + 1]!, sz = o[2]! - p[a + 2]!;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (d[0]! * qx + d[1]! * qy + d[2]! * qz);
  if (v < 0 || u + v > 1) return false;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-9 && t < 1 - 1e-9;
}

const CELL = 0.03;
function grid(s: Soup) {
  const g = new Map<string, number[]>();
  for (let t = 0; t < s.tris.length; t += 3) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) { const q = s.p[s.tris[t + k]! * 3 + j]!; lo[j] = Math.min(lo[j]!, q); hi[j] = Math.max(hi[j]!, q); }
    for (let x = Math.floor(lo[0]! / CELL); x <= Math.floor(hi[0]! / CELL); x++)
      for (let y = Math.floor(lo[1]! / CELL); y <= Math.floor(hi[1]! / CELL); y++)
        for (let z = Math.floor(lo[2]! / CELL); z <= Math.floor(hi[2]! / CELL); z++) {
          const key = `${x},${y},${z}`;
          let l = g.get(key); if (!l) g.set(key, (l = [])); l.push(t);
        }
  }
  return g;
}

function edgesOf(tris: number[]): [number, number][] {
  const seen = new Set<string>(), out: [number, number][] = [];
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k]!, b = tris[t + (k + 1) % 3]!;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!seen.has(key)) { seen.add(key); out.push([a, b]); }
  }
  return out;
}

/** edges of A crossing triangles of B; returns the A-vertices on those edges and the B-triangles hit */
function edgeHits(A: Soup, B: Soup, gB: Map<string, number[]>) {
  const aVerts = new Set<number>(), bTris = new Set<number>();
  for (const [i, j] of edgesOf(A.tris)) {
    const o = [A.p[i * 3]!, A.p[i * 3 + 1]!, A.p[i * 3 + 2]!];
    const d = [A.p[j * 3]! - o[0]!, A.p[j * 3 + 1]! - o[1]!, A.p[j * 3 + 2]! - o[2]!];
    const cand = new Set<number>();
    for (let x = Math.floor(Math.min(o[0]!, o[0]! + d[0]!) / CELL); x <= Math.floor(Math.max(o[0]!, o[0]! + d[0]!) / CELL); x++)
      for (let y = Math.floor(Math.min(o[1]!, o[1]! + d[1]!) / CELL); y <= Math.floor(Math.max(o[1]!, o[1]! + d[1]!) / CELL); y++)
        for (let z = Math.floor(Math.min(o[2]!, o[2]! + d[2]!) / CELL); z <= Math.floor(Math.max(o[2]!, o[2]! + d[2]!) / CELL); z++)
          for (const t of gB.get(`${x},${y},${z}`) ?? []) cand.add(t);
    for (const t of cand) if (segTri(B.p, o, d, B.tris[t]! * 3, B.tris[t + 1]! * 3, B.tris[t + 2]! * 3)) { aVerts.add(i); aVerts.add(j); bTris.add(t); }
  }
  return { aVerts, bTris };
}

/**
 * Pairs of crossing surfaces between A and B. Returns the A-vertices involved (on A's crossing edges and on the
 * A-triangles crossed by B's edges) and a count of crossing triangles on each side.
 */
export function countIntersections(A: Soup, B: Soup) {
  const ab = edgeHits(A, B, grid(B));
  const ba = edgeHits(B, A, grid(A));
  const aVerts = new Set(ab.aVerts);
  for (const t of ba.bTris) for (let k = 0; k < 3; k++) aVerts.add(A.tris[t + k]!);
  return { aVerts, aTris: ba.bTris.size, bTris: ab.bTris.size, crossings: ab.bTris.size + ba.bTris.size };
}

/** closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5) */
function closestOnTri(p: number[], a: number[], b: number[], c: number[]): number[] {
  const sub = (u: number[], v: number[]) => [u[0]! - v[0]!, u[1]! - v[1]!, u[2]! - v[2]!];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b); const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0]! + v * ab[0]!, a[1]! + v * ab[1]!, a[2]! + v * ab[2]!]; }
  const cp = sub(p, c); const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0]! + w * ac[0]!, a[1]! + w * ac[1]!, a[2]! + w * ac[2]!]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [b[0]! + w * (c[0]! - b[0]!), b[1]! + w * (c[1]! - b[1]!), b[2]! + w * (c[2]! - b[2]!)]; }
  const den = 1 / (va + vb + vc); const v = vb * den, w = vc * den;
  return [a[0]! + ab[0]! * v + ac[0]! * w, a[1]! + ab[1]! * v + ac[1]! * w, a[2]! + ab[2]! * v + ac[2]! * w];
}

/** closest point of the soup's surface to (x, y, z) */
export function closestPoint(s: Soup, x: number, y: number, z: number): number[] {
  const p = [x, y, z];
  let best: number[] = p, bd = Infinity;
  const P = (i: number) => [s.p[i * 3]!, s.p[i * 3 + 1]!, s.p[i * 3 + 2]!];
  for (let t = 0; t < s.tris.length; t += 3) {
    const q = closestOnTri(p, P(s.tris[t]!), P(s.tris[t + 1]!), P(s.tris[t + 2]!));
    const d = (q[0]! - x) ** 2 + (q[1]! - y) ** 2 + (q[2]! - z) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
