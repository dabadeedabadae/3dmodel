import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const prefix = process.argv[2] ?? 'import-01';
const port = 5183;
const base = `http://127.0.0.1:${port}/imported-body/viewer/index.html`;
const outDir = path.join(root, 'imported-body/renders');
await mkdir(outDir, { recursive: true });
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
const errors = [];
try {
  for (let i = 0; i < 160; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 820, height: 1000 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const A = process.env.IB_A ? `asset=${process.env.IB_A}&` : '';
  const shots = process.argv[3] === 'outfit'
    ? [['base',`${A}view=front`],['tq',`${A}view=threequarter`],['slim',`${A}preset=slim&view=front`],['round',`${A}preset=round&view=front`],['athletic',`${A}preset=athletic&view=front`],['tall',`${A}preset=tall&view=front`]]
    : process.argv[3] === 'presets'
    ? [['base','preset=base&view=front'],['athletic','preset=athletic&view=front'],['round','preset=round&view=front'],['slim','preset=slim&view=front'],['tall','preset=tall&view=front'],['athletic-tq','preset=athletic&view=threequarter']]
    : process.argv[3] === 'sim'
    ? [['front','sim=tshirt-base&view=front'],['tq','sim=tshirt-base&view=threequarter'],['left','sim=tshirt-base&view=left'],['back','sim=tshirt-base&view=back'],['hero','sim=tshirt-base&view=threequarter'],['colliders','sim=tshirt-base&view=threequarter&colliders=1'],['fitmap','sim=tshirt-base&view=front&fitmap=1'],['fitmap-tq','sim=tshirt-base&view=threequarter&fitmap=1']]
    : process.argv[3] === 'garment'
    ? [['front','garment='+(process.env.IB_G||'tshirt')+'&view=front'],['tq','garment='+(process.env.IB_G||'tshirt')+'&view=threequarter'],['left','garment='+(process.env.IB_G||'tshirt')+'&view=left'],['wire','garment='+(process.env.IB_G||'tshirt')+'&view=threequarter&wire=1']]
    : process.argv[3] === 'dressed'
    ? [['base','dressed=base&view=front'],['base-tq','dressed=base&view=threequarter'],['athletic','dressed=athletic&view=front'],['round','dressed=round&view=front'],['slim','dressed=slim&view=front'],['tall','dressed=tall&view=threequarter']]
    : process.argv[3] === 'pose'
    ? [['apose-front','pose=a&view=front'],['apose-tq','pose=a&view=threequarter'],['apose-left','pose=a&view=left'],['apose-athletic','pose=a&preset=athletic&view=front'],['apose-round','pose=a&preset=round&view=threequarter']]
    : [['front','view=front'],['left','view=left'],['back','view=back'],['tq','view=threequarter'],['front-wire','view=front&wire=1'],['tq-wire','view=threequarter&wire=1']];
  for (const [name, qs] of shots) {
    await page.goto(`${base}?ui=0&${qs}`);
    await page.waitForFunction(() => window.__ib && window.__ib.ready, null, { timeout: 40000 });
    await page.waitForTimeout(120);
    await page.locator('canvas').screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
  }
  await browser.close();
} finally { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
console.log('renders done, errors:', errors.length); for (const e of errors) console.log(' ', e);
process.exit(errors.length ? 1 : 0);
