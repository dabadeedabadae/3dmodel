// End-to-end run of garment.html in headless Chromium over real fixture photos.
// Produces renders/stage-05-07/*.png and reports/stage-05-07-e2e.json.
//   npm run e2e:pipeline
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = 5176;
const base = `http://127.0.0.1:${port}/garment.html`;
const outDir = path.join(root, 'renders', 'stage-05-07');
await mkdir(outDir, { recursive: true });

// photo -> what the "user" confirms; strokes to apply in the editor (image px of the 400-wide working copy)
const CASES = [
  { file: 'tshirt_fbb96cbf.jpg', confirm: 'tshirt', edits: [] },
  { file: 'tshirt_5aee6e35.jpg', confirm: 'tshirt', edits: [{ mode: 'erase', radius: 12, points: [{ x: 20, y: 20 }, { x: 60, y: 60 }] }] },
  // navy shirt on a blue blanket: the model loses the sleeves and a band at the chest; the "user" paints them back
  { file: 'tshirt_91ebc326.jpg', confirm: 'tshirt', edits: [{ mode: 'add', radius: 16, points: [{ x: 42, y: 205 }, { x: 358, y: 205 }] }, { mode: 'add', radius: 16, points: [{ x: 95, y: 245 }, { x: 330, y: 245 }] }, { mode: 'add', radius: 14, points: [{ x: 100, y: 268 }, { x: 320, y: 268 }] }] },
  { file: 'tshirt_8f0cd82c.jpg', confirm: 'tshirt', edits: [] }, // classifier says pants -> user corrects
  { file: 'tshirt_2df565b9.jpg', confirm: 'tshirt', edits: [] }, // classifier says other -> user corrects
  { file: 'pants_4cc4e673.jpg', confirm: 'pants', edits: [] }, // unsupported -> rejected
  { file: 'skirt_26921ddb.jpg', confirm: 'skirt', edits: [] }, // unsupported -> rejected
  { file: 'shoes_bf583ce5.jpg', confirm: 'other', edits: [] }, // unsupported -> rejected
];

async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('dev server not up');
}

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
const report = { generatedAt: new Date().toISOString(), cases: [], errors: [], extra: {} };
try {
  await waitServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`console: ${m.text()}`);
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__pgp && window.__pgp.ready);
  // wait for model load (first time fetches 19 MB from the dev server)
  await page.waitForFunction(() => window.__pgp.app.client.info !== null, null, { timeout: 120000 });
  const providers = await page.evaluate(() => window.__pgp.app.client.info);
  report.extra.providers = providers;
  await page.screenshot({ path: path.join(outDir, '00-empty-page.png') });

  for (const c of CASES) {
    const name = c.file.replace(/\.[^.]+$/, '');
    const entry = { file: c.file, confirm: c.confirm };
    try {
      await page.setInputFiles('#pgp-file', path.join(root, 'fixtures', 'photos', c.file));
      await page.waitForSelector('.pgp-sugg, #pgp-manual-mode', { timeout: 60000 });
      entry.photo = await page.locator('#pgp-file ~ * , .pgp-note').first().textContent();
      const snap1 = await page.evaluate(() => window.__pgp.app.snapshot());
      entry.suggestions = snap1.category?.suggestions ?? null;
      entry.rawTop = snap1.category?.rawTop ?? null;
      entry.categoryError = snap1.categoryError;
      entry.photoWorking = snap1.photoWorking;
      await page.screenshot({ path: path.join(outDir, `${name}-1-category.png`), fullPage: false });
      await page.click(`button[data-confirm="${c.confirm}"]`);
      entry.verdict = await page.locator('#pgp-category-verdict').textContent();
      if (c.confirm !== 'tshirt') {
        await page.screenshot({ path: path.join(outDir, `${name}-2-rejected.png`) });
        entry.stages = (await page.evaluate(() => window.__pgp.app.snapshot())).stages;
        report.cases.push(entry);
        continue;
      }
      await page.waitForSelector('.pg-maskcanvas', { timeout: 120000 });
      await page.waitForTimeout(200);
      const snap2 = await page.evaluate(() => window.__pgp.app.snapshot());
      entry.segmentation = snap2.segmentation ? { quality: snap2.segmentation.quality, warnings: snap2.segmentation.warnings, stats: snap2.segmentation.stats } : null;
      entry.segmentationError = snap2.segmentationError;
      await page.locator('.pg-maskscroll').screenshot({ path: path.join(outDir, `${name}-2-mask-auto.png`) });
      await page.locator('.pg-cropcanvas').screenshot({ path: path.join(outDir, `${name}-2-crop-auto.png`) });
      entry.maskBefore = snap2.maskSummary;
      // threshold slider: without edits re-threshold applies immediately (no inference)
      if (c.edits.length === 0 && !entry.thresholdChecked) {
        const before = (await page.evaluate(() => window.__pgp.app.snapshot())).maskSummary.coverage;
        await page.locator('#pgp-threshold').fill('64');
        await page.waitForTimeout(400);
        const after64 = (await page.evaluate(() => window.__pgp.app.snapshot())).maskSummary.coverage;
        await page.locator('#pgp-threshold').fill('128');
        await page.waitForTimeout(400);
        const back = (await page.evaluate(() => window.__pgp.app.snapshot())).maskSummary.coverage;
        entry.threshold = { at128: before, at64: after64, backTo128: back, grewAt64: after64 >= before, restored: Math.abs(back - before) < 1e-9 };
      }
      for (const e of c.edits) await page.evaluate((e) => window.__pgp.app.editor.stroke(e.points, e.mode, e.radius), e);
      if (c.edits.length) {
        // with edits the slider must NOT silently rebuild: a confirmation button appears
        await page.locator('#pgp-threshold').fill('96');
        await page.waitForTimeout(300);
        entry.thresholdAfterEdits = { confirmVisible: await page.locator('#pgp-threshold-confirm').isVisible(), strokesKept: (await page.evaluate(() => window.__pgp.app.snapshot())).maskStrokes };
        await page.locator('#pgp-threshold').fill('128');
        await page.waitForTimeout(300);
      }
      if (c.edits.length) {
        await page.locator('.pg-maskscroll').screenshot({ path: path.join(outDir, `${name}-3-mask-edited.png`) });
        await page.locator('.pg-cropcanvas').screenshot({ path: path.join(outDir, `${name}-3-crop-edited.png`) });
        // undo works
        const before = (await page.evaluate(() => window.__pgp.app.snapshot())).maskSummary;
        await page.click('button[data-action="undo"]');
        const afterUndo = (await page.evaluate(() => window.__pgp.app.snapshot())).maskSummary;
        entry.undoChangedCoverage = before.coverage !== afterUndo.coverage;
        // redo the last edit so the confirmed mask includes it
        const last = c.edits[c.edits.length - 1];
        await page.evaluate((e) => window.__pgp.app.editor.stroke(e.points, e.mode, e.radius), last);
      }
      // internal gaps: report, then fill all but the largest (the real opening) and report again
      entry.gapsBeforeFill = await page.locator('#pgp-gaps-warning').textContent().catch(() => null);
      if (entry.gapsBeforeFill) {
        await page.click('#pgp-fill-holes-keep-largest');
        await page.waitForTimeout(100);
        entry.gapsAfterFill = await page.locator('#pgp-gaps-warning').textContent().catch(() => null);
        await page.locator('.pg-cropcanvas').screenshot({ path: path.join(outDir, `${name}-3b-crop-holes-filled.png`) });
      }
      entry.maskLayers = (await page.evaluate(() => window.__pgp.app.snapshot())).maskLayers;
      entry.maskAfter = (await page.evaluate(() => window.__pgp.app.snapshot())).maskSummary;
      await page.click('#pgp-confirm-mask');
      await page.waitForSelector('#pgp-mask-verdict');
      entry.maskVerdict = await page.locator('#pgp-mask-verdict').textContent();
      const snap3 = await page.evaluate(() => window.__pgp.app.snapshot());
      entry.stages = snap3.stages;
      entry.record = { category: snap3.record.category, masks: snap3.record.masks, photos: snap3.record.photos.map((p) => ({ original: p.original, normalized: p.normalized })) };
      await page.screenshot({ path: path.join(outDir, `${name}-4-checkpoint-b.png`), fullPage: true });
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      await page.screenshot({ path: path.join(outDir, `${name}-error.png`) }).catch(() => {});
    }
    report.cases.push(entry);
  }

  // --- stage 05 on special files: large + EXIF-rotated, png, webp — compare the browser's working copy with a node reference
  report.extra.special = [];
  for (const f of ['big_upright_3000x4000.jpg', 'big_exif6_rotated.jpg', 'big_exif8_rotated.jpg', 'big_exif3_rotated.jpg', 'small.png', 'small.webp']) {
    const file = path.join(root, 'fixtures', 'special', f);
    await page.setInputFiles('#pgp-file', file);
    await page.waitForFunction(() => window.__pgp.app.photo !== null, null, { timeout: 60000 });
    const info = await page.evaluate(async () => {
      const p = window.__pgp.app.photo;
      const buf = await (await fetch(p.previewUrl)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return { ref: p.ref, width: p.working.width, height: p.working.height, png: btoa(bin) };
    });
    const browserRaw = await sharp(Buffer.from(info.png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const refRaw = await sharp(file).rotate().resize(info.width, info.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let err = 0;
    const n = info.width * info.height;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) err += Math.abs(browserRaw.data[i * 4 + c] - refRaw.data[i * 4 + c]);
    const mae = err / (n * 3);
    const meta = await sharp(file).metadata();
    report.extra.special.push({ file, storedWidth: meta.width, storedHeight: meta.height, exifOrientation: meta.orientation ?? null, original: info.ref.original, working: { width: info.width, height: info.height, scale: info.ref.normalized.toOriginal[0] }, maeVsNodeReference: Number(mae.toFixed(2)), orientationOk: mae < 12 });
    // wait for the category step so the next file replaces a settled state
    await page.waitForSelector('.pgp-sugg, #pgp-manual-mode', { timeout: 60000 });
  }

  // --- error handling: unsupported type, fake HEIC, photo replaced mid-way
  await page.setInputFiles('#pgp-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForTimeout(300);
  report.extra.unsupportedTypeMessage = await page.locator('.pgp-note.is-err').first().textContent().catch(() => null);
  await page.setInputFiles('#pgp-file', { name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99]) });
  await page.waitForTimeout(500);
  report.extra.heicMessage = await page.locator('.pgp-note.is-err').first().textContent().catch(() => null);
  // replace photo while segmentation is running -> old results must not survive
  await page.setInputFiles('#pgp-file', path.join(root, 'fixtures', 'photos', 'tshirt_fbb96cbf.jpg'));
  await page.waitForSelector('.pgp-sugg', { timeout: 60000 });
  await page.click('button[data-confirm="tshirt"]');
  await page.waitForTimeout(50); // segmentation now running
  await page.setInputFiles('#pgp-file', path.join(root, 'fixtures', 'photos', 'tshirt_e330e5fa.jpg'));
  await page.waitForSelector('.pgp-sugg', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const snapR = await page.evaluate(() => window.__pgp.app.snapshot());
  report.extra.replaceMidway = { stages: snapR.stages, photoFile: snapR.record.photos[0]?.original.fileName, categoryConfirmed: snapR.record.category.confirmed, hasSegmentation: !!snapR.segmentation };
  await page.screenshot({ path: path.join(outDir, '99-after-replace-midway.png') });
  await browser.close();
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
await writeFile(path.join(root, 'reports', 'stage-05-07-e2e.json'), JSON.stringify(report, null, 2));
const ok = report.errors.length === 0 && report.cases.every((c) => !c.error);
console.log(JSON.stringify({ cases: report.cases.map((c) => ({ file: c.file, top1: c.suggestions?.[0]?.category, verdict: c.verdict?.slice(0, 60), mask: c.segmentation?.quality, error: c.error })), errors: report.errors, extra: report.extra }, null, 2));
console.log(ok ? 'E2E: PASS' : 'E2E: FAIL');
process.exit(ok ? 0 : 1);
