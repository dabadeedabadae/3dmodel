/**
 * A clean front/side reference of the base figure, to feed back into the generator so every outfit is built
 * on the same body. White background, no shadow, no grid — the generator should see the figure, not our studio.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const port = 5191;
const base = `http://127.0.0.1:${port}/imported-body/viewer/index.html`;
const outDir = path.join(root, 'imported-body/renders');
await mkdir(outDir, { recursive: true });
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
try {
  for (let i = 0; i < 160; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  for (const [name, view] of [['front', 'front'], ['side', 'left'], ['back', 'back']]) {
    await page.goto(`${base}?ui=0&asset=outfit01&clean=1&view=${view}`);
    await page.waitForFunction(() => window.__ib && window.__ib.ready, null, { timeout: 40000 });
    await page.addStyleTag({ content: 'body{background:#fff}' });
    await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) c.style.background = '#fff'; });
    await page.waitForTimeout(150);
    await page.locator('canvas').screenshot({ path: path.join(outDir, `ref-${name}.png`) });
  }
  await browser.close();
} finally { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
console.log('ok');
