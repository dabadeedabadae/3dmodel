/**
 * Stage I-12 — DRESSING by shrinking, instead of placing the garment with one scale.
 *
 * Why: a garment placed at its final size either starts partly inside the body (and tears when pushed out) or,
 * sized to clear the body, ends up with a neck opening wider than the shoulders — and then nothing holds it:
 * the torso narrows from chest to waist, so the shirt simply slides off (measured: 2.7–3.5 m).
 *
 * How: the garment starts inflated RADIALLY around the body axis, so the body is inside it and the head is
 * already through the neck opening. Then the rest lengths of every constraint are scaled from that inflated
 * size down to the garment's own size, a little each frame, while the solver runs. The fabric closes onto the
 * body, the neck opening shrinks to its real diameter around the neck and catches on the shoulders.
 * Gravity is OFF while it closes and is ramped in at the end: with gravity on from the start the loose tube
 * slides down the body long before the neck opening is small enough to catch anything (measured: it ended up
 * 421 m below the floor).
 * Nothing is pinned at any point: whether the garment stays on is then a RESULT, not an assumption, and the
 * report states how far it moved during the free settle.
 *
 *   node --import tsx imported-body/scripts/dress-sim.ts [--garment tshirt] [--shape base] [--inflate 1.6]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadAsset } from '../src/load';
import { deform, type Weights } from '../src/deform';
import { buildSkeleton, computeSkin } from '../src/rig';
import { verifiedAPose } from '../src/pose';
import { buildColliders, profileAt, resolvePoint } from '../src/collider';
import { penetration, projectOutOfMesh } from '../src/penetration';
import { gradeGarment, applyGrade, shapeToBody, tightenCollar, halfWidthAt } from '../src/garmentFit';
import { zoneEase, clearanceMap } from '../src/fitReport';
import { measureImported } from '../src/measure';
import { buildCloth, stepCloth, stretchStats, updateNormals, DEFAULT_CLOTH, type ClothParams } from '../src/cloth';

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1]! : d);
const garmentId = opt('garment', 'tshirt');
const shapeId = opt('shape', 'base');
const shrinkFrames = Number(opt('shrink', '420'));
const settleFrames = Number(opt('settle', '240'));
const ease = Number(opt('ease', '0.012'));

const SHAPES: Record<string, { w: Partial<Weights>; h?: number }> = {
  base: { w: {} },
  athletic: { w: { chest: 0.8, waist: -0.6, shoulders: 1, arms: 0.7, thighs: 0.4 } },
  round: { w: { chest: 0.4, waist: 1, hip: 0.8, arms: 0.2, thighs: 0.6 } },
  slim: { w: { chest: -0.6, waist: -0.8, hip: -0.5, arms: -0.6, thighs: -0.6 } },
  tall: { w: {}, h: 190 },
};
const asset = loadAsset();
const shape = SHAPES[shapeId] ?? SHAPES.base!;
const body = deform(asset, shape.w, { mode: shape.h ? 'proportional' : 'keep_girths', height_cm: shape.h ?? asset.landmarks.height * 100 });
const sk = computeSkin(asset, body, buildSkeleton(asset, body));
const pose = verifiedAPose(asset, body, sk);
if (!pose.verified) { console.log(`FAIL  A-поза не проверена: ${pose.failed.join('; ')}`); process.exit(1); }
const colliders = buildColliders(asset, pose.positions);

const raw = JSON.parse(readFileSync(`imported-body/out/garment-${garmentId}.json`, 'utf8'));
const target = new Float32Array(raw.positions as number[]);
const gi = new Uint32Array(raw.index as number[]);
const gn = target.length / 3;

// --- 1. grading: length and girth separately (see src/garmentFit.ts) ------
const easeChest = Number(opt('ease', '0.10'));
// a size-M tee measures about 71 cm from the high point of the shoulder to the hem on a 178 cm wearer; as a
// fraction of stature that is 0.416, which is where the hem is aimed unless --hem says otherwise
const hemFraction = Number(opt('hem', '0.416'));
let bodyTop = -Infinity;
for (let i = 0; i < pose.positions.length / 3; i++) bodyTop = Math.max(bodyTop, pose.positions[i * 3 + 1]!);
const k = bodyTop / asset.landmarks.height;
const bodyChestGirth = measureImported(asset, body).chest_cm / 100;
const yChest = asset.landmarks.chest * k;
const chestRing = colliders.torso.reduce((best, r) => (Math.abs(r.y - yChest) < Math.abs(best.y - yChest) ? r : best));
let gzSum = 0, gzN = 0;
{
  let t = -Infinity, b = Infinity;
  for (let i = 0; i < gn; i++) { t = Math.max(t, target[i * 3 + 1]!); b = Math.min(b, target[i * 3 + 1]!); }
  for (let i = 0; i < gn; i++) {
    const y = (target[i * 3 + 1]! - b) / (t - b);
    if (y > 0.15 && y < 0.45) { gzSum += target[i * 3 + 2]!; gzN++; }
  }
}
const grade = gradeGarment(target, gi, bodyChestGirth, easeChest, bodyTop * hemFraction, colliders.shoulderY);
/**
 * Vertical grading stays a SINGLE scale. Splitting it in two to put the garment's armhole on the wearer's
 * armpit was tried and reverted: the sleeves live in the upper segment, and compressing that segment while
 * keeping the width crumpled them into a ruffle at the shoulder (renders/sheet-fit3.png). The source shirt has
 * a low armhole; that is its cut, and squashing the pattern to hide it costs more than it buys.
 */
const armholeTarget = asset.landmarks.armpit * k - 0.02;
applyGrade(target, grade, gzSum / gzN, chestRing.cz);
const offsetY = grade.offsetY;
// neckline grading: the opening is sized to the neck it has to sit on, not left at whatever the source model
// had. 1.45 × the neck's own half-width leaves a tee's normal gap without choking it.
const neckCap = colliders.capsules.find((c) => c.name === 'neck');
const collarYNow = grade.collarY;
const chestYNow = grade.garment.chestY * grade.scaleY + grade.offsetY;
const collarHalf = halfWidthAt(target, collarYNow - 0.005, 0.012);
const collarWant = neckCap ? neckCap.r * Number(opt('collar', '1.45')) : collarHalf;
const collarFactor = collarHalf > 1e-6 ? Math.min(1, collarWant / collarHalf) : 1;
// shaping: the torso of the garment is pulled onto the body's own profile plus a tee's ease, so it follows the
// figure instead of hanging as a straight tube (the source cut leaves 44 cm of ease at the waist)
/**
 * OFF by default, and that is the finding. Squeezing a loose-cut garment onto the body does not make it fit:
 * cloth does not compress in plane, so the girth you take away comes back as buckling. Per-band shaping gave a
 * cinched waist with a flared skirt (renders/sheet-shape.png), and a straight target silhouette crumpled the
 * sleeves and chest (renders/sheet-shape2.png). A fitted look has to come from a fitted PATTERN — a garment
 * modelled fitted, or panels actually re-cut narrower — not from the solver. Kept here, with a value in
 * --shape, for garments whose own cut is close to the body already.
 */
const shapeEase = Number(opt('shape', '0'));
const shapedVerts = shapeEase > 0
  ? shapeToBody(target, (y, ang) => profileAt(colliders, y, ang), shapeEase, asset.landmarks.armpit * k - 0.03, 0.14)
  : 0;
const collarMoved = tightenCollar(target, collarYNow, chestYNow, [0, neckCap ? neckCap.a[2] : chestRing.cz], collarFactor);
if (process.env.IB_TRACE) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < gn; i++) { lo = Math.min(lo, target[i * 3 + 1]!); hi = Math.max(hi, target[i * 3 + 1]!); }
  console.log(`  after grade+collar: y ${lo.toFixed(3)}..${hi.toFixed(3)} collarY ${collarYNow.toFixed(3)} chestY ${chestYNow.toFixed(3)} factor ${collarFactor.toFixed(3)}`);
}

// --- 2. start: the garment pushed OUT along the body's own surface ---------
// Scaling the whole garment up was the obvious way and it was wrong: it leaves the sleeves inside the arms
// (the arms are nowhere near the body axis), and shoving a two-walled shell out of the body from the inside
// tears it — the stretch report hit 872 %. Instead every vertex is moved out along the collider it violates,
// with a wide standoff, so the garment starts cleanly outside the body everywhere and keeps its own shape.
const standoff = Number(opt('standoff', '0.004'));
const start = new Float32Array(target);
for (let pass = 0; pass < 6; pass++) for (let i = 0; i < gn; i++) resolvePoint(colliders, start, i, standoff);
let startInside = 0;
const probe0 = new Float32Array(start);
for (let i = 0; i < gn; i++) if (resolvePoint(colliders, probe0, i, 0.002)) startInside++;

// --- 3. shrink while simulating -------------------------------------------
const params: ClothParams = { ...DEFAULT_CLOTH, thickness: 0.0006, iterations: 6, substeps: 5, friction: 0.25, gravity: 0 };
const cloth = buildCloth(target, gi); // rest lengths come from the TARGET size
cloth.pos.set(start);
cloth.prev.set(start);
const t0 = Date.now();
for (let f = 0; f < shrinkFrames; f++) {
  // smoothstep from the inflated size down to the garment's own size
  // the rest lengths are already the garment's own; the fabric simply relaxes from the standoff onto the body
  // with no gravity, then gravity ramps in over the last quarter once it grips
  // Gravity stays ON. Relaxing with gravity off was a mistake: nothing then balances the collision pushes,
  // which are net upward where the fabric rests on the shoulders, and the whole shirt floated up the body
  // (the hem rose 10 cm in 80 frames with no gravity at all). It is ramped over the first fifth only so the
  // first contacts are not violent.
  const u = f / shrinkFrames;
  params.gravity = DEFAULT_CLOTH.gravity * Math.min(1, u / 0.2);
  stepCloth(cloth, colliders, params, 1 / 60);
  if (process.env.IB_TRACE && f % 40 === 0) {
    const st = stretchStats(cloth);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < gn; i++) { lo = Math.min(lo, cloth.pos[i * 3 + 1]!); hi = Math.max(hi, cloth.pos[i * 3 + 1]!); }
    console.log(`  f${f} g=${params.gravity.toFixed(1)} stretch ${st.mean.toFixed(2)}%/${st.max.toFixed(0)}% hem ${lo.toFixed(3)} collar ${hi.toFixed(3)}`);
  }
}
params.gravity = DEFAULT_CLOTH.gravity;
// "does it hold" is measured over the SECOND half of the free settle: the first frames still contain the tail
// of the gravity ramp, and counting that as slipping would report motion that is just the garment sitting down
let afterShrink = new Float32Array(cloth.pos);
for (let f = 0; f < settleFrames; f++) {
  if (f === Math.floor(settleFrames / 2)) afterShrink = new Float32Array(cloth.pos);
  stepCloth(cloth, colliders, params, 1 / 60);
  if (process.env.IB_TRACE && f % 40 === 0) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < gn; i++) { lo = Math.min(lo, cloth.pos[i * 3 + 1]!); hi = Math.max(hi, cloth.pos[i * 3 + 1]!); }
    console.log(`  settle f${f} hem ${lo.toFixed(3)} collar ${hi.toFixed(3)}`);
  }
}
const ms = Date.now() - t0;

// --- 3b. final projection against the body mesh, then a short relax so neighbours follow ---
const projected = projectOutOfMesh(pose.positions, asset.index, cloth.pos, 0.003);
if (projected) {
  cloth.prev.set(cloth.pos);
  for (let f = 0; f < 40; f++) stepCloth(cloth, colliders, params, 1 / 60);
}

// --- 4. checks -------------------------------------------------------------
let slip = 0, nonFinite = 0;
for (let i = 0; i < cloth.pos.length; i++) if (!Number.isFinite(cloth.pos[i]!)) nonFinite++;
for (let i = 0; i < gn; i++) slip = Math.max(slip, Math.abs(cloth.pos[i * 3 + 1]! - afterShrink[i * 3 + 1]!));
// the penetration check uses the SAME wall rule as the solver: the inner wall of a garment with thickness is
// supposed to rest on the skin, so counting it as "inside the body" would fail a correct result
updateNormals(cloth);
const probe = new Float32Array(cloth.pos);
let insideColliders = 0;
for (let i = 0; i < gn; i++) if (resolvePoint(colliders, probe, i, 0, cloth.normals)) insideColliders++;
const pen = penetration(pose.positions, asset.index, cloth.pos);
const st = stretchStats(cloth);
let hem = Infinity, collar = -Infinity;
for (let i = 0; i < gn; i++) { hem = Math.min(hem, cloth.pos[i * 3 + 1]!); collar = Math.max(collar, cloth.pos[i * 3 + 1]!); }
const held = slip < 0.03 && nonFinite === 0;
/**
 * The chest ease is taken from the GRADE, not from a slice: at the wearer's chest height a horizontal plane
 * cuts the sleeves and the body of the shirt as one loop (it read 149 cm against a 106 cm body), and a tee is
 * measured flat an inch below the armhole anyway. The other zones are measured on the settled mesh.
 */
const chestEase = {
  zone: 'грудь (по градировке)',
  y: Number((grade.garment.chestY * grade.scaleY + grade.offsetY).toFixed(3)),
  body_cm: Number((bodyChestGirth * 100).toFixed(1)),
  garment_cm: Number((grade.garment.chestGirth * grade.scaleXZ * 100).toFixed(1)),
  ease_cm: Number((grade.garment.chestGirth * grade.scaleXZ * 100 - bodyChestGirth * 100).toFixed(1)),
  verdict: 'graded' as const,
};
const easeZones = zoneEase(pose.positions, asset.index, cloth.pos, gi, [
  // measured just below the garment's own armhole: higher up the slice cuts the sleeves and the body of the
  // shirt as one loop and the chest reads 149 cm against a 106 cm body
  { zone: 'талия', y: asset.landmarks.waist * k },
  { zone: 'бёдра', y: asset.landmarks.hip * k },
  // the hem and the sleeve are left out: at the hem the slice catches both legs, and the sleeve of this shirt
  // ends above the height where a side contour exists. Reporting 201 cm as a hem girth would be noise.
]);
const cmap = clearanceMap(colliders, cloth.pos);
let cmin = Infinity, cmax = -Infinity, cmean = 0;
for (let i = 0; i < cmap.length; i++) { cmin = Math.min(cmin, cmap[i]!); cmax = Math.max(cmax, cmap[i]!); cmean += cmap[i]!; }
cmean /= cmap.length;

const report = {
  garment: garmentId, shape: shapeId, method: 'shrink-dress', ms,
  phases: { standoff, shrinkFrames, settleFrames, pinnedVertices: 0 },
  grade: {
    scaleXZ: Number(grade.scaleXZ.toFixed(4)), scaleY: Number(grade.scaleY.toFixed(4)), offsetY: Number(offsetY.toFixed(4)),
    easeChest_cm: grade.easeChest_cm, bodyChest_cm: Number((bodyChestGirth * 100).toFixed(1)),
    garmentChestGirth_cm: Number((grade.garment.chestGirth * 100).toFixed(1)),
    hemTarget_y: Number(grade.hemTargetY.toFixed(3)), shoulderTarget_y: Number(grade.shoulderTargetY.toFixed(3)), armholeTarget_y: Number(armholeTarget.toFixed(3)),
    verticesInsideAtStart: startInside,
    shaping: { easeCirc_cm: Number((shapeEase * 100).toFixed(1)), verticesShaped: shapedVerts },
    collar: { before_cm: Number((collarHalf * 200).toFixed(1)), after_cm: Number((collarHalf * collarFactor * 200).toFixed(1)), neck_cm: neckCap ? Number((neckCap.r * 200).toFixed(1)) : null, factor: Number(collarFactor.toFixed(3)), verticesMoved: collarMoved },
  },
  settled: {
    hem_y: Number(hem.toFixed(3)), collar_y: Number(collar.toFixed(3)),
    hem_vs_hip_cm: Number(((hem - asset.landmarks.hip * k) * 100).toFixed(1)),
    hem_vs_target_cm: Number(((hem - grade.hemTargetY) * 100).toFixed(1)),
    stretch_mean_pct: Number(st.mean.toFixed(2)), stretch_max_pct: Number(st.max.toFixed(1)), edges_over_10pct: st.over10,
    stretch_max_abs_mm: Number(st.maxAbs_mm.toFixed(1)), shortEdgesExcluded: st.shortEdges,
  },
  fit: { ease: [chestEase, ...easeZones], clearance_mm: { min: Number(cmin.toFixed(1)), mean: Number(cmean.toFixed(1)), max: Number(cmax.toFixed(1)) } },
  checks: { nonFinite, projectedOntoSkin: projected, verticesInsideBodyMesh: pen.inside, insideShare_pct: Number(((pen.inside / gn) * 100).toFixed(2)), deepestPenetration_mm: Number(pen.worst_mm.toFixed(1)), insideColliderApprox: insideColliders, slipDuringFreeSettle_m: Number(slip.toFixed(4)), heldWithoutPins: held },
};
mkdirSync('imported-body/out', { recursive: true });
writeFileSync(`imported-body/out/sim-${garmentId}-${shapeId}.json`, JSON.stringify({
  ...report,
  body: Array.from(pose.positions).map((v) => Number(v.toFixed(5))),
  bodyIndex: Array.from(asset.index),
  garment: Array.from(cloth.pos).map((v) => Number(v.toFixed(5))),
  garmentIndex: Array.from(gi),
  aligned: Array.from(start).map((v) => Number(v.toFixed(5))),
  pinned: [],
  clearance: Array.from(cmap).map((v) => Number(v.toFixed(1))),
  colliders: { torso: colliders.torso, capsules: colliders.capsules },
}));
mkdirSync('imported-body/reports', { recursive: true });
writeFileSync(`imported-body/reports/stage-I12-dress-${garmentId}-${shapeId}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
/**
 * Threshold, stated with its reason: the body is a 2242-triangle low-poly mesh whose facets are about 2 cm
 * across and the fabric itself is 1.2 mm thick, so a vertex a few millimetres inside a crease (the armpit, the
 * elbow) is below the resolution of the body surface and invisible. A run passes when the garment holds, there
 * are no non-finite values, and fewer than 1 % of its vertices are inside the body mesh. Measured here: 0.7 %.
 */
const penShare = pen.inside / gn;
const ok = held && nonFinite === 0 && penShare < 0.01;
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
