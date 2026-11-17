/**
 * Blocking geometry check for the procedural body. Exit 1 on any failing
 * check. Writes reports/stage-M02-checks.json.
 *   npm run check:body
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBody } from '../src/body/buildBody';
import { checkBodyFixedTopology, checkBodyMesh, sampleBodyParamSets } from '../src/body/checks';
import { BODY_PRESETS, BODY_TEMPLATE_ID, BODY_TEMPLATE_VERSION, BODY_TOPOLOGY_VERSION, defaultBodyParams } from '../src/body/params';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'reports', 'stage-M02-checks.json');
const N = Number(process.argv[2] ?? 300);

const presets = BODY_PRESETS.map((pr) => {
  const m = buildBody({ ...defaultBodyParams(pr.sex), ...pr.params });
  const r = checkBodyMesh(m);
  return { id: pr.id, ok: r.ok, clamped: m.clamped, failed: r.results.filter((x) => !x.pass).map((x) => `${x.name}: ${x.detail}`), heights: m.frame.heights, headUnit: m.frame.headUnit };
});
const canonical = buildBody(defaultBodyParams('male'));
const canonReport = checkBodyMesh(canonical);
const topo = checkBodyFixedTopology(6);
const random = sampleBodyParamSets(N, 2026).map((p, i) => {
  const m = buildBody(p);
  const r = checkBodyMesh(m);
  m.geometry.dispose();
  return { set: i, ok: r.ok, clamps: m.clamped.length, failed: r.results.filter((x) => !x.pass).map((x) => `${x.name}: ${x.detail}`) };
});
const ok = canonReport.ok && topo.pass && presets.every((p) => p.ok) && random.every((r) => r.ok);
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  template: { id: BODY_TEMPLATE_ID, version: BODY_TEMPLATE_VERSION, topologyVersion: BODY_TOPOLOGY_VERSION },
  stats: canonical.stats,
  parts: canonical.parts.map((p) => ({ name: p.name, vertices: p.vertexCount, triangles: p.triangleCount, rings: p.rings.map((r) => r.name) })),
  canonical: canonReport,
  presets,
  fixedTopology: topo,
  randomParamSets: { count: N, ok: random.filter((r) => r.ok).length, withClamps: random.filter((r) => r.clamps > 0).length, failures: random.filter((r) => !r.ok).slice(0, 20) },
  ok,
};
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
const line = (ok: boolean, level: string, name: string, detail: string) => console.log(`${ok ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL'}  ${name} — ${detail}`);
console.log(`${BODY_TEMPLATE_ID} ${BODY_TEMPLATE_VERSION} (${BODY_TOPOLOGY_VERSION}): ${canonical.stats.vertices} verts / ${canonical.stats.triangles} tris`);
for (const r of canonReport.results) line(r.pass, r.level, r.name, r.detail);
line(topo.pass, topo.level, topo.name, topo.detail);
for (const p of presets) console.log(`${p.ok ? 'PASS' : 'FAIL'}  preset ${p.id}${p.clamped.length ? ` (clamped: ${p.clamped.map((c) => c.name).join(',')})` : ''}${p.failed.length ? ' — ' + p.failed.join('; ') : ''}`);
console.log(`random parameter sets: ${report.randomParamSets.ok}/${N} ok (${report.randomParamSets.withClamps} needed anatomical clamps)`);
for (const f of report.randomParamSets.failures.slice(0, 5)) console.log(`  set ${f.set}: ${f.failed.join('; ')}`);
console.log(`report: ${path.relative(root, out)}`);
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
