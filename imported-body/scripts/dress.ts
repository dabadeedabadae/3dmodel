/**
 * Stage I-08 — dressing the imported body with the TEMPLATE garment (no AI mesh per item).
 * Blocking: the fitter's own checks must pass on every shape (no garment vertex inside the body, the arm axis
 * stays inside the sleeve). Writes imported-body/out/dressed-<shape>.json for the viewer.
 *   node --import tsx imported-body/scripts/dress.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadAsset } from '../src/load';
import { deform, type Weights } from '../src/deform';
import { buildSkeleton, computeSkin } from '../src/rig';
import { verifiedAPose } from '../src/pose';
import { frameFromImported } from '../src/bridge';
import { fitTShirtToBody } from '../../src/fitting/fitTShirt';
import { buildTShirt } from '../../src/templates/tshirt/buildTShirt';
import { defaultTShirtParams, type TShirtParams } from '../../src/templates/tshirt/params';

const asset = loadAsset();
const shirts: Record<string, TShirtParams> = { 'canonical-tee': defaultTShirtParams() };
/**
 * The stored canonical tee is 0.72 long against a 0.44 chest half-width — a ratio of 1.6, while a real men's M
 * tee measures about 71 cm long against a 26 cm flat half-width, a ratio of 2.7. Fitted, it ends above the
 * waist on EVERY body, the procedural V1 one included (checked: 35 cm of garment against 45 cm from shoulder to
 * hip). The stored default is left untouched; this variant exists so the dressed renders show a real tee, and
 * it is labelled as a separate shirt, not as a fix applied behind the scenes.
 */
const realistic = { ...defaultTShirtParams(), length: 1.2, hemHalfWidth: 0.42, sleeveLength: 0.3 };
shirts['realistic-tee'] = realistic;
if (existsSync('reports/stage-08-12-e2e.json')) {
  const e2e = JSON.parse(readFileSync('reports/stage-08-12-e2e.json', 'utf8')) as { cases: { label: string; paramLayers?: { resolved: TShirtParams } }[] };
  for (const c of e2e.cases) if (c.paramLayers?.resolved) shirts[c.label] = c.paramLayers.resolved;
}
const shapes: { id: string; w: Partial<Weights>; h?: number }[] = [
  { id: 'base', w: {} },
  { id: 'athletic', w: { chest: 0.8, waist: -0.6, shoulders: 1, arms: 0.7, thighs: 0.4 } },
  { id: 'round', w: { chest: 0.4, waist: 1, hip: 0.8, arms: 0.2, thighs: 0.6 } },
  { id: 'slim', w: { chest: -0.6, waist: -0.8, hip: -0.5, arms: -0.6, thighs: -0.6 } },
  { id: 'tall', w: {}, h: 190 },
];
const out: Record<string, unknown>[] = [];
let ok = true;
mkdirSync('imported-body/out', { recursive: true });
for (const s of shapes) {
  const base = deform(asset, s.w, { mode: s.h ? 'proportional' : 'keep_girths', height_cm: s.h ?? asset.landmarks.height * 100 });
  const sk = computeSkin(asset, base, buildSkeleton(asset, base));
  const pose = verifiedAPose(asset, base, sk);
  if (!pose.verified) { ok = false; console.log(`FAIL  ${s.id} — A-поза не проверена: ${pose.failed.join('; ')}`); continue; }
  const { frame, assumed } = frameFromImported(asset, pose.positions);
  for (const [name, p] of Object.entries(shirts)) {
    const fit = fitTShirtToBody(p, frame, `${asset.id}:${s.id}`, { fitToBody: true });
    const failed = fit.checks.filter((c) => !c.pass && c.level === 'fail').map((c) => `${c.name}: ${c.detail}`);
    if (failed.length) ok = false;
    if (name === 'realistic-tee') {
      const tee = buildTShirt(fit.params);
      writeFileSync(
        `imported-body/out/dressed-${s.id}.json`,
        JSON.stringify({
          shape: s.id,
          body: Array.from(pose.positions).map((v) => Number(v.toFixed(5))),
          bodyIndex: Array.from(asset.index),
          garment: Array.from(fit.positions).map((v) => Number(v.toFixed(5))),
          garmentIndex: Array.from(tee.geometry.index!.array as Uint32Array),
          rings: fit.rings.map((r) => ({ ring: r.ring, status: r.status, clearance: r.clearance })),
          status: fit.status,
        }),
      );
      tee.geometry.dispose();
    }
    out.push({ shape: s.id, shirt: name, status: fit.status, scale: fit.scale, pushed: fit.pushedVertices, maxPush: fit.maxPush, fitAdjust: fit.fitAdjust.map((a) => a.name), rings: fit.rings.map((r) => `${r.ring}:${r.status}`), failed, assumed });
    console.log(`${failed.length ? 'FAIL' : 'PASS'}  ${s.id.padEnd(9)} ${name.padEnd(14)} ${fit.status.padEnd(10)} scale ${fit.scale.toFixed(3)} push ${fit.pushedVertices}/${(fit.maxPush * 100).toFixed(1)} см  ${fit.rings.map((r) => `${r.ring}:${r.status}`).join(' ')}${failed.length ? ' — ' + failed.join('; ') : ''}`);
  }
}
mkdirSync('imported-body/reports', { recursive: true });
writeFileSync('imported-body/reports/stage-I08-dress.json', JSON.stringify({ generatedAt: new Date().toISOString(), shirts: Object.keys(shirts), results: out }, null, 2));
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
