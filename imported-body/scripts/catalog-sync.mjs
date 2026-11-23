// Garment catalogue for the site's admin (I-70): imported-body/assets/catalog.json + reference pictures
// imported-body/assets/ref/<id>.png → fitcast/frontend/public/catalog/{catalog.json, <id>.webp}.
// Status per item: "figure" — dressed on a mannequin (its outfit is prepared, imported-body/out/asset-<outfit>.json);
// "image" — only the reference picture exists; "todo" — nothing yet. Exits non-zero if a listed figure is missing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'imported-body/assets';
const OUT = 'fitcast/frontend/public/catalog';
const { items } = JSON.parse(readFileSync(`${SRC}/catalog.json`, 'utf8'));
const outfits = JSON.parse(readFileSync(`${SRC}/outfits.json`, 'utf8'));
mkdirSync(OUT, { recursive: true });
const rows = [];
let bad = 0;
for (const it of items) {
  const row = { id: it.id, label: it.label, layer: it.layer, type: it.type, status: 'todo' };
  if (existsSync(`${SRC}/ref/${it.id}.png`)) {
    await sharp(`${SRC}/ref/${it.id}.png`).resize(420, 300, { fit: 'contain', background: '#ffffff' }).webp({ quality: 82 }).toFile(`${OUT}/${it.id}.webp`);
    row.image = `/catalog/${it.id}.webp`;
    row.status = 'image';
  }
  if (it.figure) {
    if (!outfits[it.figure] || !existsSync(`imported-body/out/asset-${it.figure}.json`)) { console.error(`FAIL ${it.id}: figure ${it.figure} is not prepared (npm run ib:outfits)`); bad++; }
    else { row.status = 'figure'; row.figure = `figure-${it.figure.replace('outfit', '')}`; }
  }
  rows.push(row);
}
writeFileSync(`${OUT}/catalog.json`, JSON.stringify(rows, null, 2));
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`${rows.length} items: on a mannequin ${count('figure')}, picture only ${count('image')}, todo ${count('todo')} -> ${OUT}`);
process.exit(bad ? 1 : 0);
