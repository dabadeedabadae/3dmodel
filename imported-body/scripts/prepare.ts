/**
 * Imported low-poly body → canonical asset for FitCast.
 *   node --import tsx imported-body/scripts/prepare.ts imported-body/assets/source.fbx [heightCm]
 * Steps: load FBX → weld → mirror-symmetrise → scale to the stated stature → feet on floor → landmark scan by
 * horizontal slicing (the same slicer the measurement core uses) → out/body.json + out/report.json.
 * NOTE the stature is GIVEN, not derived: the FBX is normalised to 1.0 and carries no scale.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sliceContours } from '../src/geom/measure';

const file = process.argv[2]!;
const heightCm = Number(process.argv[3] ?? 165);
const buf = readFileSync(file);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
root.updateMatrixWorld(true);
let src: THREE.Mesh | null = null;
root.traverse((o) => {
  if ((o as THREE.Mesh).isMesh && !src) src = o as THREE.Mesh;
});
let g = src!.geometry.clone().applyMatrix4(src!.matrixWorld);
g.deleteAttribute('normal');
if (g.hasAttribute('uv')) g.deleteAttribute('uv');
g = mergeVertices(g, 1e-5);

const pos = g.attributes.position!.array as Float32Array;
const n = pos.length / 3;
// 1. mirror-symmetrise: snap the centre seam, then average each vertex with the nearest mirror partner
let snapped = 0,
  paired = 0,
  unpaired = 0;
for (let i = 0; i < n; i++) if (Math.abs(pos[i * 3]!) < 1e-4) { pos[i * 3] = 0; snapped++; }
const out = new Float32Array(pos);
for (let i = 0; i < n; i++) {
  const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
  if (x === 0) continue;
  let best = -1, bd = Infinity;
  for (let j = 0; j < n; j++) {
    const d = (pos[j * 3]! + x) ** 2 + (pos[j * 3 + 1]! - y) ** 2 + (pos[j * 3 + 2]! - z) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  if (best >= 0 && Math.sqrt(bd) < 0.01) {
    out[i * 3] = (x - pos[best * 3]!) / 2;
    out[i * 3 + 1] = (y + pos[best * 3 + 1]!) / 2;
    out[i * 3 + 2] = (z + pos[best * 3 + 2]!) / 2;
    paired++;
  } else unpaired++;
}
pos.set(out);
// 2. scale to the stated stature, feet on the floor, centred on x and on the mean z
let minY = Infinity, maxY = -Infinity, sx = 0, sz = 0;
for (let i = 0; i < n; i++) { minY = Math.min(minY, pos[i * 3 + 1]!); maxY = Math.max(maxY, pos[i * 3 + 1]!); sx += pos[i * 3]!; sz += pos[i * 3 + 2]!; }
const k = heightCm / 100 / (maxY - minY);
sx /= n; sz /= n;
for (let i = 0; i < n; i++) {
  pos[i * 3] = (pos[i * 3]! - sx) * k;
  pos[i * 3 + 1] = (pos[i * 3 + 1]! - minY) * k;
  pos[i * 3 + 2] = (pos[i * 3 + 2]! - sz) * k;
}
g.attributes.position!.needsUpdate = true;
const index = g.index!.array as Uint32Array;
const H = heightCm / 100;

// 3. landmark scan. In a T-pose the arms lie ALONG a horizontal plane, so every slice through them reports one
// huge contour (arm span, not a girth). The arm band is found first and excluded from every girth band.
let armLowY = Infinity, armHighY = -Infinity, torsoHalf = 0;
for (let i = 0; i < n; i++) {
  const x = Math.abs(pos[i * 3]!), y = pos[i * 3 + 1]!;
  if (x > H * 0.16) { armLowY = Math.min(armLowY, y); armHighY = Math.max(armHighY, y); }
}
interface Row { y: number; parts: number; girth: number; width: number; span: number; cz: number }
const rows: Row[] = [];
const STEPS = 400;
for (let i = 1; i < STEPS; i++) {
  const y = (H * i) / STEPS;
  let cs;
  try { cs = sliceContours(pos, index, y); } catch { continue; }
  if (!cs.length) continue;
  const torso = [...cs].sort((a, b) => b.perimeter - a.perimeter)[0]!;
  let span = 0, tw = 0;
  for (const c of cs) for (const p of c.points) span = Math.max(span, Math.abs(p[0]));
  let zmin = Infinity, zmax = -Infinity;
  for (const p of torso.points) { tw = Math.max(tw, Math.abs(p[0])); zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
  rows.push({ y, parts: cs.length, girth: torso.perimeter, width: tw * 2, span: span * 2, cz: (zmin + zmax) / 2 });
}
const clean = rows.filter((r) => r.y < armLowY - 0.005); // below the arms: girths are real
const crotchRows = clean.filter((r) => r.y < H * 0.6 && r.parts >= 2);
const crotch = crotchRows.length ? Math.max(...crotchRows.map((r) => r.y)) : H * 0.49;
const torsoBand = clean.filter((r) => r.y > crotch + 0.02);
const waistRow = torsoBand.reduce((a, b) => (b.girth < a.girth ? b : a));
// the hip band starts above the crotch: at the merge level the slice still contains both thighs, which
// reads as a girth far larger than the seat
const hipRow = clean.filter((r) => r.y > crotch + H * 0.03 && r.y < waistRow.y).reduce((a, b) => (b.girth > a.girth ? b : a), waistRow);
const chestRow = clean.filter((r) => r.y > waistRow.y).reduce((a, b) => (b.girth > a.girth ? b : a), waistRow);
const shoulderRow = rows.filter((r) => r.y >= armLowY && r.y <= armHighY).reduce((a, b) => (b.span > a.span ? b : a), rows[0]!);
const armpit = armLowY;
const cm = (m: number) => Number((m * 100).toFixed(1));
const report = {
  source: file,
  statureGiven_cm: heightCm,
  weld: { vertices: n, triangles: index.length / 3, seamSnapped: snapped, mirrorPaired: paired, mirrorUnpaired: unpaired },
  armBand_cm: { low: cm(armLowY), high: cm(armHighY) },
  landmarks_cm: {
    height: cm(H),
    crotch: cm(crotch),
    hip: cm(hipRow.y),
    waist: cm(waistRow.y),
    chest: cm(chestRow.y),
    armpit: cm(armpit),
    shoulder_level: cm(shoulderRow.y),
    neck_base: cm(armHighY),
  },
  girths_cm: { chest: cm(chestRow.girth), waist: cm(waistRow.girth), hip: cm(hipRow.girth) },
  widths_cm: { torso_at_chest: cm(chestRow.width), arm_span: cm(Math.max(...rows.map((r) => r.span))) },
  fractions_of_H: {
    crotch: Number((crotch / H).toFixed(3)),
    hip: Number((hipRow.y / H).toFixed(3)),
    waist: Number((waistRow.y / H).toFixed(3)),
    chest: Number((chestRow.y / H).toFixed(3)),
    armpit: Number((armpit / H).toFixed(3)),
    neck_base: Number((armHighY / H).toFixed(3)),
  },
};
// deformation axis: torso centre in z and half-width per height. Inside the arm band the "torso" contour is the
// arms, so those levels are filled from the armpit value instead of measured.
const axisRows = rows.filter((r) => r.y < armLowY - 0.005 || r.y > armHighY + 0.005);
const atArmpit = clean[clean.length - 1] ?? rows[0]!;
const axis = rows.map((r) => {
  const src = r.y >= armLowY - 0.005 && r.y <= armHighY + 0.005 ? atArmpit : r;
  return { y: Number(r.y.toFixed(4)), cz: Number(src.cz.toFixed(4)), halfX: Number((src.width / 2).toFixed(4)) };
});
void axisRows;
mkdirSync('imported-body/out', { recursive: true });
writeFileSync(
  'imported-body/out/asset.json',
  JSON.stringify({
    id: 'imported-male-lowpoly',
    version: 'imported-1',
    topologyVersion: 'imported-topo-1',
    landmarks: { height: H, crotch, hip: hipRow.y, waist: waistRow.y, chest: chestRow.y, armpit, shoulder_level: shoulderRow.y, neck_base: armHighY },
    armBand: { low: armLowY, high: armHighY },
    axis,
    base: Array.from(pos).map((v) => Number(v.toFixed(6))),
    index: Array.from(index),
  }),
);
writeFileSync('imported-body/out/body.json', JSON.stringify({ positions: Array.from(pos).map((v) => Number(v.toFixed(6))), index: Array.from(index) }));
writeFileSync('imported-body/out/report.json', JSON.stringify(report, null, 2));
writeFileSync('imported-body/out/slices.json', JSON.stringify(rows.map((r) => ({ y: Number(r.y.toFixed(4)), parts: r.parts, girth: Number(r.girth.toFixed(4)), w: Number(r.width.toFixed(4)), span: Number(r.span.toFixed(4)) }))));
console.log(JSON.stringify(report, null, 2));
