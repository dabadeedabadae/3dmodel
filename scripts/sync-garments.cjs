// Copies the photo → garment packages prepared by the 3D module (npm run ib:photo in ../3dmodel) into
// frontend/public/garments/<name>/ and writes frontend/public/garments/index.json. Git-ignored, like the figures.
// These are CC0 sample photos (fixtures/photos/LICENSE-CC0.txt) for the fitting-room demo.
const { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const SRC = resolve(process.env.GARMENTS_SRC ?? '../3dmodel/imported-body/out/photo');
const OUT = resolve('frontend/public/garments');
if (!existsSync(SRC)) throw new Error('no packages in ' + SRC + ' (run npm run ib:photo in 3dmodel)');
mkdirSync(OUT, { recursive: true });
const list = [];
for (const name of readdirSync(SRC).sort()) {
  const g = JSON.parse(readFileSync(resolve(SRC, name, 'garment.json'), 'utf8'));
  mkdirSync(resolve(OUT, name), { recursive: true });
  copyFileSync(resolve(SRC, name, 'texture.jpg'), resolve(OUT, name, 'texture.jpg'));
  const pkg = { id: name, category: g.category, anchors: g.anchors, baseColor: g.baseColor, needsReview: g.needsReview, anchorIssues: g.anchorIssues, landmarkStatus: g.landmarkStatus, textureUrl: `/garments/${name}/texture.jpg` };
  writeFileSync(resolve(OUT, name, 'garment.json'), JSON.stringify(pkg));
  list.push({ id: name, url: `/garments/${name}/garment.json`, textureUrl: pkg.textureUrl, baseColor: g.baseColor, needsReview: g.needsReview });
}
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify(list, null, 2));
console.log(`${list.length} garments -> ${OUT} (needs review: ${list.filter((g) => g.needsReview).length})`);
