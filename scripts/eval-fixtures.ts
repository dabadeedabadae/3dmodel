/**
 * Runs the REAL providers (same code as the page) over fixtures/photos/*.jpg in
 * node (onnxruntime-web wasm) and writes:
 *   reports/stage-06-07-eval.json      — per-photo category suggestions + mask stats
 *   renders/stage-07-masks/<name>.png  — photo | soft mask | binary overlay
 *   renders/stage-06-07-contact-sheet.png
 * Exit 1 if any photo fails to process (model errors), NOT on wrong predictions —
 * accuracy is reported, not asserted (the set is tiny and uncurated).
 *
 *   npm run eval:fixtures
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ImageNetCategoryProvider } from '../src/providers/CategoryProvider';
import { U2NetpSegmentationProvider } from '../src/providers/SegmentationProvider';
import type { RasterImage } from '../src/image/raster';
import type { GarmentCategory } from '../src/domain/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const photosDir = path.join(root, 'fixtures', 'photos');
const outDir = path.join(root, 'renders', 'stage-07-masks');
mkdirSync(outDir, { recursive: true });
mkdirSync(path.join(root, 'reports'), { recursive: true });

/** fixture file names start with the dataset label: tshirt_, pants_, skirt_, dress_, shoes_, longsleeve_ */
function expectedCategory(name: string): GarmentCategory {
  const p = name.split('_')[0]!;
  if (p === 'tshirt') return 'tshirt';
  if (p === 'pants') return 'pants';
  if (p === 'skirt') return 'skirt';
  return 'other';
}

async function loadRaster(file: string): Promise<RasterImage> {
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

async function main() {
  const cat = new ImageNetCategoryProvider(path.join(root, 'public/models/mobilenetv2-12.onnx'), readFileSync(path.join(root, 'public/models/synset.txt'), 'utf8'));
  const seg = new U2NetpSegmentationProvider(path.join(root, 'public/models/u2netp.onnx'));
  const t0 = performance.now();
  await cat.load();
  await seg.load();
  const loadMs = performance.now() - t0;

  const files = readdirSync(photosDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  const rows: Record<string, unknown>[] = [];
  const tiles: Buffer[] = [];
  let failures = 0;
  for (const f of files) {
    const name = f.replace(/\.[^.]+$/, '');
    try {
      const img = await loadRaster(path.join(photosDir, f));
      const c = await cat.suggest(img);
      const s = await seg.segment(img);
      const expected = expectedCategory(name);
      const top1 = c.suggestions[0]!.category;
      // visual: photo | soft | overlay
      const w = img.width,
        h = img.height;
      const overlay = Buffer.alloc(w * h * 4);
      const softRgba = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        const inside = s.binary[i] === 1;
        overlay[o] = inside ? img.data[o]! : img.data[o]! * 0.25;
        overlay[o + 1] = inside ? img.data[o + 1]! : img.data[o + 1]! * 0.25;
        overlay[o + 2] = inside ? img.data[o + 2]! : img.data[o + 2]! * 0.25 + 120;
        overlay[o + 3] = 255;
        softRgba[o] = softRgba[o + 1] = softRgba[o + 2] = s.soft[i]!;
        softRgba[o + 3] = 255;
      }
      const tile = await sharp({ create: { width: w * 3 + 8, height: h + 36, channels: 4, background: '#ffffff' } })
        .composite([
          { input: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), raw: { width: w, height: h, channels: 4 }, left: 0, top: 36 },
          { input: softRgba, raw: { width: w, height: h, channels: 4 }, left: w + 4, top: 36 },
          { input: overlay, raw: { width: w, height: h, channels: 4 }, left: 2 * w + 8, top: 36 },
          {
            input: Buffer.from(
              `<svg width="${w * 3 + 8}" height="36"><text x="4" y="24" font-family="DejaVu Sans, sans-serif" font-size="15" fill="#111">${name} · expected ${expected} · top1 ${top1} (${c.suggestions[0]!.score.toFixed(2)}) · raw: ${c.rawTop[0]!.label.split(',')[0]} ${c.rawTop[0]!.score.toFixed(2)} · mask cov ${(s.stats.coverage * 100).toFixed(0)}% ${s.quality}</text></svg>`,
            ),
            left: 0,
            top: 0,
          },
        ])
        .png()
        .toBuffer();
      writeFileSync(path.join(outDir, `${name}.png`), tile);
      tiles.push(tile);
      rows.push({
        file: f,
        width: w,
        height: h,
        expected,
        top1,
        top1Correct: top1 === expected,
        suggestions: c.suggestions.map((x) => ({ category: x.category, score: Number(x.score.toFixed(4)) })),
        rawTop: c.rawTop.map((x) => ({ label: x.label, score: Number(x.score.toFixed(4)) })),
        categoryMs: Math.round(c.inferenceMs),
        mask: { heuristicStatus: s.quality, coverage: Number(s.stats.coverage.toFixed(3)), components: s.stats.components, touchesBorder: s.stats.touchesBorder, openHoles: s.post.openHoles.length, removedFragments: s.post.removedComponents.length, warnings: s.warnings, ms: Math.round(s.stats.inferenceMs) },
      });
      console.log(`${name.padEnd(22)} expected ${expected.padEnd(6)} top1 ${top1.padEnd(6)} ${top1 === expected ? 'OK ' : 'MISS'} raw=${c.rawTop[0]!.label.split(',')[0]} mask=${s.quality} cov=${(s.stats.coverage * 100).toFixed(0)}%`);
    } catch (e) {
      failures++;
      console.error(`FAILED ${f}: ${e instanceof Error ? e.message : e}`);
      rows.push({ file: f, error: String(e) });
    }
  }
  // contact sheet
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  const sheetW = Math.max(...metas.map((m) => m.width!));
  const sheetH = metas.reduce((a, m) => a + m.height! + 4, 0);
  let top = 0;
  const comps = tiles.map((t, i) => {
    const c = { input: t, left: 0, top };
    top += metas[i]!.height! + 4;
    return c;
  });
  await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: '#dddddd' } })
    .composite(comps)
    .png()
    .toFile(path.join(root, 'renders', 'stage-06-07-contact-sheet.png'));

  const tshirtRows = rows.filter((r) => r['expected'] === 'tshirt' && !r['error']);
  const nonRows = rows.filter((r) => r['expected'] !== 'tshirt' && !r['error']);
  const summary = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    runtime: 'onnxruntime-web (wasm) in node',
    models: { category: cat.version, segmentation: seg.version },
    loadMs: Math.round(loadMs),
    photos: rows.length,
    failures,
    top1: {
      tshirt: `${tshirtRows.filter((r) => r['top1Correct']).length}/${tshirtRows.length}`,
      nonTshirtRejected: `${nonRows.filter((r) => r['top1'] !== 'tshirt').length}/${nonRows.length}`,
      all: `${rows.filter((r) => r['top1Correct']).length}/${rows.length}`,
    },
    masks: {
      heuristic_ok: rows.filter((r) => (r['mask'] as { heuristicStatus: string } | undefined)?.heuristicStatus === 'ok').length,
      heuristic_suspicious: rows.filter((r) => (r['mask'] as { heuristicStatus: string } | undefined)?.heuristicStatus === 'suspicious').length,
      heuristic_empty: rows.filter((r) => (r['mask'] as { heuristicStatus: string } | undefined)?.heuristicStatus === 'empty').length,
    },
    note: 'Category top-1 on an uncurated 26-photo CC0 sample; scores are uncalibrated. Mask statuses ok/suspicious/empty are HEURISTIC (coverage, border, fragments, holes) — no ground-truth masks exist, so no mask accuracy is claimed; see the contact sheet.',
    rows,
  };
  writeFileSync(path.join(root, 'reports', 'stage-06-07-eval.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
  await cat.dispose();
  await seg.dispose();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
