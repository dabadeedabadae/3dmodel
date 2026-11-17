/**
 * Blocking fit check (F02): the four checkpoint-C shirts (resolved params from
 * reports/stage-08-12-e2e.json) + the canonical tee × all body presets, in
 * "fit to body" mode: no vertex inside the body, arm axis inside the sleeves.
 * Also reports the "as photographed" statuses (informational).
 * Exit 1 on any failure. Writes reports/stage-F02-checks.json.
 *   npm run check:fit
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFrame } from '../src/body/anatomy';
import { BODY_PRESETS, defaultBodyParams } from '../src/body/params';
import { fitTShirtToBody } from '../src/fitting/fitTShirt';
import { defaultTShirtParams, type TShirtParams } from '../src/templates/tshirt/params';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'reports', 'stage-F02-checks.json');
const shirts: Record<string, TShirtParams> = { 'canonical-tee': defaultTShirtParams() };
const e2ePath = path.join(root, 'reports', 'stage-08-12-e2e.json');
if (existsSync(e2ePath)) {
  const e2e = JSON.parse(readFileSync(e2ePath, 'utf8')) as { cases: { label: string; paramLayers?: { resolved: TShirtParams } }[] };
  for (const c of e2e.cases) if (c.paramLayers?.resolved) shirts[c.label] = c.paramLayers.resolved;
}
const results: Record<string, unknown>[] = [];
let ok = true;
for (const pr of BODY_PRESETS) {
  const frame = computeFrame({ ...defaultBodyParams(pr.sex), ...pr.params });
  for (const [name, p] of Object.entries(shirts)) {
    const fit = fitTShirtToBody(p, frame, pr.id, { fitToBody: true });
    const photo = fitTShirtToBody(p, frame, pr.id, { fitToBody: false });
    const failed = fit.checks.filter((c) => !c.pass && c.level === 'fail').map((c) => `${c.name}: ${c.detail}`);
    if (failed.length) ok = false;
    results.push({ preset: pr.id, shirt: name, scale: fit.scale, status: fit.status, fitAdjust: fit.fitAdjust, pushedVertices: fit.pushedVertices, maxPush: fit.maxPush, rings: fit.rings.map((r) => `${r.ring}:${r.status}`), failed, asPhotographed: { status: photo.status, rings: photo.rings.map((r) => `${r.ring}:${r.status}`), checks: photo.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`) } });
    console.log(`${failed.length ? 'FAIL' : 'PASS'}  ${pr.id.padEnd(9)} ${name.padEnd(13)} fit:${fit.status.padEnd(10)} photo:${photo.status.padEnd(10)} adj:${fit.fitAdjust.map((a) => a.name).join(',') || '—'} push:${fit.pushedVertices}/${(fit.maxPush * 100).toFixed(1)}cm${failed.length ? ' — ' + failed.join('; ') : ''}`);
  }
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), shirts: Object.keys(shirts), presets: BODY_PRESETS.map((p) => p.id), results, ok }, null, 2));
console.log(`report: ${path.relative(root, out)}`);
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
