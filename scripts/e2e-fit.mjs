// F04 e2e: run the chain on two shirts, then put them on the mannequin (presets, fit / as-photographed) and snapshot.
//   npm run e2e:fit   → reports/stage-F04-e2e.json, renders/stage-F/
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = 5179;
const base = `http://127.0.0.1:${port}/garment.html`;
const outDir = path.join(root, 'renders', 'stage-F');
await mkdir(outDir, { recursive: true });
const CASES = [
  { file: 'tshirt_fbb96cbf.jpg', label: 'puma-print' },
  { file: 'tshirt_8f0cd82c.jpg', label: 'striped' },
];
const PRESETS = ['male-m', 'female-m', 'male-l'];
async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('dev server not up');
}
const save = async (dataUrl, file) => writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
const report = { generatedAt: new Date().toISOString(), cases: [], errors: [] };
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
    const entry = { label: c.label, fits: [] };
    try {
      await page.setInputFiles('#pgp-file', path.join(root, 'fixtures', 'photos', c.file));
      await page.waitForSelector('.pgp-sugg, #pgp-manual-mode', { timeout: 60000 });
      await page.click('button[data-confirm="tshirt"]');
      await page.waitForSelector('.pg-maskcanvas', { timeout: 120000 });
      await page.waitForTimeout(200);
      await page.click('#pgp-confirm-mask');
      await page.waitForSelector('.pg-lmeditor canvas', { timeout: 30000 });
      await page.click('#pgp-confirm-landmarks');
      await page.waitForSelector('#pgp-confirm-shape');
      await page.click('#pgp-confirm-shape');
      await page.waitForSelector('#pgp-pixel-canvas', { timeout: 90000 });
      await page.waitForTimeout(300);
      // alone (reference)
      await page.evaluate(() => window.__pgp.app.viewer.setMode('pixel'));
      await save(await page.evaluate(() => { const v = window.__pgp.app.viewer; v.setView('front'); return v.snapshot(); }), path.join(outDir, `${c.label}-alone-front.png`));
      for (const preset of PRESETS) {
        for (const fitToBody of [true, false]) {
          const fit = await page.evaluate(({ preset, fitToBody }) => {
            const a = window.__pgp.app;
            a.fitOpts.enabled = true;
            a.fitOpts.preset = preset;
            a.fitOpts.fitToBody = fitToBody;
            const f = a.runFit();
            return { status: f.status, scale: f.scale, fitAdjust: f.fitAdjust, rings: f.rings.map((r) => `${r.ring}:${r.status}`), checks: f.checks.map((x) => `${x.pass ? 'PASS' : x.level === 'warn' ? 'WARN' : 'FAIL'} ${x.name}`), pushed: f.pushedVertices, maxPush: f.maxPush, record: a.record.fit, avatar: a.record.avatar };
          }, { preset, fitToBody });
          entry.fits.push({ preset, fitToBody, ...fit });
          const tag = `${c.label}-${preset}-${fitToBody ? 'fit' : 'photo'}`;
          const views = fitToBody ? ['front', 'back', 'threequarter', 'left'] : ['front'];
          for (const view of views) {
            const url = await page.evaluate((v) => { const vw = window.__pgp.app.viewer; vw.setView(v); return vw.snapshot(); }, view);
            await save(url, path.join(outDir, `${tag}-${view}.png`));
          }
        }
      }
      // UI state with the fit table
      await page.evaluate(() => { const a = window.__pgp.app; a.fitOpts.fitToBody = true; a.fitOpts.preset = 'male-m'; a.runFit(); a.refreshPreview(); });
      await page.waitForSelector('#pgp-fit-rings', { timeout: 10000 });
      // UI round-trip: the checkbox really drives the fit
      await page.click('#pgp-fit-enabled');
      entry.uiOff = await page.evaluate(() => ({ enabled: window.__pgp.app.fitOpts.enabled, hasBody: window.__pgp.app.viewer.hasBody() }));
      await page.click('#pgp-fit-enabled');
      await page.waitForSelector('#pgp-fit-rings', { timeout: 10000 });
      entry.uiStatus = await page.locator('#pgp-fit-status').textContent();
      await page.locator('.pgp-fit').screenshot({ path: path.join(outDir, `${c.label}-fit-panel.png`) });
      // take it off again: record.fit cleared, garment back to its own shape
      entry.off = await page.evaluate(() => { const a = window.__pgp.app; a.fitOpts.enabled = false; a.runFit(); return { fit: a.record.fit, hasBody: a.viewer.hasBody() }; });
      await page.click('#pgp-reset');
      await page.waitForTimeout(200);
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      await page.screenshot({ path: path.join(outDir, `${c.label}-error.png`), fullPage: true }).catch(() => {});
    }
    report.cases.push(entry);
  }
  await browser.close();
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
await writeFile(path.join(root, 'reports', 'stage-F04-e2e.json'), JSON.stringify(report, null, 2));
const ok = report.errors.length === 0 && report.cases.every((c) => !c.error && c.fits.filter((f) => f.fitToBody).every((f) => f.status !== 'intersects' && f.checks.every((x) => !x.startsWith('FAIL'))) && c.off && c.off.fit === null && c.off.hasBody === false);
console.log(JSON.stringify(report.cases.map((c) => ({ label: c.label, error: c.error, fits: c.fits.map((f) => `${f.preset} ${f.fitToBody ? 'fit' : 'photo'}: ${f.status} adj=${f.fitAdjust.map((a) => a.name).join(',')}`) })), null, 1));
console.log('errors', report.errors);
console.log(ok ? 'E2E-FIT: PASS' : 'E2E-FIT: FAIL');
process.exit(ok ? 0 : 1);
