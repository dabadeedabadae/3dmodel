// Renders body.html (procedural mannequin) with headless Chromium into renders/stage-M/.
//   npm run render:body
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = 5178;
const base = `http://127.0.0.1:${port}/body.html`;
const outDir = path.join(root, 'renders', 'stage-M');
await mkdir(outDir, { recursive: true });

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
const manifest = { generatedAt: new Date().toISOString(), files: [], errors: [], reports: {} };
try {
  await waitServer();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => manifest.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') manifest.errors.push(`console: ${m.text()}`);
  });
  const shots = [];
  for (const preset of ['male-m', 'female-m']) {
    for (const view of ['front', 'back', 'left', 'threequarter', 'top']) shots.push([`${preset}-${view}`, `preset=${preset}&view=${view}`]);
    shots.push([`${preset}-front-wire`, `preset=${preset}&view=front&wire=1`]);
    shots.push([`${preset}-threequarter-landmarks`, `preset=${preset}&view=threequarter&landmarks=1&parts=1`]);
  }
  for (const preset of ['male-s', 'male-l', 'female-s', 'female-l']) shots.push([`${preset}-front`, `preset=${preset}&view=front`]);
  // extreme sliders: the clamps must keep it human
  shots.push(['extreme-wide-chest-front', `view=front&params=${encodeURIComponent(JSON.stringify({ chestCirc: 1.4, waistCirc: 1.3, upperArmCirc: 0.42, shoulderWidth: 0.32 }))}`]);
  shots.push(['extreme-tall-thin-front', `view=front&params=${encodeURIComponent(JSON.stringify({ height: 2.05, headRatio: 8.4, chestCirc: 0.75, waistCirc: 0.6, hipCirc: 0.78, legRatio: 0.51 }))}`]);
  for (const [name, query] of shots) {
    await page.goto(`${base}?${query}`);
    await page.waitForFunction(() => window.__pg && window.__pg.ready, null, { timeout: 30000 });
    await page.waitForTimeout(150);
    const file = path.join(outDir, `${name}.png`);
    await page.locator('.pg-viewport canvas').screenshot({ path: file });
    manifest.files.push(path.relative(root, file));
    const err = await page.evaluate(() => window.__pg.error);
    if (err) manifest.errors.push(`${name}: ${err}`);
  }
  await page.goto(`${base}?preset=female-l&view=threequarter`);
  await page.waitForFunction(() => window.__pg && window.__pg.ready, null, { timeout: 30000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, 'page-female-l-panel.png') });
  manifest.files.push('renders/stage-M/page-female-l-panel.png');
  manifest.reports['female-l'] = await page.evaluate(() => window.__pg.app.getReport());
  manifest.clampText = await page.locator('.pg-clamp').innerText();
  await browser.close();
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
await writeFile(path.join(outDir, 'render-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${manifest.files.length} renders → ${path.relative(root, outDir)}; errors: ${manifest.errors.length}`);
for (const e of manifest.errors) console.log('  ' + e);
process.exit(manifest.errors.length ? 1 : 0);
