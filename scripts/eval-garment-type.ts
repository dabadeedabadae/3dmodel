/**
 * Garment type from a photo: the SAME map as the site (fitcast/frontend/lib/garment/garmentType.ts) on the same
 * model (MobileNetV2-12, ImageNet) and the same preprocessing (shorter side 256, centre crop 224, ImageNet
 * mean/std), over every labelled photo of the project. Reports top-1 and "in the offered list" (top-1 or one of
 * the alternatives the form shows as buttons). Accuracy is reported, not asserted: exit 1 only on errors.
 *   npm run eval:type
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadSession, float32Tensor } from '../src/providers/onnx';
import { centerCropSquare, resizeRaster, softmax, toCHWFloat, type RasterImage } from '../src/image/raster';
import { suggestGarmentType } from '../fitcast/frontend/lib/garment/garmentType';
import { shapeFacts } from '../fitcast/frontend/lib/garment/shape';
import { U2NetpSegmentationProvider } from '../src/providers/SegmentationProvider';

const root = process.cwd();
const labels = readFileSync(path.join(root, 'public/models/synset.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^n\d+\s+/, ''));
const session = await loadSession(path.join(root, 'public/models/mobilenetv2-12.onnx'));
const seg = new U2NetpSegmentationProvider(path.join(root, 'public/models/u2netp.onnx'));
/** IB_NO_SHAPE=1: the classifier alone, as before I-80, to compare */
const useShape = !process.env.IB_NO_SHAPE;

/** expected types per file: fixture prefix, or catalog id */
const EXPECT: Record<string, string[]> = {
  tshirt: ['TSHIRT'], longsleeve: ['SWEATER', 'SHIRT', 'HOODIE', 'CARDIGAN'], pants: ['PANTS', 'JEANS'], skirt: ['SKIRT'], dress: ['DRESS'], shoes: ['SHOES'],
  'm-blazer': ['BLAZER'], 'm-cardigan': ['CARDIGAN'], 'm-coat': ['COAT'], 'm-jacket': ['JACKET'], 'm-longsleeve': ['TSHIRT', 'SWEATER', 'SHIRT'],
  'm-polo': ['TSHIRT', 'SHIRT'], 'm-shorts': ['SHORTS'], 'm-sweater-v': ['SWEATER'], 'm-sweater': ['SWEATER', 'HOODIE'], 'm-tank': ['TSHIRT'],
  'm-turtleneck': ['SWEATER', 'TSHIRT'], 'm-zip-hoodie': ['HOODIE', 'JACKET'],
};
const sets = [['photo', 'fixtures/photos'], ['catalog', 'fitcast/frontend/public/catalog']] as const;

async function raster(file: string): Promise<RasterImage> {
  const { data, info } = await sharp(file).rotate().flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}
const rows: Record<string, unknown>[] = [];
const tally: Record<string, { n: number; top1: number; offered: number }> = {};
for (const [set, dir] of sets) for (const f of readdirSync(path.join(root, dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()) {
  const key = f.replace(/\.(jpe?g|png|webp)$/i, '');
  const want = EXPECT[key] ?? EXPECT[key.split('_')[0]!];
  if (!want) continue;
  const img = await raster(path.join(root, dir, f));
  const side = Math.min(img.width, img.height), k = 256 / side;
  const sq = centerCropSquare(resizeRaster(img, Math.round(img.width * k), Math.round(img.height * k))).image;
  const chw = toCHWFloat(resizeRaster(sq, 224, 224), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
  const out = await session.run({ input: float32Tensor(chw, [1, 3, 224, 224]) });
  const shape = useShape ? await seg.segment(img).then((m) => shapeFacts(m.binary, img.width, img.height)) : null;
  const s = suggestGarmentType(softmax(out['output']!.data as Float32Array), labels, shape);
  const top1 = !!s.type && want.includes(s.type);
  const offered = top1 || s.alternatives.some((t) => want.includes(t));
  const t = (tally[set] ??= { n: 0, top1: 0, offered: 0 });
  t.n++; t.top1 += +top1; t.offered += +offered;
  rows.push({ set, file: f, want, got: s.type, score: Number(s.score.toFixed(2)), confident: s.confident, alternatives: s.alternatives, top1, offered, rawTop: s.rawTop.slice(0, 3).map((r) => `${r.label.split(',')[0]} ${r.score.toFixed(2)}`) });
  console.log(`${top1 ? 'OK  ' : offered ? 'ALT ' : 'MISS'} ${f.padEnd(26)} ждали ${want.join('/').padEnd(22)} → ${String(s.type).padEnd(8)} ${s.score.toFixed(2)}${s.confident ? '' : ' (не уверен)'}  ещё: ${s.alternatives.join(', ')}`);
}
for (const [set, t] of Object.entries(tally)) console.log(`${set}: верно сразу ${t.top1}/${t.n}, есть среди предложенных ${t.offered}/${t.n}`);
writeFileSync('reports/stage-I75-garment-type.json', JSON.stringify({ generatedAt: new Date().toISOString(), model: 'mobilenetv2-12.onnx', tally, rows }, null, 2));
