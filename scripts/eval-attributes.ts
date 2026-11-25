// node --import tsx scripts/eval-attributes.ts : pattern / second colour / tone read from the project's analysed
// photos (imported-body/out/photo/*, run ib:photo first) against a hand label of each photo. Writes
// reports/stage-I77-attributes.json. Labels: "pattern" = stripes or a print visible on the front.
import sharp from 'sharp';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describePixels, maskFromTexture } from '../fitcast/frontend/lib/garment/attributes';

const TRUTH: Record<string, 'solid' | 'pattern'> = {
  tshirt_0fc3fbae: 'pattern', tshirt_29d44695: 'pattern', tshirt_2aff1c58: 'pattern', tshirt_2df565b9: 'solid',
  tshirt_58e51574: 'solid', tshirt_5aee6e35: 'pattern', tshirt_5d9384e4: 'pattern', tshirt_8f0cd82c: 'pattern',
  tshirt_91ebc326: 'pattern', tshirt_99fdccb7: 'pattern', tshirt_b40637fa: 'pattern', tshirt_bb140894: 'solid',
  tshirt_e330e5fa: 'pattern', tshirt_fbb96cbf: 'pattern', longsleeve_107dd572: 'solid', longsleeve_582f7f10: 'solid',
  pants_4cc4e673: 'solid', pants_9cb9ae19: 'solid', pants_e0dc1f06: 'solid',
};
const dir = 'imported-body/out/photo';
const rows: Record<string, unknown>[] = [];
let ok = 0, n = 0;
for (const f of readdirSync(dir)) {
  const g = JSON.parse(readFileSync(`${dir}/${f}/garment.json`, 'utf8'));
  const { data, info } = await sharp(`${dir}/${f}/texture.jpg`).resize(128, 128, { fit: 'fill', kernel: 'nearest' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const d = new Uint8Array(data);
  const a = describePixels(d, info.width, info.height, maskFromTexture(d, info.width, info.height, g.baseColor));
  const t = TRUTH[f];
  if (t) { n++; if (t === a.pattern) ok++; }
  rows.push({ photo: f, truth: t ?? null, ...a });
  console.log(f.padEnd(22), (t ?? '?').padEnd(8), a.pattern.padEnd(8), (a.secondaryColor ?? '-').padEnd(7), a.tone.padEnd(6), JSON.stringify(a.shares), t && t !== a.pattern ? '  <-- wrong' : '');
}
console.log(`pattern right: ${ok}/${n}`);
mkdirSync('reports', { recursive: true });
writeFileSync('reports/stage-I77-attributes.json', JSON.stringify({ patternRight: ok, labelled: n, rows }, null, 2));
