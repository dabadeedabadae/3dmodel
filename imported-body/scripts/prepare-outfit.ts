/**
 * Dressed figure → FitCast asset, compatible with the same deformation, measurement and render code as the
 * naked mannequin.
 *   node --import tsx imported-body/scripts/prepare-outfit.ts imported-body/assets/outfit-01.fbx outfit01 [heightCm]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sliceContours } from '../src/geom/measure';
import { labelParts, type OutfitLandmarks, type Part } from '../src/outfit';

const file = process.argv[2]!;
const id = process.argv[3] ?? 'outfit';
const heightCm = Number(process.argv[4] ?? 175);
/** A generated FBX, or a mesh already composed onto the reference body (I-50: { base, index } JSON). */
function loadGeometry(path: string): THREE.BufferGeometry {
  if (path.endsWith('.json')) {
    const j = JSON.parse(readFileSync(path, 'utf8')) as { base: number[]; index: number[]; fixed?: number[] };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(j.base, 3));
    // marks the reference body's vertices; survives the weld because it is a vertex attribute
    const fx = new Float32Array(j.base.length / 3);
    for (const v of j.fixed ?? []) fx[v] = 1;
    geo.setAttribute('fixed', new THREE.Float32BufferAttribute(fx, 1));
    geo.setIndex(j.index);
    return geo;
  }
  const buf = readFileSync(path);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  root.updateMatrixWorld(true);
  let src: THREE.Mesh | null = null;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !src) src = o as THREE.Mesh; });
  return (src as unknown as THREE.Mesh).geometry.clone().applyMatrix4((src as unknown as THREE.Mesh).matrixWorld);
}
let g = loadGeometry(file);
g.deleteAttribute('normal');
if (g.hasAttribute('uv')) g.deleteAttribute('uv');
const before = g.attributes.position!.count;
g = mergeVertices(g, 1e-5);
const pos = g.attributes.position!.array as Float32Array;
const index = g.index!.array as Uint32Array;
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
const k = heightCm / 100 / (maxY - minY);
sx /= n; sz /= n;
for (let i = 0; i < n; i++) {
  pos[i * 3] = (pos[i * 3]! - sx) * k;
  pos[i * 3 + 1] = (pos[i * 3 + 1]! - minY) * k;
  pos[i * 3 + 2] = (pos[i * 3 + 2]! - sz) * k;
}
const H = heightCm / 100;

// 2. segment and label
const parts = labelParts(pos, index, { splitFused: !file.endsWith('.json') });
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
  for (let y = top.bbox.min[1]; y < armpit; y += 0.005) {
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
  weld: { before, after: n, triangles: index.length / 3, seamSnapped: snapped, mirrorPaired: paired },
  symmetry_mm: { mean: Number(((asymSum / n) * heightCm).toFixed(2)), max: Number((asymMax * heightCm).toFixed(2)) },
  parts: parts.map((p) => ({ kind: p.kind, vertices: p.vertices.length, triangles: p.triangles.length, y_cm: [cm(p.bbox.min[1]), cm(p.bbox.max[1])] })),
  landmarks_cm: Object.fromEntries(Object.entries(landmarks).map(([key, v]) => [key, cm(v)])),
  fractions_of_H: Object.fromEntries(Object.entries(landmarks).map(([key, v]) => [key, Number((v / H).toFixed(3))])),
  note: 'Обхваты этой фигуры — обхваты ОДЕЖДЫ, а не тела: она сгенерирована одетой.',
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
  partsIndex: parts.map((p) => ({ kind: p.kind, vertices: p.vertices })),
  base: Array.from(pos).map((v) => Number(v.toFixed(6))),
  index: Array.from(index),
}));
writeFileSync(`imported-body/reports/stage-I15-outfit-${id}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
