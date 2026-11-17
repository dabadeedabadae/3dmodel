/**
 * Blocking check for the imported body: every slider combination must still produce a mesh that passes the same
 * geometry checks as the procedural model. Non-zero exit on any failure.
 *   node --import tsx imported-body/scripts/check.ts
 */
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { checkBodyMesh } from '../src/geom/meshChecks';
import { loadAsset } from '../src/load';
import { deform, WEIGHT_NAMES, type Weights } from '../src/deform';
import { measureImported } from '../src/measure';

const asset = loadAsset();
const cases: { label: string; w: Partial<Weights>; h?: { mode: 'keep_girths' | 'proportional'; height_cm: number } }[] = [
  { label: 'base', w: {} },
];
for (const n of WEIGHT_NAMES) for (const v of [-1, -0.5, 0.5, 1]) cases.push({ label: `${n}=${v}`, w: { [n]: v } });
cases.push({ label: 'all+1', w: { chest: 1, waist: 1, hip: 1, shoulders: 1, arms: 1, thighs: 1 } });
cases.push({ label: 'all-1', w: { chest: -1, waist: -1, hip: -1, shoulders: -1, arms: -1, thighs: -1 } });
cases.push({ label: 'athletic', w: { chest: 0.8, waist: -0.6, hip: -0.2, shoulders: 1, arms: 0.7, thighs: 0.4 } });
cases.push({ label: 'round', w: { chest: 0.4, waist: 1, hip: 0.8, shoulders: -0.3, arms: 0.2, thighs: 0.6 } });
cases.push({ label: 'height 150 keep', w: {}, h: { mode: 'keep_girths', height_cm: 150 } });
cases.push({ label: 'height 195 keep', w: {}, h: { mode: 'keep_girths', height_cm: 195 } });
cases.push({ label: 'height 195 proportional', w: {}, h: { mode: 'proportional', height_cm: 195 } });

const results: any[] = [];
let ok = true;
for (const c of cases) {
  const p = deform(asset, c.w, c.h);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(Array.from(asset.index));
  let maxY = -Infinity;
  for (let i = 0; i < p.length / 3; i++) maxY = Math.max(maxY, p[i * 3 + 1]!);
  const r = checkBodyMesh({ geometry: g, frame: { height: maxY } } as any, { minTriangles: 1500, maxTriangles: 3000 });
  const m = measureImported(asset, p);
  const failed = r.checks.filter((x) => !x.pass && x.level === 'fail');
  if (failed.length) ok = false;
  results.push({ label: c.label, ok: failed.length === 0, failed: failed.map((x) => `${x.name}: ${x.detail}`), m });
  console.log(
    `${failed.length ? 'FAIL' : 'PASS'}  ${c.label.padEnd(24)} h ${m.height_cm} chest ${m.chest_cm} waist ${m.waist_cm} hip ${m.hip_cm} torsoW ${m.torso_width_cm} bicep ${m.bicep_cm} thigh ${m.thigh_cm}` +
      (failed.length ? '  — ' + failed.map((x) => x.name).join(', ') : ''),
  );
  g.dispose();
}
mkdirSync('imported-body/reports', { recursive: true });
writeFileSync('imported-body/reports/stage-I02-checks.json', JSON.stringify({ generatedAt: new Date().toISOString(), asset: { id: asset.id, version: asset.version, topologyVersion: asset.topologyVersion }, results }, null, 2));
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
