/**
 * Blocking check for the fitter: documented cases must reach their targets, impossible ones must say so.
 * Thresholds come from config/fit.json and were fixed before these cases were evaluated.
 *   node --import tsx imported-body/scripts/check-fit.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadAsset } from '../src/load';
import { fitToMeasurements, type FitRequest } from '../src/fit';
import { deform } from '../src/deform';
import { poseIsClean } from '../src/pose';
import C from '../config/fit.json';

const asset = loadAsset();
const cases: { id: string; req: FitRequest; expect: ('ok' | 'approximate' | 'out_of_range')[] }[] = [
  { id: 'canon-base', req: { targets: { chest: 105.8, waist: 72.1, hip: 86.2 } }, expect: ['ok'] },
  { id: 'slim-male', req: { height_cm: 178, targets: { chest: 94, waist: 78, hip: 92 } }, expect: ['ok', 'approximate'] },
  { id: 'athletic', req: { height_cm: 183, targets: { chest: 110, waist: 82, hip: 96, bicep: 34 } }, expect: ['ok', 'approximate'] },
  { id: 'round', req: { height_cm: 172, targets: { chest: 112, waist: 104, hip: 108 } }, expect: ['ok', 'approximate'] },
  { id: 'held-out-1', req: { height_cm: 165, targets: { chest: 98, waist: 84, hip: 98, thigh: 56 } }, expect: ['ok', 'approximate'] },
  { id: 'held-out-2', req: { height_cm: 190, targets: { chest: 102, waist: 80, hip: 95 } }, expect: ['ok', 'approximate'] },
  { id: 'impossible-huge', req: { targets: { chest: 170, waist: 160, hip: 165 } }, expect: ['out_of_range'] },
  { id: 'impossible-tiny', req: { targets: { chest: 55, waist: 40, hip: 50 } }, expect: ['out_of_range'] },
];
const out: any[] = [];
let ok = true;
for (const c of cases) {
  const t0 = Date.now();
  const r = fitToMeasurements(asset, c.req);
  const statusOk = c.expect.includes(r.status as any);
  // whatever the fitter returns must still be a valid body
  const failed = poseIsClean(asset, deform(asset, r.weights, { mode: c.req.heightMode ?? 'keep_girths', height_cm: r.height_cm }));
  if (!statusOk || failed.length) ok = false;
  out.push({ ...c, result: r, geometry: failed });
  console.log(
    `${statusOk && !failed.length ? 'PASS' : 'FAIL'}  ${c.id.padEnd(16)} ${r.status.padEnd(12)} residual ${JSON.stringify(r.residual_cm)} weights ${JSON.stringify(
      Object.fromEntries(Object.entries(r.weights).filter(([, v]) => v !== 0).map(([k, v]) => [k, Number((v as number).toFixed(3))])),
    )}${r.limiting.length ? ' limiting ' + r.limiting.join(',') : ''} ${r.iterations} it ${Date.now() - t0} ms${failed.length ? ' — GEOMETRY ' + failed.join('; ') : ''}`,
  );
}
mkdirSync('imported-body/reports', { recursive: true });
writeFileSync('imported-body/reports/stage-I05-fit.json', JSON.stringify({ generatedAt: new Date().toISOString(), config: C, cases: out }, null, 2));
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
