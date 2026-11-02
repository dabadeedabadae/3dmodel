// Checkpoint C end-to-end: photo -> category -> mask -> landmarks -> params -> UV -> colour -> pixel -> 3D viewer,
// in headless Chromium over real fixture photos. Writes renders/stage-08-12/ and reports/stage-08-12-e2e.json.
//   npm run e2e:chain
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = 5177;
const base = `http://127.0.0.1:${port}/garment.html`;
const outDir = path.join(root, 'renders', 'stage-08-12');
await mkdir(outDir, { recursive: true });

const CASES = [
  { file: 'tshirt_fbb96cbf.jpg', label: 'puma-print', edits: [], hard: false },
  { file: 'tshirt_8f0cd82c.jpg', label: 'striped', edits: [], hard: false, confirmOverride: 'tshirt' },
  { file: 'tshirt_bb140894.jpg', label: 'plain-grey', edits: [], hard: false },
  {
    file: 'tshirt_91ebc326.jpg',
    label: 'navy-hard',
    hard: true,
    edits: [
      { mode: 'add', radius: 16, points: [{ x: 42, y: 205 }, { x: 358, y: 205 }] },
      { mode: 'add', radius: 16, points: [{ x: 95, y: 245 }, { x: 330, y: 245 }] },
      { mode: 'add', radius: 14, points: [{ x: 100, y: 268 }, { x: 320, y: 268 }] },
    ],
  },
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
const dataUrlToFile = async (dataUrl, file) => writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
const report = { generatedAt: new Date().toISOString(), cases: [], errors: [], reentry: null };
try {
  await waitServer();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`console: ${m.text()}`);
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__pgp && window.__pgp.ready);
  await page.waitForFunction(() => window.__pgp.app.client.info !== null, null, { timeout: 120000 });

  for (const c of CASES) {
    const name = c.label;
    const entry = { file: c.file, label: name, hard: c.hard };
    try {
      await page.setInputFiles('#pgp-file', path.join(root, 'fixtures', 'photos', c.file));
      await page.waitForSelector('.pgp-sugg, #pgp-manual-mode', { timeout: 60000 });
      entry.categoryTop1 = (await page.evaluate(() => window.__pgp.app.snapshot())).category?.suggestions?.[0]?.category ?? null;
      await page.click('button[data-confirm="tshirt"]');
      await page.waitForSelector('.pg-maskcanvas', { timeout: 120000 });
      await page.waitForTimeout(200);
      for (const e of c.edits) await page.evaluate((e) => window.__pgp.app.editor.stroke(e.points, e.mode, e.radius), e);
      if (c.hard) {
        await page.click('#pgp-fill-holes-keep-largest').catch(() => {});
        await page.waitForTimeout(100);
      }
      await page.locator('.pg-cropcanvas').screenshot({ path: path.join(outDir, `${name}-1-mask.png`) });
      await page.click('#pgp-confirm-mask');
      await page.waitForSelector('#pgp-mask-verdict');
      entry.maskVerdict = await page.locator('#pgp-mask-verdict').textContent();
      entry.maskHeuristic = (await page.evaluate(() => window.__pgp.app.snapshot())).maskLayers?.user;
      // 08 landmarks
      await page.waitForSelector('.pg-lmeditor canvas', { timeout: 30000 });
      await page.waitForTimeout(100);
      entry.landmarks = await page.evaluate(() => {
        const a = window.__pgp.app;
        return { status: a.landmarkEst.status, checks: a.landmarkEst.checks, points: a.landmarkEditor.getPoints() };
      });
      await page.locator('.pg-lmeditor .pg-maskscroll').screenshot({ path: path.join(outDir, `${name}-2-landmarks.png`) });
      await page.click('#pgp-confirm-landmarks');
      await page.waitForSelector('#pgp-confirm-shape');
      entry.paramLayers = await page.evaluate(() => {
        const L = window.__pgp.app.layers;
        return { estimated: L.estimated, applied: L.applied, clamped: L.clamped, user: L.user, resolved: L.resolved, ratios: L.ratios, note: L.note };
      });
      await page.locator('.pgp-params').screenshot({ path: path.join(outDir, `${name}-3-params.png`) });
      // 09 -> 10/11
      await page.click('#pgp-confirm-shape');
      await page.waitForSelector('#pgp-uv-raw', { timeout: 60000 });
      await page.waitForTimeout(200);
      entry.texture = (await page.evaluate(() => window.__pgp.app.store.get('texture_ready'))).value;
      entry.baseColor = await page.evaluate(() => window.__pgp.app.record.baseColor);
      entry.orientation = await page.evaluate(() => window.__pgp.app.corrOrientation());
      // front panel: u follows image x, v follows image -y. Sleeves: u runs top->bottom (image +y), v runs along the
      // sleeve axis: outward = image +x for the wearer's LEFT sleeve (image right), -x for the right one.
      const o = entry.orientation;
      entry.notMirrored = !!o && o.front.ux > 0.9 && o.front.vy < -0.5;
      entry.sleeveOrientationOk = !!o && o.sleeve_left.uy > 0.5 && o.sleeve_left.vx > 0.5 && o.sleeve_right.uy > 0.5 && o.sleeve_right.vx < -0.5;
      await dataUrlToFile(await page.evaluate(() => document.querySelector('#pgp-uv-raw').toDataURL('image/png')), path.join(outDir, `${name}-4-uv-raw.png`));
      await dataUrlToFile(await page.evaluate(() => document.querySelector('#pgp-uv-grid').toDataURL('image/png')), path.join(outDir, `${name}-4-uv-grid.png`));
      // lighting correction 0.5
      await page.locator('#pgp-lighting').fill('0.5');
      await page.locator('#pgp-lighting').dispatchEvent('change');
      await page.waitForSelector('#pgp-uv-lit', { timeout: 60000 });
      await page.waitForTimeout(200);
      await dataUrlToFile(await page.evaluate(() => document.querySelector('#pgp-uv-lit').toDataURL('image/png')), path.join(outDir, `${name}-4-uv-lit.png`));
      // 12 pixel + viewer
      await page.waitForSelector('#pgp-pixel-canvas', { timeout: 60000 });
      await page.waitForTimeout(300);
      entry.pixel = (await page.evaluate(() => window.__pgp.app.store.get('preview_ready'))).value;
      await dataUrlToFile(await page.evaluate(() => document.querySelector('#pgp-pixel-canvas').toDataURL('image/png')), path.join(outDir, `${name}-5-uv-pixel-256.png`));
      for (const mode of ['original', 'pixel']) {
        await page.evaluate((m) => window.__pgp.app.viewer.setMode(m), mode);
        for (const view of ['front', 'back', 'threequarter', 'threequarter_back']) {
          const url = await page.evaluate((v) => {
            const vw = window.__pgp.app.viewer;
            vw.setView(v);
            return vw.snapshot();
          }, view);
          await dataUrlToFile(url, path.join(outDir, `${name}-6-3d-${mode}-${view}.png`));
        }
      }
      // pixel at 128 with 8 colours for comparison
      await page.selectOption('#pgp-pixel-size', '128');
      await page.waitForTimeout(400);
      await dataUrlToFile(await page.evaluate(() => document.querySelector('#pgp-pixel-canvas').toDataURL('image/png')), path.join(outDir, `${name}-5-uv-pixel-128.png`));
      await page.selectOption('#pgp-pixel-size', '256');
      await page.waitForTimeout(400);
      // export
      await page.click('#pgp-export-c');
      await page.waitForTimeout(300);
      entry.stages = (await page.evaluate(() => window.__pgp.app.snapshot())).stages;
      await page.screenshot({ path: path.join(outDir, `${name}-7-page.png`), fullPage: true });
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      await page.screenshot({ path: path.join(outDir, `${name}-error.png`), fullPage: true }).catch(() => {});
    }
    report.cases.push(entry);
  }

  // re-entry: on the last case, move a landmark after everything is built -> downstream stages must reset, then rebuild
  try {
    const before = (await page.evaluate(() => window.__pgp.app.snapshot())).stages;
    await page.evaluate(() => {
      const a = window.__pgp.app;
      const p = a.landmarkEditor.getPoints().hem_left;
      a.landmarkEditor.movePoint('hem_left', p.x + 6, p.y - 4);
    });
    await page.waitForTimeout(200);
    const after = (await page.evaluate(() => window.__pgp.app.snapshot())).stages;
    await page.click('#pgp-confirm-landmarks');
    await page.click('#pgp-confirm-shape');
    await page.waitForSelector('#pgp-pixel-canvas', { timeout: 60000 });
    await page.waitForTimeout(300);
    const rebuilt = (await page.evaluate(() => window.__pgp.app.snapshot())).stages;
    const userAdjusted = (await page.evaluate(() => window.__pgp.app.record.landmarks)).filter((l) => l.source === 'user_adjusted').map((l) => l.name);
    report.reentry = { before, afterEdit: after, rebuilt, userAdjusted };
  } catch (e) {
    report.reentry = { error: String(e) };
  }
  await browser.close();
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
await writeFile(path.join(root, 'reports', 'stage-08-12-e2e.json'), JSON.stringify(report, null, 2));
const ok = report.errors.length === 0 && report.cases.every((c) => !c.error && c.notMirrored !== false);
console.log(JSON.stringify({ cases: report.cases.map((c) => ({ label: c.label, top1: c.categoryTop1, mask: c.maskHeuristic?.status, landmarks: c.landmarks?.status, clamped: c.paramLayers?.clamped?.map((x) => x.name), coverage: c.texture?.coverage, notMirrored: c.notMirrored, sleeveOrientationOk: c.sleeveOrientationOk, error: c.error })), reentry: report.reentry, errors: report.errors }, null, 2));
console.log(ok ? 'E2E-CHAIN: PASS' : 'E2E-CHAIN: FAIL');
process.exit(ok ? 0 : 1);
