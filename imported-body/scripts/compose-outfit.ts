/**
 * Stage I-50 — one body for every outfit.
 *
 * Every generated figure comes with its own head, hands and proportions, so two outfits never look like the
 * same person and a top from one cannot meet a bottom from another. This step keeps a figure's CLOTHES and
 * replaces its BODY with the reference figure's:
 *   1. heights are remapped piecewise-linearly so ankle, crotch, armhole, neck and crown match the reference;
 *   2. the arm span is rescaled outward from the armhole so the fingertips reach where the reference's do;
 *   3. the head and the hands are removed and the reference's head and hands are inserted, centred on the
 *      collar and on each cuff.
 * The garments keep their own widths: a hoodie is wider than a T-shirt, and that is the garment, not the body.
 * The result is a plain mesh that goes through prepare-outfit like any FBX, so every check applies to it.
 *
 *   node --import tsx imported-body/scripts/compose-outfit.ts <target raw id> <reference id> <out file>
 *   e.g. raw-outfit02 outfit01 imported-body/out/composed-outfit02.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Prepared {
  base: number[];
  index: number[];
  landmarks: Record<string, number>;
  partsIndex: { kind: string; vertices: number[] }[];
}
const [targetId, refId, outFile] = process.argv.slice(2);
if (!targetId || !refId || !outFile) throw new Error('usage: compose-outfit <target id> <reference id> <out file>');
const load = (id: string) => JSON.parse(readFileSync(`imported-body/out/outfit-${id}.json`, 'utf8')) as Prepared;
const T = load(targetId), R = load(refId);

const kindOf = (p: Prepared) => {
  const k = new Array<string>(p.base.length / 3).fill('other');
  for (const part of p.partsIndex) for (const v of part.vertices) k[v] = part.kind;
  return k;
};
const tKind = kindOf(T), rKind = kindOf(R);
const isBody = (k: string) => k === 'head' || k === 'arm_left' || k === 'arm_right';
const tp = Float64Array.from(T.base), rp = Float64Array.from(R.base);
const nT = tp.length / 3, nR = rp.length / 3;

// 1. heights
const knots = (L: Record<string, number>) => [0, L.ankle!, L.crotch!, L.armpit!, L.neck_base!, L.height!];
const from = knots(T.landmarks), to = knots(R.landmarks);
for (let i = 1; i < from.length; i++) if (!(from[i]! > from[i - 1]!) || !(to[i]! > to[i - 1]!)) throw new Error(`landmarks out of order at knot ${i}`);
const mapY = (y: number) => {
  for (let i = 1; i < from.length; i++) if (y <= from[i]! || i === from.length - 1) {
    const f = (y - from[i - 1]!) / (from[i]! - from[i - 1]!);
    return to[i - 1]! + f * (to[i]! - to[i - 1]!);
  }
  return y;
};
for (let i = 0; i < nT; i++) tp[i * 3 + 1] = mapY(tp[i * 3 + 1]!);

// 2. arm span, measured to the fingertips, scaled outward from the trunk at armhole height
const reach = (p: Float64Array, n: number) => { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(p[i * 3]!)); return m; };
const armpitY = R.landmarks.armpit!;
let s0 = 0;
for (let i = 0; i < nT; i++) if (tKind[i] === 'top' && Math.abs(tp[i * 3 + 1]! - (armpitY - 0.04)) < 0.015) s0 = Math.max(s0, Math.abs(tp[i * 3]!));
const kArm = (reach(rp, nR) - s0) / (reach(tp, nT) - s0);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < nT; i++) {
  const ax = Math.abs(tp[i * 3]!);
  if (ax <= s0) continue;
  // only at arm height: wide trouser legs further down must not be stretched sideways
  const w = smooth(armpitY - 0.1, armpitY - 0.04, tp[i * 3 + 1]!);
  tp[i * 3] = Math.sign(tp[i * 3]!) * (ax + w * (ax - s0) * (kArm - 1));
}

// 3. reference head and hands
const out: number[] = [];
const outIndex: number[] = [];
const remapT = new Int32Array(nT).fill(-1);
for (let i = 0; i < nT; i++) if (!isBody(tKind[i]!)) { remapT[i] = out.length / 3; out.push(tp[i * 3]!, tp[i * 3 + 1]!, tp[i * 3 + 2]!); }
for (let t = 0; t < T.index.length; t += 3) {
  const a = remapT[T.index[t]!]!, b = remapT[T.index[t + 1]!]!, c = remapT[T.index[t + 2]!]!;
  if (a >= 0 && b >= 0 && c >= 0) outIndex.push(a, b, c);
}

const centroid = (p: Float64Array, ids: number[]) => {
  const c = [0, 0, 0];
  for (const i of ids) for (let k = 0; k < 3; k++) c[k]! += p[i * 3 + k]!;
  return c.map((v) => v / Math.max(ids.length, 1));
};
// head: the reference neck ring onto the centre of the target collar
const neckY = R.landmarks.neck_base!;
const collar = [...Array(nT).keys()].filter((i) => !isBody(tKind[i]!) && Math.abs(tp[i * 3 + 1]! - neckY) < 0.03 && Math.abs(tp[i * 3]!) < 0.1);
const rNeck = [...Array(nR).keys()].filter((i) => rKind[i] === 'head' && Math.abs(rp[i * 3 + 1]! - neckY) < 0.03);
if (!collar.length || !rNeck.length) throw new Error('cannot find the collar or the reference neck');
const headShift = [0, 0, centroid(tp, collar)[2]! - centroid(rp, rNeck)[2]!];

// hands: for each side, the target cuff is the innermost x of its own removed hand/arm shell
const cuffX: Record<string, number> = {};
for (const side of ['arm_left', 'arm_right']) {
  const ids = [...Array(nT).keys()].filter((i) => tKind[i] === side);
  if (!ids.length) throw new Error(`target has no ${side}`);
  cuffX[side] = Math.min(...ids.map((i) => Math.abs(tp[i * 3]!)));
}
const handShift: Record<string, number[]> = {};
for (const side of ['arm_left', 'arm_right']) {
  const x0 = cuffX[side]!;
  const sgn = side === 'arm_left' ? 1 : -1;
  // centre of the sleeve opening (target) vs centre of the reference arm at the same distance from the body
  const sleeve = [...Array(nT).keys()].filter((i) => !isBody(tKind[i]!) && tp[i * 3]! * sgn > x0 - 0.03 && tp[i * 3]! * sgn <= x0 + 0.005);
  const rArm = [...Array(nR).keys()].filter((i) => rKind[i] === side && Math.abs(Math.abs(rp[i * 3]!) - x0) < 0.02);
  handShift[side] = sleeve.length && rArm.length
    ? [0, centroid(tp, sleeve)[1]! - centroid(rp, rArm)[1]!, centroid(tp, sleeve)[2]! - centroid(rp, rArm)[2]!]
    : [0, 0, 0];
}

/**
 * Which reference vertices go in. The low-poly forearm is a single long segment between the elbow ring and the
 * wrist ring, so keeping only the vertices beyond the cuff and dropping the triangles that cross it removed
 * the whole forearm surface and left a visible gap between cuff and hand. Every triangle that reaches past the
 * cut is kept; its vertices on the near side are pulled towards a plane 1.5 cm inside the sleeve, where the
 * squashed strip stays hidden (compressed 7× towards the cut, not flattened).
 */
const cutOf = (k: string) => cuffX[k]! - 0.015;
const beyond = (i: number) => {
  const k = rKind[i]!;
  return k === 'head' || ((k === 'arm_left' || k === 'arm_right') && Math.abs(rp[i * 3]!) > cutOf(k));
};
const keep = new Uint8Array(nR);
for (let t = 0; t < R.index.length; t += 3) {
  const tri = [R.index[t]!, R.index[t + 1]!, R.index[t + 2]!];
  if (tri.some(beyond) && tri.every((v) => rKind[v] === rKind[tri[0]!])) for (const v of tri) keep[v] = 1;
}
const remapR = new Int32Array(nR).fill(-1);
let pulled = 0;
for (let i = 0; i < nR; i++) {
  if (!keep[i]) continue;
  const k = rKind[i]!;
  const shift = k === 'head' ? headShift : handShift[k]!;
  let x = rp[i * 3]!;
  // compressed towards the cut, not flattened onto it: flat strips turn into near-degenerate triangles that
  // invert at the slightest shoulder shift (the shirt lost its shoulder slider to that, ±0.81 → ±0.08)
  if (k !== 'head' && Math.abs(x) < cutOf(k)) { x = Math.sign(x) * (cutOf(k) - (cutOf(k) - Math.abs(x)) * 0.15); pulled++; }
  remapR[i] = out.length / 3;
  out.push(x + shift[0]!, rp[i * 3 + 1]! + shift[1]!, rp[i * 3 + 2]! + shift[2]!);
}
for (let t = 0; t < R.index.length; t += 3) {
  const a = remapR[R.index[t]!]!, b = remapR[R.index[t + 1]!]!, c = remapR[R.index[t + 2]!]!;
  if (a >= 0 && b >= 0 && c >= 0) outIndex.push(a, b, c);
}

writeFileSync(outFile, JSON.stringify({ base: out.map((v) => Number(v.toFixed(6))), index: outIndex }));
console.log(JSON.stringify({
  target: targetId, reference: refId, vertices: out.length / 3, triangles: outIndex.length / 3,
  armSpanScale: Number(kArm.toFixed(3)), headShift_cm: headShift.map((v) => Number((v * 100).toFixed(1))),
  cuffX_cm: Object.fromEntries(Object.entries(cuffX).map(([k, v]) => [k, Number((v * 100).toFixed(1))])),
  verticesPulledInsideCuff: pulled,
}));
