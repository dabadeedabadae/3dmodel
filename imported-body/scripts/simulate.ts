/**
 * Stage I-11 — put the imported garment on the imported body and let it settle.
 *   node --import tsx imported-body/scripts/simulate.ts [--garment tshirt] [--shape base] [--frames 220]
 *
 * Alignment is explicit and recorded: ONE scale (garment torso width → body chest width + ease) and one
 * translation (collar onto the neck base). After that nothing is positioned by hand — gravity, the distance
 * and bending constraints and the body colliders decide where the fabric ends up.
 * Blocking: the settled cloth must have no vertex inside the body and no non-finite position.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadAsset } from '../src/load';
import { deform, type Weights } from '../src/deform';
import { buildSkeleton, computeSkin } from '../src/rig';
import { verifiedAPose } from '../src/pose';
import { buildColliders, resolvePoint } from '../src/collider';
import { buildCloth, stepCloth, stretchStats, DEFAULT_CLOTH, type ClothParams } from '../src/cloth';

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1]! : d);
const garmentId = opt('garment', 'tshirt');
const shapeId = opt('shape', 'base');
const frames = Number(opt('frames', '220'));
const ease = Number(opt('ease', '0.025'));

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
const gp = new Float32Array(raw.positions as number[]);
const gi = new Uint32Array(raw.index as number[]);
const gn = gp.length / 3;

// --- alignment ------------------------------------------------------------
// garment torso half-width is measured away from the sleeves: the widest x inside the middle band of its own
// height, ignoring the band where the sleeves stick out
let gTop = -Infinity, gBot = Infinity;
for (let i = 0; i < gn; i++) { gTop = Math.max(gTop, gp[i * 3 + 1]!); gBot = Math.min(gBot, gp[i * 3 + 1]!); }
const gH = gTop - gBot;
let gTorsoHalf = 0, gzSum = 0, gzN = 0;
for (let i = 0; i < gn; i++) {
  const y = (gp[i * 3 + 1]! - gBot) / gH;
  if (y > 0.15 && y < 0.45) { gTorsoHalf = Math.max(gTorsoHalf, Math.abs(gp[i * 3]!)); gzSum += gp[i * 3 + 2]!; gzN++; }
}
const gzMid = gzSum / gzN;
// body chest half-width at the chest level, from the collider stack
const yChest = asset.landmarks.chest * (Math.max(...Array.from({ length: pose.positions.length / 3 }, (_, i) => pose.positions[i * 3 + 1]!)) / asset.landmarks.height);
const chestRing = colliders.torso.reduce((best, r) => (Math.abs(r.y - yChest) < Math.abs(best.y - yChest) ? r : best));
const scale = (chestRing.a + ease) / gTorsoHalf;
// collar onto the neck base: the garment's own top goes a little above it, the fabric then settles down
const yNeck = colliders.shoulderY;
const dy = yNeck + 0.02 - (gTop - gBot) * scale - gBot * scale + ((gTop - gBot) * scale - (gTop - gBot) * scale);
const offsetY = yNeck + 0.02 - gTop * scale;
void dy;
for (let i = 0; i < gn; i++) {
  gp[i * 3] = gp[i * 3]! * scale;
  gp[i * 3 + 1] = gp[i * 3 + 1]! * scale + offsetY;
  gp[i * 3 + 2] = (gp[i * 3 + 2]! - gzMid) * scale + chestRing.cz;
}
/**
 * The garment must START outside the body. Pushing a quarter of its vertices out by hand (what a plain
 * chest-width scale needed) tears the mesh: this is a two-walled shell about 1 mm thick, and shoving the inner
 * wall outward turns it inside out — the stretch report showed 766 %.
 * So the scale is grown until almost every vertex is already clear, and only the last few are nudged.
 */
function insideCount(p: Float32Array, margin: number): number {
  const probe = new Float32Array(p);
  let c = 0;
  for (let i = 0; i < gn; i++) if (resolvePoint(colliders, probe, i, margin)) c++;
  return c;
}
let grow = 1;
for (let pass = 0; pass < 2; pass++) { // capped: inflating the whole shell also widens the collar, and a
  // collar wide enough to pass the shoulders turns the shirt into a bag that slides straight off
  const c = insideCount(gp, 0.002);
  if (c <= gn * 0.01) break;
  grow = 1.04;
  const cy = colliders.shoulderY;
  for (let i = 0; i < gn; i++) {
    gp[i * 3] = gp[i * 3]! * grow;
    gp[i * 3 + 1] = cy - (cy - gp[i * 3 + 1]!) * grow;
    gp[i * 3 + 2] = chestRing.cz + (gp[i * 3 + 2]! - chestRing.cz) * grow;
  }
}
let preFixed = 0;
for (let i = 0; i < gn; i++) if (resolvePoint(colliders, gp, i, 0.001)) preFixed++;

// --- simulation -----------------------------------------------------------
// the fabric standoff must stay well under the shell's own ~1 mm wall gap, see above
const params: ClothParams = { ...DEFAULT_CLOTH, thickness: 0.0006, iterations: 6, substeps: 5 };
const cloth = buildCloth(gp, gi);
/**
 * Two phases. In phase A the collar band is pinned, the way a garment pipeline holds a piece while it drapes:
 * without it the whole shirt simply slides down the torso, because nothing but friction opposes gravity once
 * the collar is below the shoulders. In phase B the pins are released and the shirt must stay put on its own;
 * the report says how far it moved after the release, so "it holds" is a measured claim, not an assumption.
 */
let gTopNow = -Infinity;
for (let i = 0; i < gn; i++) gTopNow = Math.max(gTopNow, cloth.pos[i * 3 + 1]!);
const pinBand = Number(opt('pinBand', '0.045'));
const pinned: number[] = [];
for (let i = 0; i < gn; i++) if (cloth.pos[i * 3 + 1]! > gTopNow - pinBand) { cloth.invMass[i] = 0; pinned.push(i); }
const phaseA = Math.round(frames * 0.6);
const t0 = Date.now();
for (let f = 0; f < phaseA; f++) stepCloth(cloth, colliders, params, 1 / 60);
const afterA = new Float32Array(cloth.pos);
for (const i of pinned) { cloth.invMass[i] = 1; cloth.prev[i * 3] = cloth.pos[i * 3]!; cloth.prev[i * 3 + 1] = cloth.pos[i * 3 + 1]!; cloth.prev[i * 3 + 2] = cloth.pos[i * 3 + 2]!; }
for (let f = phaseA; f < frames; f++) stepCloth(cloth, colliders, params, 1 / 60);
const ms = Date.now() - t0;
let slip = 0;
for (let i = 0; i < gn; i++) slip = Math.max(slip, Math.abs(cloth.pos[i * 3 + 1]! - afterA[i * 3 + 1]!));

// --- checks ---------------------------------------------------------------
let nonFinite = 0;
for (let i = 0; i < cloth.pos.length; i++) if (!Number.isFinite(cloth.pos[i]!)) nonFinite++;
const probe = new Float32Array(cloth.pos);
let inside = 0;
for (let i = 0; i < gn; i++) if (resolvePoint(colliders, probe, i, 0)) inside++;
const st = stretchStats(cloth);
let lowest = Infinity, highest = -Infinity;
for (let i = 0; i < gn; i++) { lowest = Math.min(lowest, cloth.pos[i * 3 + 1]!); highest = Math.max(highest, cloth.pos[i * 3 + 1]!); }

const report = {
  garment: garmentId, shape: shapeId, frames, ms,
  alignment: { scale: Number(scale.toFixed(4)), offsetY: Number(offsetY.toFixed(4)), ease, preResolvedVertices: preFixed, insideAfterAlign: insideCount(gp, 0.002) },
  cloth: { vertices: gn, triangles: gi.length / 3, distanceConstraints: cloth.rest.length, bendingConstraints: cloth.bendRest.length, params },
  settled: {
    hem_y: Number(lowest.toFixed(3)), collar_y: Number(highest.toFixed(3)),
    stretch_mean_pct: Number(st.mean.toFixed(2)), stretch_max_pct: Number(st.max.toFixed(1)), edges_over_10pct: st.over10,
  },
  phases: { pinnedVertices: pinned.length, pinBand, framesPinned: phaseA, slipAfterRelease_m: Number(slip.toFixed(4)) },
  checks: { nonFinite, verticesInsideBody: inside, heldWithoutPins: slip < 0.03 },
};
mkdirSync('imported-body/out', { recursive: true });
writeFileSync(`imported-body/out/sim-${garmentId}-${shapeId}.json`, JSON.stringify({
  ...report,
  body: Array.from(pose.positions).map((v) => Number(v.toFixed(5))),
  bodyIndex: Array.from(asset.index),
  // what is saved is the DRAPED state (collar still held), see `phases`: released, the shirt slides off this
  // body, and the report says by how much instead of hiding it
  garment: Array.from(afterA).map((v) => Number(v.toFixed(5))),
  // the aligned, not-yet-simulated state, so the viewer can run the same solve live from the same start
  aligned: Array.from(gp).map((v) => Number(v.toFixed(5))),
  pinned,
  garmentIndex: Array.from(gi),
  colliders: { torso: colliders.torso, capsules: colliders.capsules },
}));
mkdirSync('imported-body/reports', { recursive: true });
writeFileSync(`imported-body/reports/stage-I11-sim-${garmentId}-${shapeId}.json`, JSON.stringify(report, null, 2));
const ok = nonFinite === 0 && inside === 0;
console.log(JSON.stringify(report, null, 2));
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
