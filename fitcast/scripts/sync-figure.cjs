// Builds the client figure file from the prepared dressed figure of the 3D module.
//   input : ../imported-body/out/asset-outfit01.json  (deformation asset)
//           ../imported-body/out/outfit-outfit01.json (shell segmentation: top, bottom, head, arms, shoes)
//   output: frontend/public/models/figure-NN.json + figures.json (git-ignored; regenerate with `npm run figure:sync`)
// Both inputs describe the SAME welded mesh; the script refuses to merge them otherwise.
const { readFileSync, writeFileSync, mkdirSync, readdirSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const SRC = resolve(process.env.FIGURE_SRC ?? '../imported-body/out');
const OUT_DIR = resolve('frontend/public/models');
// inner: the base T-shirt shown under an open neckline (I-70), its own colour, never textured from a photo
const PART_CODES = { head: 0, arm_left: 1, arm_right: 1, top: 2, bottom: 3, shoe_left: 4, shoe_right: 4, inner: 5, other: 0 };
const r = (x) => Math.round(x * 1e5) / 1e5;

// garment types per outfit (I-54): the site puts a wardrobe item only on the figure wearing the same kind of garment
const MANIFEST = resolve(process.env.FIGURE_MANIFEST ?? '../imported-body/assets/outfits.json');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const ids = readdirSync(SRC).map((f) => f.match(/^asset-outfit(\d+)\.json$/)?.[1]).filter(Boolean).sort();
if (!ids.length) throw new Error('no prepared figures in ' + SRC + ' (run npm run ib:outfits in the repository root)');
mkdirSync(OUT_DIR, { recursive: true });
const list = [];
for (const num of ids) {
  const asset = JSON.parse(readFileSync(resolve(SRC, `asset-outfit${num}.json`), 'utf8'));
  const outfit = JSON.parse(readFileSync(resolve(SRC, `outfit-outfit${num}.json`), 'utf8'));
  const n = asset.base.length / 3;
  if (outfit.base.length !== asset.base.length || outfit.index.length !== asset.index.length) throw new Error(`figure ${num}: asset and outfit meshes differ`);
  for (let i = 0; i < asset.index.length; i++) if (asset.index[i] !== outfit.index[i]) throw new Error(`figure ${num}: index buffers differ`);
  if (!asset.usableSliderRange) throw new Error(`figure ${num}: no slider range — run check-outfit (npm run ib:outfits)`);
  const part = new Array(n).fill(-1);
  for (const p of outfit.partsIndex) for (const v of p.vertices) part[v] = PART_CODES[p.kind] ?? 0;
  const missing = part.filter((c) => c < 0).length;
  if (missing) throw new Error(`figure ${num}: ${missing} vertices have no part`);
  const id = `figure-${num}`;
  writeFileSync(resolve(OUT_DIR, `${id}.json`), JSON.stringify({
    id, version: asset.version, topologyVersion: `${id}-topo-1`,
    /** part codes per vertex: 0 head/skin, 1 arms/skin, 2 top garment, 3 bottom garment, 4 shoes, 5 inner layer */
    partNames: ['head', 'arms', 'top', 'bottom', 'shoes', 'inner'],
    landmarks: asset.landmarks, armBand: asset.armBand, axis: asset.axis, legAxis: asset.legAxis,
    usableSliderRange: asset.usableSliderRange, base: asset.base.map(r), index: asset.index, part,
  }));
  const m = manifest[`outfit${num}`];
  if (!m?.top || !m?.bottom) throw new Error(`figure ${num}: no garment types in ${MANIFEST}`);
  list.push({ id, url: `/models/${id}.json`, vertices: n, triangles: asset.index.length / 3, label: m.label, garments: { top: m.top, bottom: m.bottom }, ...(m.inner ? { inner: 'TSHIRT' } : {}), range: asset.usableSliderRange });
  console.log(`${id}: ${n} vertices, ${asset.index.length / 3} triangles`);
}
writeFileSync(resolve(OUT_DIR, 'figures.json'), JSON.stringify(list, null, 2));
console.log(`${list.length} figures -> ${OUT_DIR}`);
