/**
 * Stage I-51 — photo → garment package for the dressed figure, and its blocking check.
 *
 *   node --import tsx imported-body/scripts/photo-garment.ts [photo ...]
 * Without arguments: every fixtures/photos/{tshirt,longsleeve,pants}_*.jpg (long sleeves → shirt/hoodie figures, I-63).
 *
 * For each photo, with the SAME providers as the page (U²-Netp mask, silhouette landmarks, median base colour):
 *   imported-body/out/photo/<name>/texture.jpg   photo with the background replaced by the base colour
 *   imported-body/out/photo/<name>/garment.json  anchors (image px), base colour, mask/landmark statuses
 * and maps it onto the upper garment of every prepared figure (out/asset-outfitNN.json + outfit-outfitNN.json).
 *
 * Blocking (exit 1) for photos whose landmarks are 'ok': a mapping that throws, corners outside the image, no
 * front triangles, torso sides swapped (image x must grow with figure x), torso upside down (image y must fall
 * as figure y rises), sleeves not running shoulder → cuff, or more than 3 % folded triangles (a front triangle
 * whose image-space winding flips). A photo that cannot be processed fails regardless. Photos whose landmarks
 * the estimator marks 'uncertain', or that anchorIssues() flags as implausible, are reported (WARN) — the
 * pipeline asks the user to confirm those points. A bad mapping on points that NOTHING flagged is a FAIL.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { U2NetpSegmentationProvider } from '../../src/providers/SegmentationProvider';
import { estimateTShirtLandmarks } from '../../src/shape/landmarks';
import { estimateBaseColor } from '../../src/image/color';
import type { RasterImage } from '../../src/image/raster';
import { anchorIssues, anchorsFromLandmarks, estimatePantsLandmarks, mapPhotoToBottom, mapPhotoToTop, torsoHalfWidth, type PhotoAnchors, type PhotoPointName } from '../src/photoMap';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'imported-body/out/photo');
const photos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(path.join(ROOT, 'fixtures/photos')).filter((f) => /^(tshirt|longsleeve|pants)_.*\.jpe?g$/i.test(f)).sort().map((f) => path.join(ROOT, 'fixtures/photos', f));

// long-sleeved tops (I-63): the same points and mapping as the T-shirt, shown only on figures wearing one of these
const LONG_TOPS = ['SHIRT', 'HOODIE', 'SWEATER', 'CARDIGAN'];
const PART = { head: 0, arm_left: 1, arm_right: 1, top: 2, bottom: 3, shoe_left: 4, shoe_right: 4, other: 0 } as Record<string, number>;
const figures = readdirSync(path.join(ROOT, 'imported-body/out')).map((f) => f.match(/^asset-(outfit\d+)\.json$/)?.[1]).filter(Boolean).sort() as string[];
// garment types per outfit (I-54): a T-shirt photo is only ever shown on a figure that wears a T-shirt
const manifest = JSON.parse(readFileSync('imported-body/assets/outfits.json', 'utf8')) as Record<string, { top: string; bottom: string }>;
const figs = figures.map((id) => {
  const a = JSON.parse(readFileSync(`imported-body/out/asset-${id}.json`, 'utf8'));
  const o = JSON.parse(readFileSync(`imported-body/out/outfit-${id}.json`, 'utf8'));
  const part = new Uint8Array(a.base.length / 3);
  for (const p of o.partsIndex) for (const v of p.vertices) part[v] = PART[p.kind] ?? 0;
  return { id, garments: manifest[id], fig: { base: Float32Array.from(a.base), index: Uint32Array.from(a.index), part, topCode: 2, headCode: 0, armpit: a.landmarks.armpit as number, bottomCode: 3, crotch: a.landmarks.crotch as number } };
});

async function loadRaster(file: string): Promise<RasterImage> {
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Pearson correlation */
function corr(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i]! - ma) * (b[i]! - mb); saa += (a[i]! - ma) ** 2; sbb += (b[i]! - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb || 1);
}

/** winding sign of a triangle in figure XY vs in UV (front view: x right, y up) */
function foldedIn(fig: { base: Float32Array; index: Uint32Array }, tris: number[], uv: Float32Array): number {
  let folded = 0;
  tris.forEach((t, j) => {
    const c = [0, 1, 2].map((k) => fig.index[t * 3 + k]!);
    const u = (k: number) => [uv[j * 6 + k * 2]!, uv[j * 6 + k * 2 + 1]!];
    const [a, b, cc] = [u(0), u(1), u(2)];
    const areaUV = (b[0]! - a[0]!) * (cc[1]! - a[1]!) - (b[1]! - a[1]!) * (cc[0]! - a[0]!);
    const P = (k: number) => [fig.base[c[k]! * 3]!, fig.base[c[k]! * 3 + 1]!];
    const [pa, pb, pc] = [P(0), P(1), P(2)];
    const areaXY = (pb[0]! - pa[0]!) * (pc[1]! - pa[1]!) - (pb[1]! - pa[1]!) * (pc[0]! - pa[0]!);
    if (areaUV * areaXY < 0 && Math.abs(areaUV) > 1e-7) folded++;
  });
  return folded;
}

/**
 * Trousers / jeans (I-53): landmarks from the mask, package, mapping onto the lower garment of every figure.
 * Same blocking rules as the T-shirt: inside the image, not mirrored (seat and legs: corr(x,u) ≥ 0.8), not upside
 * down (corr(y,v) ≥ 0.8), ≤ 3 % folded faces — for 'ok' landmarks; flagged photos are reported (WARN).
 * The mapping is checked on every figure's trousers as geometry; which garment it may be SHOWN on (trousers vs
 * jeans) is the site's rule (I-54).
 */
async function pants(name: string, file: string, img: RasterImage, s: Awaited<ReturnType<U2NetpSegmentationProvider['segment']>>, row: Record<string, unknown>): Promise<number> {
  const lm = estimatePantsLandmarks(s.binary, img.width, img.height);
  const color = estimateBaseColor(img, s.binary);
  Object.assign(row, { category: 'pants', mask: s.quality, landmarks: lm.status, anchorIssues: lm.reasons, baseColor: color.hex });
  if (!lm.anchors) {
    console.log(`WARN  ${name.padEnd(20)} ориентиры брюк не найдены: ${lm.reasons.join('; ')} — нужна проверка вручную`);
    return 0;
  }
  const tex = Buffer.alloc(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) for (let k = 0; k < 3; k++) tex[i * 3 + k] = s.binary[i] === 1 ? img.data[i * 4 + k]! : color.rgb[k]!;
  const dir = path.join(OUT, name);
  mkdirSync(dir, { recursive: true });
  await sharp(tex, { raw: { width: img.width, height: img.height, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(dir, 'texture.jpg'));
  writeFileSync(path.join(dir, 'garment.json'), JSON.stringify({
    source: path.relative(ROOT, file), category: 'pants', anchors: lm.anchors, baseColor: color.hex, maskQuality: s.quality,
    landmarkStatus: lm.status, anchorIssues: lm.reasons, needsReview: lm.status !== 'ok' || s.quality !== 'ok', providers: { mask: s.providerVersion },
    note: 'Сзади и по бокам не восстановлено по снимку — основной цвет.',
  }, null, 2));
  let failures = 0;
  for (const { id, fig } of figs) {
    const m = mapPhotoToBottom(fig, lm.anchors);
    const errs: string[] = [];
    if (!m.photoTriangles.length) errs.push('нет лицевых треугольников');
    if (m.stats.outOfImage) errs.push(`углов вне снимка: ${m.stats.outOfImage}`);
    const fx: number[] = [], fy: number[] = [], ix: number[] = [], iy: number[] = [];
    m.photoTriangles.forEach((t, j) => {
      for (let k = 0; k < 3; k++) {
        const v = fig.index[t * 3 + k]!;
        fx.push(fig.base[v * 3]!); fy.push(fig.base[v * 3 + 1]!);
        ix.push(m.uv[j * 6 + k * 2]!); iy.push(m.uv[j * 6 + k * 2 + 1]!);
      }
    });
    const cx = corr(fx, ix), cy = corr(fy, iy);
    const folded = foldedIn(fig, m.photoTriangles, m.uv);
    if (cx < 0.8) errs.push(`стороны перепутаны или смазаны: corr(x, u) = ${cx.toFixed(2)}`);
    if (cy < 0.8) errs.push(`снимок перевёрнут или смазан: corr(y, v) = ${cy.toFixed(2)}`);
    if (folded / m.photoTriangles.length > 0.03) errs.push(`перевёрнутых треугольников: ${((folded / m.photoTriangles.length) * 100).toFixed(1)} %`);
    const blocking = lm.status === 'ok' && s.quality === 'ok';
    const verdict = errs.length ? (blocking ? 'FAIL' : 'WARN') : 'PASS';
    if (verdict === 'FAIL') failures++;
    row[id] = { verdict, front: m.stats.frontTriangles, legs: m.stats.sleeveTriangles, base: m.stats.baseTriangles, corrX: Number(cx.toFixed(3)), corrY: Number(cy.toFixed(3)), folded, errors: errs };
    console.log(`${verdict}  ${name.padEnd(20)} ${id}  низ: лицевых ${m.stats.frontTriangles} (штанины ${m.stats.sleeveTriangles}), основным цветом ${m.stats.baseTriangles}, corr x ${cx.toFixed(2)} y ${cy.toFixed(2)}, складок ${folded}  маска ${s.quality}, точки ${lm.status}${lm.reasons.length ? ' [' + lm.reasons.join('; ') + ']' : ''}${errs.length ? '  — ' + errs.join('; ') : ''}`);
  }
  return failures;
}

async function main() {
  const seg = new U2NetpSegmentationProvider(path.join(ROOT, 'public/models/u2netp.onnx'));
  await seg.load();
  const rows: Record<string, unknown>[] = [];
  let failures = 0;
  for (const file of photos) {
    const name = path.basename(file).replace(/\.[^.]+$/, '');
    const row: Record<string, unknown> = { photo: name };
    rows.push(row);
    try {
      const img = await loadRaster(file);
      const s = await seg.segment(img);
      if (name.startsWith('pants_')) { failures += await pants(name, file, img, s, row); continue; }
      const lm = estimateTShirtLandmarks(s.binary, img.width, img.height);
      const points = Object.fromEntries(Object.entries(lm.points).map(([k, p]) => [k, { x: p.x, y: p.y }])) as Record<PhotoPointName, { x: number; y: number }>;
      const anchors: PhotoAnchors = anchorsFromLandmarks(points, s.binary, img.width, img.height);
      const issues = anchorIssues(anchors);
      const color = estimateBaseColor(img, s.binary);
      // texture: garment pixels from the photo, everything else the base colour (no background bleeds in)
      const tex = Buffer.alloc(img.width * img.height * 3);
      for (let i = 0; i < img.width * img.height; i++) {
        const inside = s.binary[i] === 1;
        for (let k = 0; k < 3; k++) tex[i * 3 + k] = inside ? img.data[i * 4 + k]! : color.rgb[k]!;
      }
      const dir = path.join(OUT, name);
      mkdirSync(dir, { recursive: true });
      await sharp(tex, { raw: { width: img.width, height: img.height, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(dir, 'texture.jpg'));
      writeFileSync(path.join(dir, 'garment.json'), JSON.stringify({
        source: path.relative(ROOT, file), category: name.startsWith('longsleeve_') ? 'top' : 'tshirt', anchors, baseColor: color.hex,
        maskQuality: s.quality, landmarkStatus: lm.status, anchorIssues: issues, needsReview: lm.status !== 'ok' || issues.length > 0,
        providers: { mask: s.providerVersion },
        note: 'Спинка, бока и закрытые места не восстановлены по снимку — основной цвет.',
      }, null, 2));
      Object.assign(row, { mask: s.quality, landmarks: lm.status, anchorIssues: issues, baseColor: color.hex });

      for (const { id, fig } of figs.filter((f) => (name.startsWith('longsleeve_') ? LONG_TOPS : ['TSHIRT']).includes(f.garments?.top))) {
        const m = mapPhotoToTop(fig, anchors);
        const errs: string[] = [];
        if (!m.photoTriangles.length) errs.push('нет лицевых треугольников');
        if (m.stats.outOfImage) errs.push(`углов вне снимка: ${m.stats.outOfImage}`);
        // orientation over the photo triangles' corners
        // orientation on the TORSO (in T-pose the sleeves are horizontal while a flat-lay's sleeves slope, so they
        // do not belong in a "not upside down" test); sleeves are checked along their length instead
        const fx: number[] = [], fy: number[] = [], ix: number[] = [], iy: number[] = [];
        const sAlong: number[] = [], sImg: number[] = [];
        const armpitY = fig.armpit;
        // the same torso/sleeve split as the mapping (I-75: vertices alone gave the coarse women's base too narrow a torso)
        const s0 = torsoHalfWidth(fig);
        let folded = 0;
        m.photoTriangles.forEach((t, j) => {
          const c = [0, 1, 2].map((k) => fig.index[t * 3 + k]!);
          for (let k = 0; k < 3; k++) {
            const x = fig.base[c[k]! * 3]!, y = fig.base[c[k]! * 3 + 1]!;
            const u = m.uv[j * 6 + k * 2]!, v = m.uv[j * 6 + k * 2 + 1]!;
            if (Math.abs(x) <= s0) { fx.push(x); fy.push(y); ix.push(u); iy.push(v); }
            else {
              // distance from the body along the sleeve vs position along the photo's sleeve axis (middle of the
              // armhole → middle of the cuff); the across-sleeve direction (shoulder → armpit) is not part of it
              const P = anchors.points, r = x > 0;
              const m0 = { x: ((r ? P.shoulder_right : P.shoulder_left).x + (r ? P.armpit_right : P.armpit_left).x) / 2, y: ((r ? P.shoulder_right : P.shoulder_left).y + (r ? P.armpit_right : P.armpit_left).y) / 2 };
              const m1 = { x: ((r ? P.cuff_right_top : P.cuff_left_top).x + (r ? P.cuff_right_bottom : P.cuff_left_bottom).x) / 2, y: ((r ? P.cuff_right_top : P.cuff_left_top).y + (r ? P.cuff_right_bottom : P.cuff_left_bottom).y) / 2 };
              const ax = m1.x - m0.x, ay = m1.y - m0.y;
              sAlong.push(Math.abs(x)); sImg.push(((u * anchors.width - m0.x) * ax + ((1 - v) * anchors.height - m0.y) * ay) / (ax * ax + ay * ay || 1));
            }
          }
          // winding in UV vs winding of the front-facing triangle seen from the front (x right, y up)
          const u = (k: number) => [m.uv[j * 6 + k * 2]!, m.uv[j * 6 + k * 2 + 1]!];
          const [a, b, cc] = [u(0), u(1), u(2)];
          const areaUV = (b[0]! - a[0]!) * (cc[1]! - a[1]!) - (b[1]! - a[1]!) * (cc[0]! - a[0]!);
          const P = (k: number) => [fig.base[c[k]! * 3]!, fig.base[c[k]! * 3 + 1]!];
          const [pa, pb, pc] = [P(0), P(1), P(2)];
          const areaXY = (pb[0]! - pa[0]!) * (pc[1]! - pa[1]!) - (pb[1]! - pa[1]!) * (pc[0]! - pa[0]!);
          if (areaUV * areaXY < 0 && Math.abs(areaUV) > 1e-7) folded++;
        });
        const cx = corr(fx, ix), cy = corr(fy, iy);
        const cs = sAlong.length > 8 ? corr(sAlong, sImg) : 1;
        if (cx < 0.8) errs.push(`стороны перепутаны или смазаны: corr(x, u) = ${cx.toFixed(2)}`);
        if (cy < 0.8) errs.push(`снимок перевёрнут или смазан: corr(y, v) = ${cy.toFixed(2)}`);
        if (cs < 0.8) errs.push(`рукав развёрнут не от плеча к манжете: corr = ${cs.toFixed(2)}`);
        const foldShare = folded / m.photoTriangles.length;
        if (foldShare > 0.03) errs.push(`перевёрнутых треугольников в развёртке: ${(foldShare * 100).toFixed(1)} %`);
        /**
         * Landmarks marked 'uncertain' by the estimator are, by the pipeline's own contract (D-16), to be checked
         * and moved by the user before use. Their mapping is reported in full but does not fail the build; with
         * 'ok' landmarks every rule above is blocking.
         */
        // ... and so are points our own plausibility rules flag: a flagged photo is never shown without review
        const blocking = lm.status === 'ok' && issues.length === 0;
        const verdict = errs.length ? (blocking ? 'FAIL' : 'WARN') : 'PASS';
        row[id] = { verdict, front: m.stats.frontTriangles, sleeves: m.stats.sleeveTriangles, base: m.stats.baseTriangles, corrX: Number(cx.toFixed(3)), corrY: Number(cy.toFixed(3)), corrSleeve: Number(cs.toFixed(3)), folded, errors: errs };
        if (verdict === 'FAIL') failures++;
        console.log(`${verdict}  ${name.padEnd(20)} ${id}  лицевых ${m.stats.frontTriangles} (рукава ${m.stats.sleeveTriangles}), основным цветом ${m.stats.baseTriangles}, corr x ${cx.toFixed(2)} y ${cy.toFixed(2)} рукав ${cs.toFixed(2)}, складок ${folded}  маска ${s.quality}, точки ${lm.status}${issues.length ? ' [нужна проверка: ' + issues.join('; ') + ']' : ''}${errs.length ? '  — ' + errs.join('; ') : ''}`);
      }
    } catch (e) {
      failures++;
      row.error = e instanceof Error ? e.message : String(e);
      console.log(`FAIL  ${name}  ${row.error}`);
    }
  }
  writeFileSync('imported-body/reports/stage-I51-photo-map.json', JSON.stringify({ generatedAt: new Date().toISOString(), figures, photos: rows }, null, 2));
  console.log(`RESULT: ${failures ? 'FAIL' : 'PASS'} — фото ${photos.length}, фигур ${figures.length}, провалов ${failures}`);
  process.exit(failures ? 1 : 0);
}
main();
