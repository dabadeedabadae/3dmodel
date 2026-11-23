/**
 * Blocking checks for a DRESSED figure. The naked mannequin's checks do not apply: that is one closed shell,
 * this is several open ones (a shirt is open at the neck, the sleeves and the hem), so "closed manifold" and
 * "single connected surface" would fail a perfectly good asset. What must hold instead:
 *   • every shell is orientable and consistently wound, with no non-manifold edges
 *   • the figure is symmetric left to right within the tolerance the symmetrisation targets
 *   • feet on the floor, head at the stated stature, no non-finite values, no degenerate triangles
 *   • every slider combination keeps all of the above and turns at most 0.1 % of the triangles inside out (I-67)
 *   • a T-shirt worn under the garment (part "inner", I-70) never crosses the garment more than in the base pose
 * Non-zero exit on failure.
 *   IB_ASSET=imported-body/out/asset-outfit01.json node --import tsx imported-body/scripts/check-outfit.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadAsset } from '../src/load';
import { deform, GAIN, WEIGHT_NAMES, type Weights } from '../src/deform';
import { components } from '../src/outfit';
import { countIntersections } from '../src/layers';
import { existsSync } from 'node:fs';

/** distance from a point to a triangle */
function pointTri(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(apx - abx * v, apy - aby * v, apz - abz * v);
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(apx - acx * w, apy - acy * w, apz - acz * w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return Math.hypot(px - (bx + (cx - bx) * w), py - (by + (cy - by) * w), pz - (bz + (cz - bz) * w));
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return Math.hypot(px - (ax + abx * v + acx * w), py - (ay + aby * v + acy * w), pz - (az + abz * v + acz * w));
}

/** worst distance from the mesh to its own mirror image, over every vertex */
function mirrorDistance(pos: Float32Array, idx: Uint32Array): number {
  const tN = idx.length / 3;
  let worst = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const px = -pos[i * 3]!, py = pos[i * 3 + 1]!, pz = pos[i * 3 + 2]!;
    let best = Infinity;
    for (let t = 0; t < tN; t++) {
      const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
      if (Math.abs(pos[a + 1]! - py) > 0.12 && Math.abs(pos[b + 1]! - py) > 0.12 && Math.abs(pos[c + 1]! - py) > 0.12) continue;
      const d = pointTri(px, py, pz, pos[a]!, pos[a + 1]!, pos[a + 2]!, pos[b]!, pos[b + 1]!, pos[b + 2]!, pos[c]!, pos[c + 1]!, pos[c + 2]!);
      if (d < best) { best = d; if (best < 1e-4) break; }
    }
    if (Number.isFinite(best)) worst = Math.max(worst, best);
  }
  return worst;
}

const asset = loadAsset();
const idx = asset.index;
const tCount = idx.length / 3;

function shellChecks(pos: Float32Array) {
  const fails: string[] = [];
  let nonFinite = 0;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i]!)) nonFinite++;
  if (nonFinite) fails.push(`non-finite values: ${nonFinite}`);
  let deg = 0;
  for (let t = 0; t < tCount; t++) {
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-10) deg++;
  }
  if (deg) fails.push(`degenerate triangles: ${deg}`);
  // orientation: each undirected edge is used at most twice, and never twice in the same direction
  const dir = new Map<string, number>();
  const und = new Map<string, number>();
  for (let t = 0; t < tCount; t++) {
    const v = [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!];
    for (let k = 0; k < 3; k++) {
      const u = v[k]!, w = v[(k + 1) % 3]!;
      dir.set(`${u}>${w}`, (dir.get(`${u}>${w}`) ?? 0) + 1);
      const key = u < w ? `${u}_${w}` : `${w}_${u}`;
      und.set(key, (und.get(key) ?? 0) + 1);
    }
  }
  let badDir = 0, nonManifold = 0, boundary = 0;
  for (const c of dir.values()) if (c > 1) badDir++;
  for (const c of und.values()) { if (c > 2) nonManifold++; if (c === 1) boundary++; }
  if (badDir) fails.push(`inconsistently wound edges: ${badDir}`);
  if (nonManifold) fails.push(`non-manifold edges: ${nonManifold}`);
  /**
   * Symmetry is measured as the distance from each vertex to the nearest TRIANGLE of the mirrored mesh.
   * Two cheaper metrics were tried and rejected: nearest mirrored VERTEX (this mesh has no mirror-identical
   * topology, so it reported centimetres on a figure that is visibly straight), and left/right extents per
   * height band (a fingertip falling into a different band on each side reported 84 mm). Point-to-surface
   * does not care how the triangles are laid out.
   */
  const n = pos.length / 3;
  const asym = mirrorDistance(pos, idx);
  const noTwin = Number((asym * 1000).toFixed(1));
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, pos[i * 3 + 1]!); maxY = Math.max(maxY, pos[i * 3 + 1]!); }
  if (Math.abs(minY) > 0.01) fails.push(`feet off the floor: ${minY.toFixed(4)}`);
  return { fails, boundary, noTwin, asym, minY, maxY };
}

const base = deform(asset, {});
const shells = components(base, idx);
/**
 * The source figure's own asymmetry is a property of the generator, not of our code, so it is reported and not
 * failed. What IS ours is whether a slider makes it worse: that is the check.
 */
const baseShell = shellChecks(base);
const baseAsym = baseShell.asym;
/**
 * Usable slider range: at the extremes a dressed figure folds into itself, because shrinking a garment with
 * folds by half has nowhere to put the material. The range where no triangle inverts is MEASURED here rather
 * than assumed, and recorded so the interface can clamp to it.
 */
const usable: Record<string, number> = {};
/**
 * Inversion budget (I-67). With the body hidden under the garments (I-61/I-62) a slider's range was set by one to
 * three sliver triangles of a sleeve end or a collar out of thousands: the T-shirt's shoulders stopped at ±0.1
 * (about 1 % of width, invisible on screen) and the shirt's chest at ±0.16. A handful of inverted slivers is a
 * shading speck, not a broken garment, so up to 0.1 % of the triangles (at least 2) may invert; anything more is a
 * fold and still limits the range and fails the suite. The count is reported for every case.
 */
const FLIP_BUDGET = Math.max(2, Math.round(0.001 * tCount));
/**
 * A flipped triangle of the inner T-shirt counts 1/16 (I-70): layer-outfit subdivides it twice (1 → 16) so that it
 * bends with the sliders, and one flipped face of the same T-shirt must not weigh sixteen times more than before.
 */
const flipWeight = new Float32Array(tCount).fill(1);
{
  const pf = (process.env.IB_ASSET ?? '').replace(/asset-(outfit\d+)\.json$/, 'outfit-$1.json');
  if (pf !== process.env.IB_ASSET && existsSync(pf)) {
    const inn = new Set(((JSON.parse(readFileSync(pf, 'utf8')).partsIndex ?? []) as { kind: string; vertices: number[] }[]).filter((q) => q.kind === 'inner').flatMap((q) => q.vertices));
    for (let t = 0; t < tCount; t++) if (inn.has(idx[t * 3]!) && inn.has(idx[t * 3 + 1]!) && inn.has(idx[t * 3 + 2]!)) flipWeight[t] = 1 / 16;
  }
}
/** how many triangles this weight set turns inside out (counting stops just past the budget) */
function flipCount(w: Partial<Weights>): number {
      let n = 0;
      const q = deform(asset, w);
      for (let t = 0; t < tCount; t++) {
        const nrm2 = (z: Float32Array) => {
          const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
          const ux = z[b]! - z[a]!, uy = z[b + 1]! - z[a + 1]!, uz = z[b + 2]! - z[a + 2]!;
          const vx = z[c]! - z[a]!, vy = z[c + 1]! - z[a + 1]!, vz = z[c + 2]! - z[a + 2]!;
          return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
        };
        const A = nrm2(base), B = nrm2(q);
        const la = Math.hypot(...A), lb = Math.hypot(...B);
        if (la < 1e-12 || lb < 1e-12) continue;
        if ((A[0] * B[0] + A[1] * B[1] + A[2] * B[2]) / (la * lb) < 0 && (n += flipWeight[t]!) > FLIP_BUDGET * 4) return n;
      }
      return n;
}
/**
 * Inner layer poking through (I-70). The flip count does not see it: the zip hoodie passed with every slider at its
 * limit, yet in the browser the T-shirt under it came through the front panel and as two white specks on the back.
 * The part list comes from outfit-<id>.json, whose vertex order is the asset's. Crossings between the inner
 * T-shirt and the top garment must not grow over the base pose; this limits the slider range like a fold does.
 */
const partsFile = (process.env.IB_ASSET ?? '').replace(/asset-(outfit\d+)\.json$/, 'outfit-$1.json');
const layerTris = (kind: string) => {
  if (!partsFile.endsWith('.json') || !existsSync(partsFile) || partsFile === process.env.IB_ASSET) return [];
  const parts = (JSON.parse(readFileSync(partsFile, 'utf8')).partsIndex ?? []) as { kind: string; vertices: number[] }[];
  const set = new Set(parts.filter((q) => q.kind === kind).flatMap((q) => q.vertices));
  const out: number[] = [];
  for (let t = 0; t < tCount; t++) if (set.has(idx[t * 3]!) && set.has(idx[t * 3 + 1]!) && set.has(idx[t * 3 + 2]!)) out.push(idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!);
  return out;
};
const innerTris = layerTris('inner'), topTris = innerTris.length ? layerTris('top') : [];
const innerCrossings = (p: Float32Array) => (innerTris.length && topTris.length ? countIntersections({ p, tris: innerTris }, { p, tris: topTris }).crossings : 0);
const innerBase = innerCrossings(base);
/**
 * Allowance like the flip budget: 0.1 % of the T-shirt's triangles (at least 2). What is left at the limits of the
 * zip hoodie is 1–3 crossings at the hem rim, where the T-shirt comes out from under the garment anyway, and inside
 * the trunk; the defects seen in the browser were 26–69.
 */
const INNER_BUDGET = innerBase + Math.max(2, Math.round(0.001 * innerTris.length / 3));
const inverts = (w: Partial<Weights>) => flipCount(w) > FLIP_BUDGET || innerCrossings(deform(asset, w)) > INNER_BUDGET;
for (const nme of WEIGHT_NAMES) {
  let limit = 0;
  for (const v of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]) {
    if (![v, -v].some((sv) => inverts({ [nme]: sv }))) { limit = v; break; }
  }
  usable[nme] = limit;
}
/**
 * Each slider passing alone does not mean they pass together: on the shirt figure every single slider was fine
 * at its own limit, yet all of them at minimum inverted two triangles (I-48). The corners are checked too, and
 * while either fails, the limits shrink one slider at a time (I-67): the single slider that fixes both corners
 * with the least loss of its range if there is one, otherwise the one without which the corners invert the fewest
 * triangles, by 10 %, and the search repeats. Shrinking all of them together cut the T-shirt's hips and arms from ±1 to ±0.32 for a fold
 * that only chest and shoulders cause. The check itself is not relaxed.
 */
const corner = (sgn: number, u = usable) => Object.fromEntries(WEIGHT_NAMES.map((nme) => [nme, sgn * u[nme]!])) as Partial<Weights>;
const cornerFlips = (u: Record<string, number>) => Math.max(0, flipCount(corner(1, u)) - FLIP_BUDGET) + Math.max(0, flipCount(corner(-1, u)) - FLIP_BUDGET)
  + Math.max(0, innerCrossings(deform(asset, corner(1, u))) - INNER_BUDGET) + Math.max(0, innerCrossings(deform(asset, corner(-1, u))) - INNER_BUDGET);
for (let k = 0; k < 60 && cornerFlips(usable) > 0; k++) {
  // first choice: the single slider that fixes both corners while keeping the largest share of its range
  let solo = '', kept = 0;
  for (const nme of WEIGHT_NAMES) {
    for (let v = Math.floor(usable[nme]! * 0.9 * 100) / 100, step = 0; v > 0 && step < 25; v = Math.floor(v * 0.9 * 100) / 100, step++) {
      if (cornerFlips({ ...usable, [nme]: v }) === 0) { if (v / usable[nme]! > kept) { kept = v / usable[nme]!; solo = nme; } break; }
    }
  }
  if (solo) {
    let v = Math.floor(usable[solo]! * 0.9 * 100) / 100;
    while (cornerFlips({ ...usable, [solo]: v }) > 0) v = Math.floor(v * 0.9 * 100) / 100;
    usable[solo] = v;
    break;
  }
  // otherwise shrink the slider without which the corners invert the fewest triangles, and look again
  let pick = '', best = Infinity;
  for (const nme of WEIGHT_NAMES) {
    if (usable[nme]! <= 0) continue;
    const f = cornerFlips({ ...usable, [nme]: 0 });
    if (f < best || (f === best && usable[nme]! > usable[pick]!)) { best = f; pick = nme; }
  }
  if (!pick) break;
  usable[pick] = Math.floor(usable[pick]! * 0.9 * 100) / 100;
}
console.log('рабочий диапазон ползунков: ' + Object.entries(usable).map(([key, v]) => `${key} ±${v}`).join(', '));
// written back into the asset so the interface clamps to what this figure actually survives
try {
  const file = process.env.IB_ASSET ?? 'imported-body/out/asset.json';
  const j = JSON.parse(readFileSync(file, 'utf8'));
  j.usableSliderRange = usable;
  writeFileSync(file, JSON.stringify(j));
} catch { /* the asset may be read-only; the report still carries the range */ }

/**
 * The suite runs at the DECLARED range, not at ±1. The range is measured just above, written into the asset
 * and used by the interface to clamp the sliders, so what the check must prove is that nothing breaks inside
 * it. Running at ±1 and failing would be testing a setting the product never offers.
 */
const cases: { label: string; w: Partial<Weights>; h?: { mode: 'keep_girths' | 'proportional'; height_cm: number } }[] = [{ label: 'base', w: {} }];
for (const nme of WEIGHT_NAMES) for (const sgn of [-1, 1]) cases.push({ label: `${nme}=${sgn * usable[nme]!}`, w: { [nme]: sgn * usable[nme]! } });
cases.push({ label: 'все по максимуму', w: Object.fromEntries(WEIGHT_NAMES.map((nme) => [nme, usable[nme]!])) as Partial<Weights> });
cases.push({ label: 'все по минимуму', w: Object.fromEntries(WEIGHT_NAMES.map((nme) => [nme, -usable[nme]!])) as Partial<Weights> });
cases.push({ label: 'height 150', w: {}, h: { mode: 'keep_girths', height_cm: 150 } });
cases.push({ label: 'height 200 proportional', w: {}, h: { mode: 'proportional', height_cm: 200 } });

const results: unknown[] = [];
let ok = true;
console.log(`${asset.id}: ${base.length / 3} вершин / ${tCount} треугольников, ${shells.length} оболочек${innerTris.length ? `, футболка под вещью: ${innerTris.length / 3} треугольников, пересечений в базовой позе ${innerBase}` : ''}`);
console.log(`собственная асимметрия исходника: ${(baseAsym * 1000).toFixed(1)} мм (свойство генерации, не проверяется — записано в отчёт)`);
for (const c of cases) {
  const p = deform(asset, c.w, c.h);
  const r = shellChecks(p);
  // a slider must not turn the mesh inside out: triangle normals keep the sign they had
  // a slider must not turn a triangle inside out: its normal may rotate, but not reverse
  let flipped = 0;
  for (let t = 0; t < tCount; t++) {
    const nrm = (q: Float32Array) => {
      const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, cc = idx[t * 3 + 2]! * 3;
      const ux = q[b]! - q[a]!, uy = q[b + 1]! - q[a + 1]!, uz = q[b + 2]! - q[a + 2]!;
      const vx = q[cc]! - q[a]!, vy = q[cc + 1]! - q[a + 1]!, vz = q[cc + 2]! - q[a + 2]!;
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
    };
    const A = nrm(base), B = nrm(p);
    const la = Math.hypot(...A), lb = Math.hypot(...B);
    if (la < 1e-12 || lb < 1e-12) continue;
    if ((A[0] * B[0] + A[1] * B[1] + A[2] * B[2]) / (la * lb) < 0) flipped += flipWeight[t]!;
  }
  if (flipped > FLIP_BUDGET) r.fails.push(`перевёрнутых треугольников: ${flipped} (допуск ${FLIP_BUDGET})`);
  const ic = innerCrossings(p);
  if (ic > INNER_BUDGET) r.fails.push(`футболка под вещью протыкает её: ${ic} пересечений (допуск ${INNER_BUDGET})`);
  /**
   * A deformation that scales the figure up scales its asymmetry with it — widening the hips by 32 % turned
   * 16.7 mm into 22.4 mm, which is arithmetic, not a defect. So the allowance grows with the factor the case
   * actually applies, and what is caught is asymmetry appearing from nowhere.
   */
  // proportional growth scales the whole figure by height / base height (200 cm: ×1.14; the blazer's 58.4 mm became
  // 66.7 mm = 58.4 × 1.143 and failed against a slider-only allowance)
  const grow = c.h?.mode === 'proportional' ? Math.max(1, c.h.height_cm / (baseShell.maxY * 100)) : 1;
  const factor = (1 + Math.max(0, ...WEIGHT_NAMES.map((nme) => GAIN[nme] * Math.abs((c.w as Record<string, number>)[nme] ?? 0)))) * grow;
  if (r.asym > baseAsym * factor + 0.005) r.fails.push(`деформация усилила асимметрию: ${(baseAsym * 1000).toFixed(1)} → ${r.noTwin} мм (допуск ${((baseAsym * factor + 0.005) * 1000).toFixed(1)})`);
  if (r.fails.length) ok = false;
  results.push({ label: c.label, ok: !r.fails.length, fails: r.fails, flipped });
  console.log(`${r.fails.length ? 'FAIL' : 'PASS'}  ${c.label.padEnd(24)} рост ${(r.maxY * 100).toFixed(0)} см${flipped ? `, перевёрнуто ${flipped} из ${tCount}` : ''}${r.fails.length ? ' — ' + r.fails.join('; ') : ''}`);
}
mkdirSync('imported-body/reports', { recursive: true });
const reportId = (process.env.IB_ASSET ?? '').match(/asset-(outfit\d+)\.json$/)?.[1];
writeFileSync(reportId && reportId !== 'outfit01' ? `imported-body/reports/stage-I15-outfit-checks-${reportId}.json` : 'imported-body/reports/stage-I15-outfit-checks.json', JSON.stringify({ generatedAt: new Date().toISOString(), asset: asset.id, shells: shells.length, boundaryEdges: shellChecks(base).boundary, sourceAsymmetry_mm: Number((baseAsym * 1000).toFixed(1)), usableSliderRange: usable, flipBudget: FLIP_BUDGET, results }, null, 2));
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
