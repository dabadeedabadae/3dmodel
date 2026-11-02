/**
 * Blocking geometry check for the T-shirt template. Exit code 1 on any
 * failing check (warnings do not fail). Writes reports/stage-03-checks.json.
 *
 *   npm run check:tshirt
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFixedTopology, checkTShirtMesh, sampleParamSets } from '../src/templates/checks';
import { buildTShirt } from '../src/templates/tshirt/buildTShirt';
import { TSHIRT_TEMPLATE_ID, TSHIRT_TEMPLATE_VERSION, TSHIRT_TOPOLOGY_VERSION, defaultTShirtParams } from '../src/templates/tshirt/params';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'reports', 'stage-03-checks.json');

const canonical = buildTShirt(defaultTShirtParams());
const canonReport = checkTShirtMesh(canonical, { stretchTolerance: 1.5 });
const topo = checkFixedTopology(10);

const randomSets = sampleParamSets(20, 2026);
const randomResults = randomSets.map((p, i) => {
  const m = buildTShirt(p);
  const r = checkTShirtMesh(m, { stretchTolerance: 3 });
  m.geometry.dispose();
  return { set: i, ok: r.ok, failed: r.results.filter((x) => !x.pass && x.level === 'fail').map((x) => x.name), warned: r.results.filter((x) => !x.pass && x.level === 'warn').map((x) => x.name) };
});

const allOk = canonReport.ok && topo.pass && randomResults.every((r) => r.ok);

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  template: { id: TSHIRT_TEMPLATE_ID, version: TSHIRT_TEMPLATE_VERSION, topologyVersion: TSHIRT_TOPOLOGY_VERSION },
  params: canonical.params,
  stats: canonical.stats,
  uvScale: canonical.uvScale,
  islands: canonical.islands.map((i) => ({ name: i.name, triangles: i.indexCount / 3, uvRect: i.uvRect })),
  rings: canonical.rings.map((r) => ({ name: r.name, size: r.logical.length, isOpening: r.isOpening })),
  seams: canonical.seams.map((s) => s.name),
  canonical: canonReport,
  fixedTopology: topo,
  randomParamSets: randomResults,
  ok: allOk,
};

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));

const line = (ok: boolean, level: string, name: string, detail: string) => console.log(`${ok ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL'}  ${name} — ${detail}`);
console.log(`tshirt-basic ${TSHIRT_TEMPLATE_VERSION} (${TSHIRT_TOPOLOGY_VERSION}): ${canonical.stats.vertices} verts / ${canonical.stats.logicalVertices} logical / ${canonical.stats.triangles} tris`);
for (const r of canonReport.results) line(r.pass, r.level, r.name, r.detail);
line(topo.pass, topo.level, topo.name, topo.detail);
console.log(`random parameter sets: ${randomResults.filter((r) => r.ok).length}/${randomResults.length} ok`);
console.log(`report: ${path.relative(root, out)}`);
console.log(allOk ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(allOk ? 0 : 1);
