/**
 * Stage I-51 — photo → garment package for the dressed figure, and its blocking check.
 *
 *   node --import tsx imported-body/scripts/photo-garment.ts [photo ...]
 * Without arguments: every fixtures/photos/tshirt_*.jpg.
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
import { anchorIssues, anchorsFromLandmarks, mapPhotoToTop, type PhotoAnchors, type PhotoPointName } from '../src/photoMap';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'imported-body/out/photo');
const photos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(path.join(ROOT, 'fixtures/photos')).filter((f) => /^tshirt_.*\.jpe?g$/i.test(f)).sort().map((f) => path.join(ROOT, 'fixtures/photos', f));

const PART = { head: 0, arm_left: 1, arm_right: 1, top: 2, bottom: 3, shoe_left: 4, shoe_right: 4, other: 0 } as Record<string, number>;
const figures = readdirSync(path.join(ROOT, 'imported-body/out')).map((f) => f.match(/^asset-(outfit\d+)\.json$/)?.[1]).filter(Boolean).sort() as string[];
const figs = figures.map((id) => {
  const a = JSON.parse(readFileSync(`imported-body/out/asset-${id}.json`, 'utf8'));
  const o = JSON.parse(readFileSync(`imported-body/out/outfit-${id}.json`, 'utf8'));
  const part = new Uint8Array(a.base.length / 3);
  for (const p of o.partsIndex) for (const v of p.vertices) part[v] = PART[p.kind] ?? 0;
  return { id, fig: { base: Float32Array.from(a.base), index: Uint32Array.from(a.index), part, topCode: 2, headCode: 0, armpit: a.landmarks.armpit as number } };
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
        source: path.relative(ROOT, file), category: 'tshirt', anchors, baseColor: color.hex,
        maskQuality: s.quality, landmarkStatus: lm.status, anchorIssues: issues, needsReview: lm.status !== 'ok' || issues.length > 0,
        providers: { mask: s.providerVersion },
        note: 'Спинка, бока и закрытые места не восстановлены по снимку — основной цвет.',
      }, null, 2));
      Object.assign(row, { mask: s.quality, landmarks: lm.status, anchorIssues: issues, baseColor: color.hex });

      for (const { id, fig } of figs) {
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
        let s0 = 0;
        for (let i = 0; i < fig.part.length; i++) if (fig.part[i] === 2 && fig.base[i * 3 + 1]! > armpitY - 0.06 && fig.base[i * 3 + 1]! < armpitY - 0.015) s0 = Math.max(s0, Math.abs(fig.base[i * 3]!));
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
