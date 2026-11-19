/**
 * Stage I-62 — a garment generated WITHOUT a body (ghost-mannequin images → multi-view image-to-3D) as a source for
 * the layered figure (I-61).
 *
 * The layered scheme needs only the garment: the head, arms and shoes are the base's own. A whole dressed figure
 * brings its own body, which then has to be thrown away; a garment-only mesh does not. This script puts such a mesh
 * into the base's frame and writes it in the same "prepared" form layer-outfit reads (outfit-<id>.json), with every
 * vertex labelled as the given layer:
 *   • orientation: +Y up, +Z front (as the base); checked, not assumed — the front is where the collar opening is;
 *   • uniform scale: the trunk half-width 5–12 cm under the sleeve root equals the base's top there × EASE;
 *   • height: the sleeve root (lowest point of the sleeve next to the trunk) at the base armpit;
 *   • depth and x: centred on the base trunk.
 * Landmarks are written equal to the base's, so layer-outfit's height knots are an identity and its sleeve, cuff,
 * push-out and relax steps do the rest. Nothing is symmetrised or measured in centimetres here.
 *
 *   node --import tsx imported-body/scripts/garment-source.ts <mesh.fbx|.glb|.obj> <id> <base id> [top|bottom]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const [file, id, baseId, layerArg] = process.argv.slice(2);
if (!file || !id || !baseId) throw new Error('usage: garment-source <mesh> <id> <base id> [top|bottom]');
const layer = (layerArg ?? 'top') as 'top' | 'bottom';
const EASE = Number(process.env.IB_EASE ?? 1.06);

async function load(path: string): Promise<THREE.BufferGeometry> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  let root: THREE.Object3D;
  if (/\.fbx$/i.test(path)) root = new FBXLoader().parse(ab, '');
  else if (/\.obj$/i.test(path)) root = new OBJLoader().parse(buf.toString('utf8'));
  else root = (await new Promise<{ scene: THREE.Object3D }>((res, rej) => new GLTFLoader().parse(ab, '', res, rej))).scene;
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    parts.push(g.index ? g : (g.setIndex([...Array(g.attributes.position!.count).keys()]), g));
  });
  if (!parts.length) throw new Error(`${path}: no mesh`);
  // concatenate
  const pos: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const off = pos.length / 3;
    pos.push(...(g.attributes.position!.array as ArrayLike<number>));
    for (const v of g.index!.array as ArrayLike<number>) idx.push(v + off);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return mergeVertices(geo, 1e-6);
}

interface Prepared { base: number[]; index: number[]; landmarks: Record<string, number>; partsIndex: { kind: string; vertices: number[] }[] }
const B = JSON.parse(readFileSync(`imported-body/out/outfit-${baseId}.json`, 'utf8')) as Prepared;
const bKind = new Array<string>(B.base.length / 3).fill('other');
for (const p of B.partsIndex) for (const v of p.vertices) bKind[v] = p.kind;

/** triangle–plane section at height y: x and z of the crossing points of triangles whose vertices pass `keep` */
function sectionY(pos: ArrayLike<number>, index: ArrayLike<number>, y: number, keep: (v: number) => boolean) {
  const xs: number[] = [], zs: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const v = [index[t]!, index[t + 1]!, index[t + 2]!];
    if (!v.every(keep)) continue;
    for (let e = 0; e < 3; e++) {
      const a = v[e]! * 3, b = v[(e + 1) % 3]! * 3;
      if ((pos[a + 1]! - y) * (pos[b + 1]! - y) > 0 || pos[a + 1] === pos[b + 1]) continue;
      const f = (y - pos[a + 1]!) / (pos[b + 1]! - pos[a + 1]!);
      xs.push(pos[a]! + f * (pos[b]! - pos[a]!)); zs.push(pos[a + 2]! + f * (pos[b + 2]! - pos[a + 2]!));
    }
  }
  return { xs, zs };
}
/** trunk half-width at height y: the section points with |x| < limit (sleeves excluded) */
const trunkHalf = (pos: ArrayLike<number>, index: ArrayLike<number>, y: number, keep: (v: number) => boolean, limit: number) => {
  const { xs } = sectionY(pos, index, y, keep);
  const t = xs.map(Math.abs).filter((x) => x < limit);
  return t.length ? Math.max(...t) : NaN;
};

const geo = await load(file);
let p = Float64Array.from(geo.attributes.position!.array as ArrayLike<number>);
let index = Array.from(geo.index!.array as ArrayLike<number>);
/**
 * Sleeve ends cut off. The generated sleeve is a closed tube: its end is a slanted, recessed lid with a narrow inner
 * tube, and the base wrist ran through those faces (shirt01: every crossing left at the cuff). Every face with a
 * vertex in the last IB_CUFF_CUT (default 4 %) of the span at either end is dropped; the cuff is an open ring.
 * Length is not lost: layer-outfit stretches a long sleeve to the base wrist anyway.
 */
let capFaces = 0;
if (layer === 'top') {
  let xl = Infinity, xh = -Infinity;
  for (let i = 0; i < p.length; i += 3) { xl = Math.min(xl, p[i]!); xh = Math.max(xh, p[i]!); }
  const band = (xh - xl) * Number(process.env.IB_CUFF_CUT ?? 0.04);
  const keep: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const v = [index[t]!, index[t + 1]!, index[t + 2]!];
    if (v.some((q) => p[q * 3]! > xh - band || p[q * 3]! < xl + band)) { capFaces++; continue; }
    keep.push(...v);
  }
  // drop the vertices only the caps used
  const remap = new Int32Array(p.length / 3).fill(-1), q: number[] = [];
  index = keep.map((v) => { if (remap[v] === -1) { remap[v] = q.length / 3; q.push(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!); } return remap[v]!; });
  p = Float64Array.from(q);
}
/**
 * Midpoint subdivision (1 → 4 triangles, IB_SUBDIV rounds, default 1). A 1000-polygon garment has sleeve faces
 * 15 cm long; the base's low-poly forearm crossed one in its middle, no vertex could move the crossing away, and the
 * push grew four 15 cm spikes at the forearm (first shirt). Shape is unchanged; only vertices are added.
 */
for (let round = 0; round < Number(process.env.IB_SUBDIV ?? 1); round++) {
  const pts = Array.from(p), mid = new Map<string, number>(), out: number[] = [];
  const m = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let v = mid.get(key);
    if (v === undefined) { v = pts.length / 3; for (let k = 0; k < 3; k++) pts.push((pts[a * 3 + k]! + pts[b * 3 + k]!) / 2); mid.set(key, v); }
    return v;
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]!, b = index[t + 1]!, c = index[t + 2]!, ab = m(a, b), bc = m(b, c), ca = m(c, a);
    out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  p = Float64Array.from(pts); index = out;
}
const n = p.length / 3;
const bbox = () => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[i * 3 + k]!); hi[k] = Math.max(hi[k]!, p[i * 3 + k]!); }
  return { lo, hi };
};

// 1. orientation: up is the bbox axis that is neither the widest (sleeve span) nor the thinnest (depth); the generated meshes come +Y up
let { lo, hi } = bbox();
const span = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
if (layer === 'top' && !(span[0]! >= span[1]! && span[1]! >= span[2]!)) {
  throw new Error(`unexpected orientation, bbox ${span.map((s) => s.toFixed(3))} — expected x (sleeves) ≥ y ≥ z`);
}
// centre x/z, floor y at 0 for now
for (let i = 0; i < n; i++) { p[i * 3] -= (lo[0]! + hi[0]!) / 2; p[i * 3 + 2] -= (lo[2]! + hi[2]!) / 2; p[i * 3 + 1] -= lo[1]!; }
({ lo, hi } = bbox());
const all = () => true;
const H0 = hi[1]!;
// trunk half-width near the hem (10 % of the height)
const hemHalf = trunkHalf(p, index, H0 * 0.1, all, Infinity);
// sleeve root: the lowest section point beyond the trunk (hemHalf + 6 cm in the garment's own scale, ~relative)
const limit = hemHalf * 1.35;
let rootY = Infinity;
for (let i = 0; i < n; i++) { const ax = Math.abs(p[i * 3]!); if (ax > limit && ax < limit * 1.6) rootY = Math.min(rootY, p[i * 3 + 1]!); }
if (!Number.isFinite(rootY)) throw new Error('no sleeve root found');
// front: the collar opening is at the front, i.e. the top of the garment at x≈0 is further back at the front
// (a shirt's neckline drops in front). Check: highest point at x≈0, front half vs back half.
const neckTop = (front: boolean) => { let m = -Infinity; for (let i = 0; i < n; i++) if (Math.abs(p[i * 3]!) < 0.15 * hemHalf && (p[i * 3 + 2]! > 0) === front) m = Math.max(m, p[i * 3 + 1]!); return m; };
let flipped = false;
if (layer === 'top' && neckTop(true) > neckTop(false)) {
  // back of the neck is higher than the front on every shirt; if not, the mesh faces −Z — turn it around
  for (let i = 0; i < n; i++) { p[i * 3] = -p[i * 3]!; p[i * 3 + 2] = -p[i * 3 + 2]!; }
  flipped = true;
}

// 2. scale: trunk half-width 5–12 cm under the base armpit, measured on both
const bArm = B.landmarks.armpit!;
const bTop = (v: number) => bKind[v] === layer;
const bHalf: number[] = [], sHalf: number[] = [];
const sScaleGuess = (bArm - B.landmarks.topHem!) / (rootY - 0);
for (const d of [0.05, 0.075, 0.1, 0.12]) {
  bHalf.push(trunkHalf(B.base, B.index, bArm - d, bTop, 0.3));
  sHalf.push(trunkHalf(p, index, rootY - d / sScaleGuess, all, limit));
}
const med = (a: number[]) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[s.length >> 1]!; };
const k = (med(bHalf) * EASE) / med(sHalf);
for (let i = 0; i < p.length; i++) p[i] *= k;
// 3. height and depth
const dy = bArm - rootY * k;
for (let i = 0; i < n; i++) p[i * 3 + 1] += dy;
const zMid = (pos: ArrayLike<number>, idx: ArrayLike<number>, keep: (v: number) => boolean) => {
  const mids: number[] = [];
  for (const d of [0.05, 0.08, 0.11]) {
    const s = sectionY(pos, idx, bArm - d, keep);
    const zs = s.zs.filter((_, j) => Math.abs(s.xs[j]!) < 0.06);
    if (zs.length >= 2) mids.push((Math.min(...zs) + Math.max(...zs)) / 2);
  }
  return med(mids);
};
const dz = zMid(B.base, B.index, bTop) - zMid(p, index, all);
for (let i = 0; i < n; i++) p[i * 3 + 2] += dz;

/**
 * 4. Sleeves on the base arm axis. The generated sleeve hung 2–3 cm behind the arm; the low-poly forearm then
 * pierced its front and the push grew spikes there. Per 1 cm along x the sleeve's section centre (y, z) is moved
 * onto the base arm's, blended in over 6 cm from the armhole.
 */
let sleeveShift = 0, cuffClamped = 0;
if (layer === 'top') {
  const sectionX = (pos: ArrayLike<number>, idx: ArrayLike<number>, x: number, keep: (v: number) => boolean) => {
    const ys: number[] = [], zs: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      if (!v.every(keep)) continue;
      for (let e = 0; e < 3; e++) {
        const a = v[e]! * 3, b = v[(e + 1) % 3]! * 3;
        if ((pos[a]! - x) * (pos[b]! - x) > 0 || pos[a] === pos[b]) continue;
        const f = (x - pos[a]!) / (pos[b]! - pos[a]!);
        ys.push(pos[a + 1]! + f * (pos[b + 1]! - pos[a + 1]!)); zs.push(pos[a + 2]! + f * (pos[b + 2]! - pos[a + 2]!));
      }
    }
    return ys.length >= 3 ? [(Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] : null;
  };
  const armpitHalf = trunkHalf(p, index, bArm - 0.04, all, 0.3);
  const reachG = Math.max(...Array.from({ length: n }, (_, i) => Math.abs(p[i * 3]!)));
  for (const side of [1, -1]) {
    const arm = side > 0 ? 'arm_left' : 'arm_right';
    const shift = new Map<number, [number, number]>();
    for (let cm = Math.ceil(armpitHalf * 100); cm <= Math.floor(reachG * 100); cm++) {
      const g = sectionX(p, index, side * cm / 100, () => true);
      // the base: arm, or the T-shirt sleeve over it near the shoulder
      const b = sectionX(B.base, B.index, side * cm / 100, (v) => bKind[v] === arm || (bKind[v] === 'top' && Math.abs(B.base[v * 3]!) > 0.2));
      if (g && b) shift.set(cm, [b[0]! - g[0]!, b[1]! - g[1]!]);
    }
    /**
     * ONE shift per sleeve, the median over the upper arm and forearm (8 cm past the armhole to 60 cm). Per-slice
     * shifts sheared the cuff: the sleeve is shortened to the wrist only later, so its cuff was centred on sections
     * of the HAND (thumb), and the cuff grew 4 cm teeth.
     */
    if (process.env.IB_DEBUG) console.error("shift", side, [...shift].map(([c, s]) => `${c}:${(s[0]! * 100).toFixed(1)},${(s[1]! * 100).toFixed(1)}`).join(" "));
    const ss = [...shift].filter(([cm]) => cm >= armpitHalf * 100 + 8 && cm <= 60).map(([, s]) => s);
    if (!ss.length) continue;
    const medOf = (k: number) => { const v = ss.map((s) => s[k]!).sort((a, b) => a - b); return v[v.length >> 1]!; };
    const s = [medOf(0), medOf(1)];
    for (let i = 0; i < n; i++) {
      const ax = p[i * 3]! * side;
      if (ax <= armpitHalf) continue;
      const w = Math.min(1, (ax - armpitHalf) / 0.06);
      p[i * 3 + 1] += w * s[0]!; p[i * 3 + 2] += w * s[1]!;
    }
    sleeveShift = Math.max(sleeveShift, Math.hypot(s[0]!, s[1]!));
    /**
     * Sleeve outliers: from 12 cm past the armhole to the cuff, every vertex stays between 0.9× and 1.3× the median
     * radius of its 1 cm slice around the slice centre. Generated cuffs carry button tabs (teeth when pushed) and a
     * seam fold turned INTO the sleeve, which crossed the base forearm in a ring (14 crossings, first shirt).
     */
    const end = Math.max(...Array.from({ length: n }, (_, i) => p[i * 3]! * side));
    const slices = new Map<number, number[]>();
    const cy = new Map<number, [number, number]>();
    for (let i = 0; i < n; i++) {
      const ax = p[i * 3]! * side;
      if (ax < armpitHalf + 0.12) continue;
      const cm = Math.round(ax * 100);
      (slices.get(cm) ?? slices.set(cm, []).get(cm)!).push(i);
    }
    for (const [cm, vs] of slices) {
      const ys = vs.map((i) => p[i * 3 + 1]!), zs = vs.map((i) => p[i * 3 + 2]!);
      const c: [number, number] = [(Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
      cy.set(cm, c);
      const rs = vs.map((i) => Math.hypot(p[i * 3 + 1]! - c[0], p[i * 3 + 2]! - c[1])).sort((a, b) => a - b);
      const lim = rs[rs.length >> 1]! * 1.3, low = rs[rs.length >> 1]! * 0.9;
      for (const i of vs) {
        const r = Math.hypot(p[i * 3 + 1]! - c[0], p[i * 3 + 2]! - c[1]);
        if (r > lim || (r < low && r > 1e-6)) { const k = (r > lim ? lim : low) / r; p[i * 3 + 1] = c[0] + (p[i * 3 + 1]! - c[0]) * k; p[i * 3 + 2] = c[1] + (p[i * 3 + 2]! - c[1]) * k; cuffClamped++; }
      }
    }
  }
}

({ lo, hi } = bbox());
const out: Prepared = {
  base: Array.from(p, (v) => Number(v.toFixed(6))),
  index,
  landmarks: { ...B.landmarks },
  partsIndex: [{ kind: layer, vertices: [...Array(n).keys()] }],
  prealigned: baseId,
} as Prepared & { prealigned: string };
writeFileSync(`imported-body/out/outfit-${id}.json`, JSON.stringify(out));
console.log(JSON.stringify({
  id, source: file.split("/").pop(), cuffFacesCut: capFaces, vertices: n, triangles: index.length / 3, flipped, scale: Number(k.toFixed(4)), sleeveCentred_cm: Number((sleeveShift * 100).toFixed(1)), cuffVerticesClamped: cuffClamped,
  hem_cm: Number((lo[1]! * 100).toFixed(1)), top_cm: Number((hi[1]! * 100).toFixed(1)), reach_cm: Number((hi[0]! * 100).toFixed(1)),
  trunkHalf_cm: { base: Number((med(bHalf) * 100).toFixed(1)), garment: Number((med(sHalf) * k * 100).toFixed(1)) },
}));
