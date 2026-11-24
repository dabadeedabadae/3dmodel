// node --import tsx dump-photo-map.ts <outfitId> <photoName> <out.json>   (run from the repo root, after ib:photo)
// Writes the figure mesh, part codes and the photo mapping exactly as the site computes it (imported-body/src/photoMap).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mapPhotoToBottom, mapPhotoToTop } from '../src/photoMap';
const [id, photo, out] = process.argv.slice(2);
const PART: Record<string, number> = { head: 0, arm_left: 1, arm_right: 1, top: 2, bottom: 3, shoe_left: 4, shoe_right: 4, inner: 5, other: 0 };
const a = JSON.parse(readFileSync(`imported-body/out/asset-${id}.json`, 'utf8'));
const o = JSON.parse(readFileSync(`imported-body/out/outfit-${id}.json`, 'utf8'));
const part = new Uint8Array(a.base.length / 3);
for (const p of o.partsIndex) for (const v of p.vertices) part[v] = PART[p.kind] ?? 0;
const fig = { base: Float32Array.from(a.base), index: Uint32Array.from(a.index), part, topCode: 2, headCode: 0, armpit: a.landmarks.armpit, bottomCode: 3, crotch: a.landmarks.crotch };
const g = JSON.parse(readFileSync(path.join('imported-body/out/photo', photo!, 'garment.json'), 'utf8'));
const m = g.category === 'pants' ? mapPhotoToBottom(fig as never, g.anchors) : mapPhotoToTop(fig as never, g.anchors);
writeFileSync(out!, JSON.stringify({ base: a.base, index: a.index, part: [...part], photoTriangles: m.photoTriangles, uv: [...m.uv], baseColor: g.baseColor,
  category: g.category, texture: path.resolve('imported-body/out/photo', photo!, 'texture.jpg'), stats: m.stats }));
console.log('MAP', id, photo, JSON.stringify(m.stats));
