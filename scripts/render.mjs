// Renders the dev page with headless Chromium (Playwright) into renders/.
// Usage: node scripts/render.mjs [--out renders] [--prefix stage-03] [--port 5174]
// Requires: npx playwright install chromium  (once per machine)
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const outDir = path.resolve(projectRoot, opt('out', 'renders'));
const prefix = opt('prefix', 'stage-03');
const port = Number(opt('port', '5174'));
const baseUrl = `http://127.0.0.1:${port}/`;

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server did not start on ${url}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  const manifest = { generatedAt: new Date().toISOString(), baseUrl, files: [], errors: [] };
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => manifest.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') manifest.errors.push(`console: ${m.text()}`);
    });

    const shots = [
      ['front', 'view=front&checker=0&mannequin=1'],
      ['back', 'view=back&checker=0&mannequin=1'],
      ['left', 'view=left&checker=0&mannequin=1'],
      ['right', 'view=right&checker=0&mannequin=1'],
      ['iso', 'view=iso&checker=0&mannequin=1'],
      ['front-checker', 'view=front&checker=1&mannequin=0'],
      ['back-checker', 'view=back&checker=1&mannequin=0'],
      ['left-checker', 'view=left&checker=1&mannequin=0'],
      ['right-checker', 'view=right&checker=1&mannequin=0'],
      ['iso-checker-wire', 'view=iso&checker=1&wire=1&mannequin=0'],
      ['front-wire-nomannequin', 'view=front&checker=0&wire=1&mannequin=0&flat=1'],
      ['iso-flat', 'view=iso&checker=0&flat=1&mannequin=1'],
      ['front-params-long-wide', 'view=front&checker=1&mannequin=0&params=' + encodeURIComponent(JSON.stringify({ length: 0.9, chestHalfWidth: 0.58, hemHalfWidth: 0.62, sleeveLength: 0.4, neckHalfWidth: 0.24 }))],
      // the former "wings" case: narrow shoulder + small tilt; the clamp now widens the shoulder (shown in the panel)
      ['front-wings-request-after-fix', 'view=front&checker=0&mannequin=0&params=' + encodeURIComponent(JSON.stringify({ length: 0.9, chestHalfWidth: 0.58, hemHalfWidth: 0.62, sleeveLength: 0.4, neckHalfWidth: 0.24, shoulderHalfWidth: 0.4, sleeveAngle: 0.1 }))],
      // narrow shoulder allowed because the sleeve tilt compensates (non-boxy, still horizontal-or-down)
      ['front-narrow-shoulder-tilted', 'view=front&checker=0&mannequin=0&params=' + encodeURIComponent(JSON.stringify({ chestHalfWidth: 0.5, shoulderHalfWidth: 0.42, armholeDepth: 0.3, sleeveAngle: 0.5 }))],
      ['front-plain', 'view=front&checker=0&mannequin=0'],
      ['top-checker', 'view=top&checker=1&mannequin=0&testobject=0'],
      ['top-wire', 'view=top&checker=0&wire=1&flat=1&mannequin=0&testobject=0'],
      ['threequarter-checker', 'view=threequarter&checker=1&mannequin=0&testobject=0'],
      ['threequarter-wire', 'view=threequarter&checker=0&wire=1&flat=1&mannequin=0&testobject=0'],
      ['threequarter-back-wire', 'view=threequarter_back&checker=0&wire=1&flat=1&mannequin=0&testobject=0'],
      ['iso-plain', 'view=iso&checker=0&mannequin=0'],
      ['front-params-short-narrow', 'view=front&checker=1&mannequin=0&params=' + encodeURIComponent(JSON.stringify({ length: 0.45, chestHalfWidth: 0.32, hemHalfWidth: 0.32, sleeveLength: 0.1, neckHalfWidth: 0.1, sleeveAngle: 0.7 }))],
    ];
    const viewImages = {};
    for (const [name, query] of shots) {
      await page.goto(`${baseUrl}?${query}`);
      await page.waitForFunction(() => window.__pg && window.__pg.ready, null, { timeout: 20000 });
      await page.waitForTimeout(150);
      const file = path.join(outDir, `${prefix}-${name}.png`);
      // viewport-only screenshot (3D canvas) for the views, full page for one overview
      const canvas = page.locator('.pg-viewport canvas');
      await canvas.screenshot({ path: file });
      manifest.files.push(path.relative(projectRoot, file));
      if (['front', 'back', 'left', 'right', 'front-checker', 'back-checker', 'left-checker', 'right-checker'].includes(name)) {
        viewImages[name] = await canvas.screenshot({ type: 'png' });
      }
      const err = await page.evaluate(() => window.__pg.error);
      if (err) manifest.errors.push(`${name}: ${err}`);
    }
    // full page with panel (shows sliders + in-browser check report)
    await page.goto(`${baseUrl}?view=iso&checker=1&mannequin=1`);
    await page.waitForFunction(() => window.__pg && window.__pg.ready, null, { timeout: 20000 });
    await page.waitForTimeout(150);
    const full = path.join(outDir, `${prefix}-page-with-panel.png`);
    // panel with a clamped request visible
    {
      await page.goto(`${baseUrl}?view=front&checker=0&mannequin=0&params=` + encodeURIComponent(JSON.stringify({ chestHalfWidth: 0.58, shoulderHalfWidth: 0.4, sleeveAngle: 0.1 })));
      await page.waitForFunction(() => window.__pg && window.__pg.ready, null, { timeout: 20000 });
      const f = path.join(outDir, `${prefix}-panel-clamped-request.png`);
      await page.screenshot({ path: f, fullPage: false });
      manifest.files.push(path.relative(projectRoot, f));
      manifest.clampedRequestText = await page.locator('.pg-clamp').innerText();
      await page.goto(`${baseUrl}?view=iso&checker=1&mannequin=1`);
      await page.waitForFunction(() => window.__pg && window.__pg.ready, null, { timeout: 20000 });
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: full, fullPage: false });
    manifest.files.push(path.relative(projectRoot, full));
    const report = await page.evaluate(() => window.__pg.app.getReport());
    manifest.inBrowserChecks = report;

    // UV layout + checker PNGs straight from the page canvases
    const uvDataUrl = await page.evaluate(() => window.__pg.app.uvLayoutDataURL());
    const uvFile = path.join(outDir, `${prefix}-uv-layout.png`);
    await writeFile(uvFile, Buffer.from(uvDataUrl.split(',')[1], 'base64'));
    manifest.files.push(path.relative(projectRoot, uvFile));
    const chDataUrl = await page.evaluate(() => window.__pg.app.checkerDataURL());
    const chFile = path.join(outDir, `${prefix}-uv-checker.png`);
    await writeFile(chFile, Buffer.from(chDataUrl.split(',')[1], 'base64'));
    manifest.files.push(path.relative(projectRoot, chFile));

    // contact sheet: 4 views plain + 4 views checker
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const img = (buf, label) => `<figure style="margin:0"><img src="data:image/png;base64,${buf.toString('base64')}" style="width:380px;height:auto;display:block;border:1px solid #ccc"><figcaption style="font:13px sans-serif;text-align:center;margin-top:4px">${label}</figcaption></figure>`;
    const order = ['front', 'back', 'left', 'right'];
    const html = `<body style="margin:0;background:#fff;font-family:sans-serif"><h2 style="margin:12px 16px 4px;font-size:16px">FitCast photo-garments · ${prefix} · tshirt-basic on TEST mannequin (placement only, not fitting)</h2>
      <div style="display:flex;gap:12px;padding:8px 16px">${order.map((n) => img(viewImages[n], n)).join('')}</div>
      <div style="display:flex;gap:12px;padding:8px 16px">${order.map((n) => img(viewImages[n + '-checker'], n + ' + UV checker')).join('')}</div></body>`;
    await sheet.setContent(html);
    const sheetFile = path.join(outDir, `${prefix}-contact-sheet.png`);
    await sheet.screenshot({ path: sheetFile, fullPage: true });
    manifest.files.push(path.relative(projectRoot, sheetFile));

    // error-handling evidence: WebGL unavailable path is covered by a flag in a separate context
    const noGl = await browser.newContext({ viewport: { width: 900, height: 500 } });
    const p2 = await noGl.newPage();
    await p2.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (type === 'webgl' || type === 'webgl2') return null;
        return orig.call(this, type, ...rest);
      };
    });
    await p2.goto(baseUrl);
    await p2.waitForFunction(() => window.__pg && window.__pg.ready, null, { timeout: 20000 });
    const noGlFile = path.join(outDir, `${prefix}-error-no-webgl.png`);
    await p2.screenshot({ path: noGlFile });
    manifest.files.push(path.relative(projectRoot, noGlFile));
    manifest.noWebglMessage = await p2.evaluate(() => document.body.innerText.slice(0, 300));
    await noGl.close();

    await browser.close();
  } finally {
    try {
      if (process.platform !== 'win32') process.kill(-server.pid, 'SIGTERM');
      else server.kill('SIGTERM');
    } catch {}
  }
  manifest.serverLogTail = serverLog.split('\n').slice(-5).join('\n');
  const manifestFile = path.join(outDir, `${prefix}-render-manifest.json`);
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`wrote ${manifest.files.length} renders to ${path.relative(projectRoot, outDir)}/ (manifest: ${path.relative(projectRoot, manifestFile)})`);
  if (manifest.errors.length) {
    console.error('page errors:', manifest.errors);
    process.exit(1);
  }
  process.exit(0); // the vite child may keep handles open
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
