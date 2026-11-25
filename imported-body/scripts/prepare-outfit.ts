/**
 * Dressed figure → FitCast asset, compatible with the same deformation, measurement and render code as the
 * naked mannequin.
 *   node --import tsx imported-body/scripts/prepare-outfit.ts imported-body/assets/outfit-01.fbx outfit01 [heightCm]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sliceContours } from '../src/geom/measure';
import { labelParts, type OutfitLandmarks, type Part } from '../src/outfit';

const file = process.argv[2]!;
const id = process.argv[3] ?? 'outfit';
const heightCm = Number(process.argv[4] ?? 175);
/** A generated FBX, or a mesh already composed onto the reference body (I-50: { base, index } JSON). */
function loadGeometry(path: string): THREE.BufferGeometry {
  if (path.endsWith('.json')) {
    const j = JSON.parse(readFileSync(path, 'utf8')) as { base: number[]; index: number[]; fixed?: number[]; inner?: number[]; upper?: number[] };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(j.base, 3));
    // marks the reference body's vertices; survives the weld because it is a vertex attribute
    const fx = new Float32Array(j.base.length / 3);
    for (const v of j.fixed ?? []) fx[v] = 1;
    geo.setAttribute('fixed', new THREE.Float32BufferAttribute(fx, 1));
    // the base's T-shirt kept as the inner layer (layer-outfit IB_INNER): labelled 'inner' after segmentation
    if (j.inner) {
      const inn = new Float32Array(j.base.length / 3);
      for (const v of j.inner) inn[v] = 1;
      geo.setAttribute('inner', new THREE.Float32BufferAttribute(inn, 1));
    }
    // the upper garment's vertices (layer-outfit, garment-only top): its shells are 'top' whatever their height
    if (j.upper) {
      const up = new Float32Array(j.base.length / 3);
      for (const v of j.upper) up[v] = 1;
      geo.setAttribute('upper', new THREE.Float32BufferAttribute(up, 1));
    }
    geo.setIndex(j.index);
    return geo;
  }
  const buf = readFileSync(path);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  if (meshes.length === 1) return meshes[0]!.geometry.clone().applyMatrix4(meshes[0]!.matrixWorld);
  // a figure exported as separate parts (head, top, sleeves, arms, trousers, shoes): every part is kept, and the
  // 'part' attribute stops the weld from joining parts along their shared cut, so each stays its own shell
  const geos = meshes.map((m, k) => {
    const gm = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', gm.attributes.position!.clone());
    out.applyMatrix4(m.matrixWorld);
    out.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position!.count).fill(k), 1));
    return out;
  });
  return mergeGeometries(geos)!;
}
let g = loadGeometry(file);
/** the input came as separate meshes (head, top, arms…): see labelParts */
const fromParts = g.hasAttribute('part');
g.deleteAttribute('normal');
if (g.hasAttribute('uv')) g.deleteAttribute('uv');
const before = g.attributes.position!.count;
/** vertices of undirected edges shared by more than two triangles */
function nonManifoldVertices(idx: ArrayLike<number>): Set<number> {
  const count = new Map<string, number>();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k]!, b = idx[t + ((k + 1) % 3)]!;
    if (a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const out = new Set<number>();
  for (const [key, c] of count) if (c > 2) for (const s of key.split('_')) out.add(Number(s));
  return out;
}
/**
 * Weld guard. A mesh laid over the reference (layer-outfit) is already indexed and manifold; there the distance weld
 * can only zip two different sheets that happen to touch. On the V-neck sweater (outfit05) the relaxation squashed a
 * thin strip at the neckline until two non-adjacent vertices with a common neighbour coincided; welding them put four
 * triangles on one edge and check-outfit failed on the base pose. Such merges are refused: the vertices at a new
 * non-manifold edge get their own weld group (mergeVertices hashes every attribute) and the weld is repeated. Every
 * other merge is the same as before; an FBX (unindexed) input is welded exactly as before.
 */
let welded = mergeVertices(g, 1e-5);
let weldRefused = 0;
if (g.index && nonManifoldVertices(g.index.array as ArrayLike<number>).size === 0) {
  const op = g.attributes.position!.array as ArrayLike<number>;
  const key = (p: ArrayLike<number>, v: number) => `${~~(p[v * 3]! * 1e5)},${~~(p[v * 3 + 1]! * 1e5)},${~~(p[v * 3 + 2]! * 1e5)}`;
  const group = new Float32Array(before);
  for (let round = 0; round < 5; round++) {
    const bad = nonManifoldVertices(welded.index!.array as ArrayLike<number>);
    if (!bad.size) break;
    const wp = welded.attributes.position!.array as ArrayLike<number>;
    const keys = new Set([...bad].map((v) => key(wp, v)));
    for (let i = 0; i < before; i++) if (group[i] === 0 && keys.has(key(op, i))) { group[i] = i + 1; weldRefused++; }
    g.setAttribute('weldGroup', new THREE.Float32BufferAttribute(group, 1));
    welded = mergeVertices(g, 1e-5);
  }
  if (welded.hasAttribute('weldGroup')) welded.deleteAttribute('weldGroup');
}
g = welded;
const pos = g.attributes.position!.array as Float32Array;
let index = g.index!.array as Uint32Array;
const n = pos.length / 3;
/**
 * On a mesh composed onto the reference body (I-50), the reference head and hands are marked and left out of
 * symmetrisation, both as vertices to move and as partners: pairing them with the collar moved neck and jaw
 * vertices of the inserted head by up to 16 mm, and the heads stopped being identical. The clothes are still
 * symmetrised.
 */
const fixed = (g.getAttribute('fixed')?.array as Float32Array | undefined) ?? new Float32Array(n);

/**
 * 1. Symmetrise. A generated figure is never symmetric — this one matched only 63 % of its vertices against
 * its own mirror — and a crooked collar or a shifted hem is visible in a render. Each vertex is averaged with
 * the nearest vertex of the mirrored cloud, over two passes with a widening search, and whatever asymmetry is
 * left is reported in millimetres rather than hidden.
 */
let snapped = 0, paired = 0;
const mirrorPass = (tol: number) => {
  const src = new Float32Array(pos);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    if (fixed[i]) continue;
    const x = src[i * 3]!, y = src[i * 3 + 1]!, z = src[i * 3 + 2]!;
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (fixed[j]) continue;
      const d = (src[j * 3]! + x) ** 2 + (src[j * 3 + 1]! - y) ** 2 + (src[j * 3 + 2]! - z) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0 && Math.sqrt(bd) < tol) {
      pos[i * 3] = (x - src[best * 3]!) / 2;
      pos[i * 3 + 1] = (y + src[best * 3 + 1]!) / 2;
      pos[i * 3 + 2] = (z + src[best * 3 + 2]!) / 2;
      hit++;
    }
  }
  return hit;
};
paired = mirrorPass(0.03);
paired = Math.max(paired, mirrorPass(0.012));
for (let i = 0; i < n; i++) if (Math.abs(pos[i * 3]!) < 1e-4) { pos[i * 3] = 0; snapped++; }
/**
 * 1b. Symmetrise the SURFACE (I-73). The vertex pass above only moves a vertex that has a mirror partner within
 * 3 cm; a generated mesh is not mirror-topological, so the rest kept their asymmetry: the base trousers stayed up
 * to 3 cm wider on one leg, and every garment-only figure inherits that base. Here each free vertex is pulled
 * halfway to the nearest point of the mirrored surface of its own shell (connected piece), over a few rounds, so
 * the shape becomes symmetric whatever the triangulation. Guards: the partner must face the same way (normals),
 * be within IB_SURF_TOL (default 2 cm, so a wrap-over front or an open collar is not folded onto the other side),
 * and vertices within IB_SURF_BAND of the centre line (default 3 cm) are left alone — a closure overlaps there.
 */
// tolerances are in metres of the 175 cm figure; a raw generated mesh is in its own units (outfit-01: 0.99 tall)
let unit = 1;
{
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, pos[i * 3 + 1]!); y1 = Math.max(y1, pos[i * 3 + 1]!); }
  unit = (y1 - y0) / (heightCm / 100);
}
const SURF_TOL = Number(process.env.IB_SURF_TOL ?? 0.02) * unit;
const SURF_BAND = Number(process.env.IB_SURF_BAND ?? 0.03) * unit;
const SURF_ROUNDS = Number(process.env.IB_SURF_ROUNDS ?? 4);
// only vertices below this share of the height (IB_SURF_YMAX; 1 = all). The base figure uses 0.5: its trousers
// were the crooked part, and moving its torso cut the chest slider at the all-sliders corner from ±0.72 to ±0.19
const SURF_YMAX = Number(process.env.IB_SURF_YMAX ?? 1);
let surfY0 = Infinity, surfY1 = -Infinity;
for (let i = 0; i < n; i++) { surfY0 = Math.min(surfY0, pos[i * 3 + 1]!); surfY1 = Math.max(surfY1, pos[i * 3 + 1]!); }
const surfYLimit = surfY0 + SURF_YMAX * (surfY1 - surfY0);
let surfMoved = 0;
if (SURF_ROUNDS > 0) {
  // shells by union-find over the triangles
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(index[t]!), b = find(index[t + 1]!), c = find(index[t + 2]!);
    parent[b] = a; parent[find(c)] = a;
  }
  const shell = new Int32Array(n); for (let i = 0; i < n; i++) shell[i] = find(i);
  const nT = index.length / 3;
  const cell = SURF_TOL;
  // closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5)
  const closest = (px: number, py: number, pz: number, a: number[], b: number[], c: number[]): [number, number, number] => {
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const ap = [px - a[0]!, py - a[1]!, pz - a[2]!];
    const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return [a[0]!, a[1]!, a[2]!];
    const bp = [px - b[0]!, py - b[1]!, pz - b[2]!], d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return [b[0]!, b[1]!, b[2]!];
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0]! + v * ab[0]!, a[1]! + v * ab[1]!, a[2]! + v * ab[2]!]; }
    const cp = [px - c[0]!, py - c[1]!, pz - c[2]!], d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return [c[0]!, c[1]!, c[2]!];
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0]! + w * ac[0]!, a[1]! + w * ac[1]!, a[2]! + w * ac[2]!]; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [b[0]! + w * (c[0]! - b[0]!), b[1]! + w * (c[1]! - b[1]!), b[2]! + w * (c[2]! - b[2]!)]; }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return [a[0]! + ab[0]! * v + ac[0]! * w, a[1]! + ab[1]! * v + ac[1]! * w, a[2]! + ab[2]! * v + ac[2]! * w];
  };
  const moved = new Uint8Array(n);
  // triangles around each vertex: a move that flattens or turns one of them is refused (side-seam slivers flipped
  // at the all-sliders corner and cut the chest slider from ±0.72 to ±0.19)
  const around: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) around[index[t * 3 + e]!]!.push(t);
  const triN = (t: number) => {
    const a = index[t * 3]! * 3, b = index[t * 3 + 1]! * 3, c = index[t * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const wx = pos[c]! - pos[a]!, wy = pos[c + 1]! - pos[a + 1]!, wz = pos[c + 2]! - pos[a + 2]!;
    return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx] as const;
  };
  const before0 = Array.from({ length: nT }, (_, t) => triN(t));
  for (let round = 0; round < SURF_ROUNDS; round++) {
    const src = new Float32Array(pos);
    // vertex normals of the current shape
    const vn = new Float32Array(n * 3), fnrm = new Float32Array(nT * 3);
    for (let t = 0; t < nT; t++) {
      const a = index[t * 3]! * 3, b = index[t * 3 + 1]! * 3, c = index[t * 3 + 2]! * 3;
      const ux = src[b]! - src[a]!, uy = src[b + 1]! - src[a + 1]!, uz = src[b + 2]! - src[a + 2]!;
      const wx = src[c]! - src[a]!, wy = src[c + 1]! - src[a + 1]!, wz = src[c + 2]! - src[a + 2]!;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
      fnrm[t * 3] = nx / l; fnrm[t * 3 + 1] = ny / l; fnrm[t * 3 + 2] = nz / l;
      for (const v of [a, b, c]) { vn[v] += nx; vn[v + 1] += ny; vn[v + 2] += nz; }
    }
    // grid of MIRRORED triangles (x → −x; the mirrored normal is (−nx, ny, nz))
    const grid = new Map<string, number[]>();
    for (let t = 0; t < nT; t++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let e = 0; e < 3; e++) { const v = index[t * 3 + e]! * 3; const x = -src[v]!, y = src[v + 1]!, z = src[v + 2]!; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) {
        const k = `${gx},${gy},${gz}`; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(t);
      }
    }
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      const px = src[i * 3]!, py = src[i * 3 + 1]!, pz = src[i * 3 + 2]!;
      if (Math.abs(px) < SURF_BAND || py > surfYLimit) continue;
      const nl = Math.hypot(vn[i * 3]!, vn[i * 3 + 1]!, vn[i * 3 + 2]!) || 1;
      const nx = vn[i * 3]! / nl, ny = vn[i * 3 + 1]! / nl, nz = vn[i * 3 + 2]! / nl;
      let bd = SURF_TOL * SURF_TOL, best: [number, number, number] | null = null;
      const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
      const seen = new Set<number>();
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (const t of grid.get(`${gx},${gy},${gz}`) ?? []) {
          if (seen.has(t)) continue; seen.add(t);
          const a0 = index[t * 3]!, b0 = index[t * 3 + 1]!, c0 = index[t * 3 + 2]!;
          if (shell[a0] !== shell[i]) continue;
          if (a0 === i || b0 === i || c0 === i) continue;
          // the mirrored face must face the same way as this vertex
          if (-fnrm[t * 3]! * nx + fnrm[t * 3 + 1]! * ny + fnrm[t * 3 + 2]! * nz < 0.5) continue;
          const A = [-src[a0 * 3]!, src[a0 * 3 + 1]!, src[a0 * 3 + 2]!], B = [-src[b0 * 3]!, src[b0 * 3 + 1]!, src[b0 * 3 + 2]!], C = [-src[c0 * 3]!, src[c0 * 3 + 1]!, src[c0 * 3 + 2]!];
          const q = closest(px, py, pz, A, B, C);
          const d = (q[0] - px) ** 2 + (q[1] - py) ** 2 + (q[2] - pz) ** 2;
          if (d < bd) { bd = d; best = q; }
        }
      }
      if (!best) continue;
      const ox = pos[i * 3]!, oy = pos[i * 3 + 1]!, oz = pos[i * 3 + 2]!;
      pos[i * 3] = (px + best[0]) / 2; pos[i * 3 + 1] = (py + best[1]) / 2; pos[i * 3 + 2] = (pz + best[2]) / 2;
      // compared with the ORIGINAL triangles, so small steps cannot add up to a fold
      const ok = around[i]!.every((t) => {
        const A = before0[t]!, B = triN(t), la = Math.hypot(...A), lb = Math.hypot(...B);
        if (la < 1e-14) return true;
        return lb >= 0.5 * la && (A[0] * B[0] + A[1] * B[1] + A[2] * B[2]) / (la * lb) > 0.8;
      });
      if (!ok) { pos[i * 3] = ox; pos[i * 3 + 1] = oy; pos[i * 3 + 2] = oz; continue; }
      moved[i] = 1;
    }
  }
  for (let i = 0; i < n; i++) surfMoved += moved[i]!;
}
/**
 * Faces the symmetrisation folded into a line (I-70, coat: two slivers at the back at 117 cm — three vertices of a
 * vertical seam each averaged with the same mirror partner, so they share x and z) have no area and no normal;
 * check-outfit blocks on them. They are dropped and counted in the report.
 */
let zeroAreaDropped = 0;
{
  const keep: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-10) { zeroAreaDropped++; continue; }
    keep.push(index[t]!, index[t + 1]!, index[t + 2]!);
  }
  if (zeroAreaDropped) index = Uint32Array.from(keep);
}
/**
 * An edge shared by three faces (I-70, new coat: the point where the lapels meet, 0.8 mm edges at 130 cm, a fold of
 * the generated mesh) is non-manifold and blocks check-outfit. The smallest of those faces is dropped until two are
 * left; counted in the report.
 */
let nonManifoldDropped = 0;
for (let round = 0; round < 5; round++) {
  const area = (t: number) => {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  const edges = new Map<string, number[]>();
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = index[t + e]!, b = index[t + (e + 1) % 3]!, k = a < b ? `${a},${b}` : `${b},${a}`;
    let f = edges.get(k); if (!f) edges.set(k, (f = [])); f.push(t);
  }
  const drop = new Set<number>();
  for (const f of edges.values()) if (f.length > 2) {
    const live = f.filter((t) => !drop.has(t)).sort((x, y) => area(x) - area(y));
    for (let i = 0; i < live.length - 2; i++) drop.add(live[i]!);
  }
  if (!drop.size) break;
  const keep: number[] = [];
  for (let t = 0; t < index.length; t += 3) if (!drop.has(t)) keep.push(index[t]!, index[t + 1]!, index[t + 2]!);
  index = Uint32Array.from(keep);
  nonManifoldDropped += drop.size;
}
/**
 * Faces wound against their neighbours (the same lapel fold): a face that disagrees with most of its neighbours is
 * turned over; if each disagreement is one against one, the smaller face of the pair is. Counted in the report.
 */
let windingFixed = 0;
for (let round = 0; round < 10; round++) {
  const dir = new Map<string, number[]>();
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = index[t + e]!, b = index[t + (e + 1) % 3]!, k = `${a},${b}`;
    let f = dir.get(k); if (!f) dir.set(k, (f = [])); f.push(t);
  }
  const conflicts = new Map<number, number>(), pairs: [number, number][] = [];
  for (const f of dir.values()) if (f.length > 1) for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) {
    conflicts.set(f[i]!, (conflicts.get(f[i]!) ?? 0) + 1); conflicts.set(f[j]!, (conflicts.get(f[j]!) ?? 0) + 1); pairs.push([f[i]!, f[j]!]);
  }
  if (!pairs.length) break;
  const area = (t: number) => {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  let flip = [...conflicts].filter(([, c]) => c >= 2).map(([t]) => t);
  if (!flip.length) flip = [...new Set(pairs.map(([x, y]) => (area(x) < area(y) ? x : y)))];
  for (const t of flip) { const b = index[t + 1]!; index[t + 1] = index[t + 2]!; index[t + 2] = b; windingFixed++; }
}
/**
 * What the turning cannot settle (I-73, sweatshirt: two twists of the generated mesh, at the front hem and under the
 * left arm, where turning one face makes its neighbour disagree, round after round) is dropped: of each pair of faces
 * still sharing an edge in the same direction, the smaller one. Counted in the report.
 */
let windingDropped = 0;
for (let round = 0; round < 5; round++) {
  const dir = new Map<string, number[]>();
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = `${index[t + e]!},${index[t + (e + 1) % 3]!}`;
    let f = dir.get(k); if (!f) dir.set(k, (f = [])); f.push(t);
  }
  const area = (t: number) => {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  const drop = new Set<number>();
  for (const f of dir.values()) if (f.length > 1) {
    const live = f.filter((t) => !drop.has(t)).sort((x, y) => area(x) - area(y));
    for (let i = 0; i < live.length - 1; i++) drop.add(live[i]!);
  }
  if (!drop.size) break;
  const keep: number[] = [];
  for (let t = 0; t < index.length; t += 3) if (!drop.has(t)) keep.push(index[t]!, index[t + 1]!, index[t + 2]!);
  index = Uint32Array.from(keep);
  windingDropped += drop.size;
}
// residual asymmetry, in millimetres of the normalised figure
let asymMax = 0, asymSum = 0;
for (let i = 0; i < n; i++) {
  let bd = Infinity;
  for (let j = 0; j < n; j++) {
    const d = (pos[j * 3]! + pos[i * 3]!) ** 2 + (pos[j * 3 + 1]! - pos[i * 3 + 1]!) ** 2 + (pos[j * 3 + 2]! - pos[i * 3 + 2]!) ** 2;
    if (d < bd) bd = d;
  }
  const d = Math.sqrt(bd);
  asymMax = Math.max(asymMax, d);
  asymSum += d;
}

let minY = Infinity, maxY = -Infinity, sx = 0, sz = 0;
for (let i = 0; i < n; i++) { minY = Math.min(minY, pos[i * 3 + 1]!); maxY = Math.max(maxY, pos[i * 3 + 1]!); sx += pos[i * 3]!; sz += pos[i * 3 + 2]!; }
/**
 * A mesh built on the reference figure (fixed vertices present) is already in the reference's frame. Re-centring
 * it on its own vertex mean moved the reference head, arms and shoes by 7–9 mm in depth (a hoodie has more fabric
 * at the back than a T-shirt), so they stopped being identical across figures; such a mesh is left where it is.
 */
const inReferenceFrame = fixed.some((f) => f > 0);
const k = inReferenceFrame ? 1 : heightCm / 100 / (maxY - minY);
sx /= n; sz /= n;
/**
 * Not re-centred sideways (I-73): the figure was just symmetrised about x = 0, and the vertex mean is not on that
 * plane when one side has more vertices — outfit-01 moved 4 mm sideways off its own mirror plane, and the hip slider,
 * which pushes each leg from x = 0, turned that into 22 mm.
 */
sx = 0;
if (inReferenceFrame) { sx = 0; sz = 0; minY = 0; }
for (let i = 0; i < n; i++) {
  pos[i * 3] = (pos[i * 3]! - sx) * k;
  pos[i * 3 + 1] = (pos[i * 3 + 1]! - minY) * k;
  pos[i * 3 + 2] = (pos[i * 3 + 2]! - sz) * k;
}
const H = heightCm / 100;

// 2. segment and label
const parts = labelParts(pos, index, { splitFused: !file.endsWith('.json'), fromParts });
/** inner layer (I-70): a shell made only of the base T-shirt's vertices is not the outer top */
const innerMark = g.getAttribute('inner')?.array as Float32Array | undefined;
if (innerMark) for (const p of parts) if (p.vertices.length && p.vertices.every((v) => innerMark[v]! > 0)) p.kind = 'inner';
/** upper garment (I-70): a shell made only of its vertices is the top, even one reaching below the crotch (coat) */
const upperMark = g.getAttribute('upper')?.array as Float32Array | undefined;
if (upperMark) for (const p of parts) if (p.kind === 'bottom' && p.vertices.length && p.vertices.every((v) => upperMark[v]! > 0)) p.kind = 'top';
const by = (kind: string) => parts.filter((p) => p.kind === kind);
// the main shell of each kind is the largest one: small loose pieces (buttons, laces) carry the same label
const largest = (ps: Part[]) => ps.reduce<Part | undefined>((b, p) => (!b || p.vertices.length > b.vertices.length ? p : b), undefined);
const top = largest(by('top')), bottom = largest(by('bottom'));
const arms = [...by('arm_left'), ...by('arm_right')];
const head = largest(by('head'));
const shoes = [...by('shoe_left'), ...by('shoe_right')];

/**
 * 3. Landmarks, taken from the figure's own structure. Not from girth minima: on a dressed figure the
 * narrowest place is the shirt's waist, not the wearer's.
 */
const partPos = (p: Part | undefined) => (p ? p.vertices : []);
const lowestOf = (ps: Part[]) => Math.min(...ps.flatMap((p) => [p.bbox.min[1]]));
const innerX = (ps: Part[]) => Math.min(...ps.map((p) => Math.min(Math.abs(p.bbox.min[0]), Math.abs(p.bbox.max[0]))));
/**
 * Crotch: the lower garment is sliced ON ITS OWN, as a separate mesh. Slicing the whole figure and trying to
 * tell which contours are legs was unreliable — the shoes, the hem of the shirt and the open waistband all
 * produce contours at the wrong heights, and the answer came out at the ankles one way and at the waistband
 * the other. With only the trousers in the mesh, the count is unambiguous: two contours below the crotch, one
 * above it.
 */
let crotch = H * 0.48;
if (bottom) {
  const sub = new Uint32Array(bottom.triangles.length * 3);
  bottom.triangles.forEach((t, j) => { sub[j * 3] = index[t * 3]!; sub[j * 3 + 1] = index[t * 3 + 1]!; sub[j * 3 + 2] = index[t * 3 + 2]!; });
  const lo = bottom.bbox.min[1], hi = bottom.bbox.max[1];
  for (let y = hi - (hi - lo) * 0.08; y > lo; y -= 0.004) {
    let cs;
    try { cs = sliceContours(pos, sub, y); } catch { continue; }
    if (cs.length >= 2) { crotch = y; break; }
  }
}

// hip: widest slice of the lower garment above the crotch
let hip = crotch + 0.05, hipW = 0;
if (bottom) {
  // the band starts a quarter of the way up to the waistband: right above the crotch baggy trousers are at
  // their widest, and that is not the seat
  const from = crotch + (bottom.bbox.max[1] - crotch) * 0.25;
  for (let y = from; y < bottom.bbox.max[1]; y += 0.005) {
    let w = 0;
    for (const i of bottom.vertices) if (Math.abs(pos[i * 3 + 1]! - y) < 0.012) w = Math.max(w, Math.abs(pos[i * 3]!));
    if (w > hipW) { hipW = w; hip = y; }
  }
}
// chest: widest slice of the upper garment below the armholes
/**
 * Armhole. With bare arms (separate arm shells) it is the lowest point of those shells. When the sleeves are
 * part of the top and only the hands were cut off (I-47), the hands sit at wrist level and say nothing about
 * the armhole; it is where the top garment's width jumps from the trunk to the horizontal sleeves.
 */
function sleeveStart(p: Part): number | null {
  const half = (y: number) => { let w = 0; for (const i of p.vertices) if (Math.abs(pos[i * 3 + 1]! - y) < 0.01) w = Math.max(w, Math.abs(pos[i * 3]!)); return w; };
  // a low-poly slice can hold no vertices at all, so the trunk width is the widest of the lower 40 %
  let base = 0;
  for (let y = p.bbox.min[1]; y < p.bbox.min[1] + (p.bbox.max[1] - p.bbox.min[1]) * 0.4; y += 0.004) base = Math.max(base, half(y));
  for (let y = p.bbox.min[1] + 0.02; y < p.bbox.max[1]; y += 0.004) if (half(y) > base * 2.2) return y;
  return null;
}
// hands only: cut from a sleeve, or (on a composed figure) a reference hand that stops well short of the trunk
const handsOnly = arms.length > 0 && arms.every((a) => a.cut || innerX([a]) > H * 0.3);
const armpit = handsOnly && top ? (sleeveStart(top) ?? lowestOf(arms)) : arms.length ? lowestOf(arms) : H * 0.75;
let chest = armpit - 0.05, chestW = 0;
if (top) {
  // only the upper trunk: on a women's figure the hem flaring over the hips is wider than the bust
  for (let y = Math.max(top.bbox.min[1], armpit - 0.06 * H); y < armpit; y += 0.005) {
    let w = 0;
    for (const i of top.vertices) if (Math.abs(pos[i * 3 + 1]! - y) < 0.012) w = Math.max(w, Math.abs(pos[i * 3]!));
    if (w > chestW) { chestW = w; chest = y; }
  }
}
/**
 * The deformation profile interpolates between these heights, so two of them a millimetre apart become a
 * vertical step in the scale and tear whatever triangle spans it (three did). The widest point of a shirt is
 * right at the armhole, so the chest is kept a hand's width below it; the same minimum separation is applied
 * to every neighbouring pair.
 */
const MIN_GAP = H * 0.025;
if (armpit - chest < MIN_GAP) chest = armpit - MIN_GAP;
let waistband = bottom ? bottom.bbox.max[1] : H * 0.6;
if (chest - waistband < MIN_GAP) waistband = chest - MIN_GAP;
if (waistband - hip < MIN_GAP) hip = waistband - MIN_GAP;
if (hip - crotch < MIN_GAP) crotch = hip - MIN_GAP;

const landmarks: OutfitLandmarks = {
  height: H,
  ankle: shoes.length ? Math.max(...shoes.map((p) => p.bbox.max[1])) : H * 0.05,
  crotch,
  waistband,
  hip,
  chest,
  armpit,
  shoulder: arms.length ? Math.max(...arms.map((p) => p.bbox.max[1])) : H * 0.82,
  neck_base: head ? head.bbox.min[1] : H * 0.85,
  topHem: top ? top.bbox.min[1] : H * 0.5,
};

// 4. deformation axis: torso centre and half-width per height, from the shells that make up the trunk
const trunk = new Set([...partPos(top), ...partPos(bottom)]);
const axis: { y: number; cz: number; halfX: number }[] = [];
for (let i = 1; i < 400; i++) {
  const y = (H * i) / 400;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cnt = 0;
  for (const v of trunk) {
    if (Math.abs(pos[v * 3 + 1]! - y) > 0.012) continue;
    x0 = Math.min(x0, pos[v * 3]!); x1 = Math.max(x1, pos[v * 3]!);
    z0 = Math.min(z0, pos[v * 3 + 2]!); z1 = Math.max(z1, pos[v * 3 + 2]!);
    cnt++;
  }
  if (cnt < 3) continue;
  axis.push({ y: Number(y.toFixed(4)), cz: Number(((z0 + z1) / 2).toFixed(4)), halfX: Number(((x1 - x0) / 2).toFixed(4)) });
}

// measured leg centre line, from the lower garment sliced on its own (one side; the other is its mirror)
const legAxis: { y: number; cx: number; cz: number }[] = [];
if (bottom) {
  const sub = new Uint32Array(bottom.triangles.length * 3);
  bottom.triangles.forEach((t, j) => { sub[j * 3] = index[t * 3]!; sub[j * 3 + 1] = index[t * 3 + 1]!; sub[j * 3 + 2] = index[t * 3 + 2]!; });
  for (let y = bottom.bbox.min[1] + 0.01; y < crotch; y += 0.01) {
    let cs;
    try { cs = sliceContours(pos, sub, y); } catch { continue; }
    const left = cs.filter((c) => c.points.reduce((s2, q) => s2 + q[0], 0) / c.points.length > 0);
    if (!left.length) continue;
    const c = left.reduce((b, cur) => (cur.perimeter > b.perimeter ? cur : b));
    legAxis.push({
      y: Number(y.toFixed(4)),
      cx: Number((c.points.reduce((s2, q) => s2 + q[0], 0) / c.points.length).toFixed(4)),
      cz: Number((c.points.reduce((s2, q) => s2 + q[1], 0) / c.points.length).toFixed(4)),
    });
  }
}

const cm = (m: number) => Number((m * 100).toFixed(1));
const report = {
  id, source: file, statureGiven_cm: heightCm,
  weld: { before, after: n, triangles: index.length / 3, refusedNonManifold: weldRefused, seamSnapped: snapped, mirrorPaired: paired, surfaceSymmetrised: surfMoved, zeroAreaDropped, nonManifoldDropped, windingFixed, windingDropped },
  symmetry_mm: { mean: Number(((asymSum / n) * heightCm).toFixed(2)), max: Number((asymMax * heightCm).toFixed(2)) },
  parts: parts.map((p) => ({ kind: p.kind, vertices: p.vertices.length, triangles: p.triangles.length, y_cm: [cm(p.bbox.min[1]), cm(p.bbox.max[1])] })),
  landmarks_cm: Object.fromEntries(Object.entries(landmarks).map(([key, v]) => [key, cm(v)])),
  fractions_of_H: Object.fromEntries(Object.entries(landmarks).map(([key, v]) => [key, Number((v / H).toFixed(3))])),
  note: 'Обхваты этой фигуры — обхваты ОДЕЖДЫ, а не тела: исходная модель сделана одетой.',
};
mkdirSync('imported-body/out', { recursive: true });
// the same shape the naked mannequin's asset has, so deformation, measurement and rendering take it unchanged
writeFileSync(`imported-body/out/asset-${id}.json`, JSON.stringify({
  id: `outfit-${id}`,
  version: 'outfit-1',
  topologyVersion: `outfit-topo-${id}`,
  landmarks: {
    height: H,
    crotch,
    hip,
    waist: landmarks.waistband,
    chest,
    armpit,
    shoulder_level: landmarks.shoulder,
    neck_base: landmarks.neck_base,
  },
  armBand: { low: armpit, high: landmarks.shoulder },
  axis,
  legAxis,
  base: Array.from(pos).map((v) => Number(v.toFixed(6))),
  index: Array.from(index),
}));
writeFileSync(`imported-body/out/outfit-${id}.json`, JSON.stringify({
  ...report,
  landmarks,
  axis,
  partsIndex: parts.map((p) => ({ kind: p.kind, vertices: p.vertices, ...(p.cut ? { cut: true } : {}) })),
  base: Array.from(pos).map((v) => Number(v.toFixed(6))),
  index: Array.from(index),
}));
writeFileSync(`imported-body/reports/stage-I15-outfit-${id}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
