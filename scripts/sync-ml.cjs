// Copies the on-device recognition assets for the browser:
//   onnxruntime-web wasm runtime  → frontend/public/ort/
//   U²-Netp model (Apache-2.0)    → frontend/public/ml/u2netp.onnx (+ licence) from the 3D module
// Git-ignored; run once after npm install (npm run ml:sync).
const { copyFileSync, mkdirSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const ORT = resolve('frontend/node_modules/onnxruntime-web/dist');
const MODELS = resolve(process.env.MODELS_SRC ?? '../3dmodel/public/models');
mkdirSync('frontend/public/ort', { recursive: true });
mkdirSync('frontend/public/ml', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(resolve(ORT, f), resolve('frontend/public/ort', f));
for (const f of ['u2netp.onnx', 'U-2-Net-LICENSE.txt']) {
  if (!existsSync(resolve(MODELS, f))) throw new Error('missing ' + resolve(MODELS, f));
  copyFileSync(resolve(MODELS, f), resolve('frontend/public/ml', f));
}
console.log('ml assets -> frontend/public/ort, frontend/public/ml');
