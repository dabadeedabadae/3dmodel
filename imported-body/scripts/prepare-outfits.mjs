// Batch import of every dressed figure: imported-body/assets/outfit-NN.fbx
//   1. prepare-outfit (weld, symmetrise, segment, landmarks)  2. segmentation completeness  3. check-outfit
// Every figure except the reference is first prepared raw, then its garments are laid over the reference figure
// (I-61: the reference's head, arms and shoes verbatim, its T-shirt and trousers as the hidden body) and prepared
// again from the layered mesh; the checks run on the result. IB_ASSEMBLY=compose selects the older rebuild (I-50).
// Writes imported-body/reports/stage-I15-batch.json and exits non-zero if any figure fails.
// Only FBX is supported (the generator exports FBX); other formats are listed as skipped, not silently ignored.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DIR = 'imported-body/assets';
const STATURE = process.env.IB_STATURE ?? '175';
const REF = process.env.IB_BODY_REF ?? 'outfit01';
const ASSEMBLY = process.env.IB_ASSEMBLY ?? 'layers';
const files = readdirSync(DIR).filter((f) => /^outfit-\d+\.(fbx|glb|gltf|obj)$/i.test(f)).sort();
/**
 * Garment-only figures (I-62): a manifest entry with "topMesh" (a mesh of the garment alone, path from the repo root,
 * kept out of git) is placed on the reference by garment-source.ts and laid over it like any other figure; the
 * reference's own trousers stay. Listed after the FBX figures, under their manifest id.
 */
const garmentOnly = Object.entries(JSON.parse(readFileSync(`${DIR}/outfits.json`, 'utf8'))).filter(([, m]) => m?.topMesh).map(([id]) => id);
const REQUIRED = ['top', 'bottom', 'head', 'arm_left', 'arm_right', 'shoe_left', 'shoe_right'];
// garment types per outfit (I-54): without them the site cannot know what may be put on this figure
const TYPES = ['TSHIRT', 'SHIRT', 'JACKET', 'COAT', 'SWEATER', 'HOODIE', 'CARDIGAN', 'BLAZER', 'PANTS', 'JEANS', 'SHORTS', 'SKIRT', 'DRESS'];
const manifest = JSON.parse(readFileSync(`${DIR}/outfits.json`, 'utf8'));
const rows = [];
const run = (args, env = {}) => spawnSync(process.execPath, ['--import', 'tsx', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

for (const f of [...files, ...garmentOnly]) {
  const only = garmentOnly.includes(f);
  const id = only ? f : `outfit${f.match(/^outfit-(\d+)/)[1]}`;
  const row = { file: only ? `${id} (garment only)` : f, id, status: 'PASS', notes: [] };
  rows.push(row);
  if (!only && !f.toLowerCase().endsWith('.fbx')) { row.status = 'SKIP'; row.notes.push('формат не поддерживается, нужен FBX'); continue; }
  const m = manifest[id];
  if (!m || !TYPES.includes(m.top) || !TYPES.includes(m.bottom) || !m.label) {
    row.status = 'FAIL'; row.notes.push(`нет типа верха/низа в ${DIR}/outfits.json — впишите { "label", "top", "bottom" } для ${id}`); continue;
  }
  row.garments = { top: m.top, bottom: m.bottom, label: m.label };
  // a second base figure (e.g. the women's reference) is prepared as is, like REF; its garments name it in "ref"
  const ref = m.ref ?? REF;
  let prep;
  if (only) {
    const mesh = `imported-body/out/layered-${id}.json`;
    // ease (I-70): width over the base trunk; a layer worn over the T-shirt needs more than the default 1.06
    const src = run(['imported-body/scripts/garment-source.ts', m.topMesh, `garment-${id}`, ref, 'top'], {
      ...(m.ease ? { IB_EASE: String(m.ease) } : {}), ...(m.cuffCut ? { IB_CUFF_CUT: String(m.cuffCut) } : {}), ...(m.hemCut ? { IB_HEM_CUT: String(m.hemCut) } : {}), ...(m.deepCut ? { IB_DEEP_CUT: String(m.deepCut) } : {}), ...(m.dropDetails ? { IB_DROP_DETAILS: '1' } : {}),
    });
    const comp = src.status !== 0 ? src : run(['imported-body/scripts/layer-outfit.ts', ref, `garment-${id}`, ref, mesh], { ...(m.inner ? { IB_INNER: '1' } : {}), ...(m.collarClear ? { IB_COLLAR_CLEAR: '1' } : {}), ...(m.innerShrink ? { IB_INNER_SHRINK: String(m.innerShrink) } : {}) });
    row.assembly = 'garment-only';
    if (comp.status === 0) { try { row.compose = JSON.parse(comp.stdout.trim().split('\n').pop()); } catch { /* report only */ } }
    prep = comp.status === 0 ? run(['imported-body/scripts/prepare-outfit.ts', mesh, id, STATURE]) : comp;
  } else if (id === REF || m.base) prep = run(['imported-body/scripts/prepare-outfit.ts', `${DIR}/${f}`, id, STATURE]);
  else {
    const raw = run(['imported-body/scripts/prepare-outfit.ts', `${DIR}/${f}`, `raw-${id}`, STATURE]);
    const mesh = `imported-body/out/${ASSEMBLY === 'compose' ? 'composed' : 'layered'}-${id}.json`;
    const comp = raw.status !== 0 ? raw : ASSEMBLY === 'compose'
      ? run(['imported-body/scripts/compose-outfit.ts', `raw-${id}`, ref, mesh])
      : run(['imported-body/scripts/layer-outfit.ts', ref, `raw-${id}`, `raw-${id}`, mesh]);
    row.assembly = ASSEMBLY;
    if (comp.status === 0) { try { row.compose = JSON.parse(comp.stdout.trim().split('\n').pop()); } catch { /* report only */ } }
    prep = comp.status === 0 ? run(['imported-body/scripts/prepare-outfit.ts', mesh, id, STATURE]) : comp;
  }
  if (prep.status !== 0) { row.status = 'FAIL'; const lines = (prep.stderr || prep.stdout).trim().split('\n'); row.notes.push('подготовка упала: ' + (lines.find((l) => /Error/.test(l)) ?? lines.slice(-2).join(' ')).trim()); continue; }
  const o = JSON.parse(readFileSync(`imported-body/out/outfit-${id}.json`, 'utf8'));
  const counts = {};
  for (const p of o.parts) counts[p.kind] = (counts[p.kind] ?? 0) + p.vertices;
  row.parts = counts;
  row.landmarks_cm = o.landmarks_cm;
  row.symmetry_mm = o.symmetry_mm;
  row.weld = o.weld;
  const missing = REQUIRED.filter((k) => !counts[k]);
  if (missing.length) { row.status = 'FAIL'; row.notes.push('не размечено: ' + missing.join(', ')); }
  const L = o.landmarks_cm;
  // ordering sanity: a figure whose landmarks are out of order cannot be deformed correctly
  const order = [['ankle', 'crotch'], ['crotch', 'hip'], ['hip', 'waistband'], ['chest', 'armpit'], ['armpit', 'height']];
  for (const [a, b] of order) if (!(L[a] < L[b])) { row.status = 'FAIL'; row.notes.push(`разметка не по порядку: ${a} ${L[a]} ≥ ${b} ${L[b]}`); }
  const chk = run(['imported-body/scripts/check-outfit.ts'], { IB_ASSET: `imported-body/out/asset-${id}.json` });
  const range = (chk.stdout.match(/рабочий диапазон ползунков: (.*)/) ?? [])[1];
  row.sliderRange = range;
  const fails = chk.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
  if (chk.status !== 0) { row.status = 'FAIL'; row.notes.push(...(fails.length ? fails : ['check-outfit: код ' + chk.status])); }
}

writeFileSync('imported-body/reports/stage-I15-batch.json', JSON.stringify({ generatedAt: new Date().toISOString(), stature_cm: Number(STATURE), figures: rows }, null, 2));
for (const r of rows) {
  const p = r.parts ? Object.entries(r.parts).map(([k, v]) => `${k}:${v}`).join(' ') : '';
  console.log(`${r.status.padEnd(4)} ${r.file.padEnd(16)} ${p}`);
  if (r.sliderRange) console.log(`      ползунки: ${r.sliderRange}`);
  for (const n of r.notes) console.log(`      ${n}`);
}
const bad = rows.filter((r) => r.status === 'FAIL').length;
console.log(`RESULT: ${bad ? 'FAIL' : 'PASS'} — фигур ${rows.length}, провалов ${bad}`);
process.exit(bad ? 1 : 0);
