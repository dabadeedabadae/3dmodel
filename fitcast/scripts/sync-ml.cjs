// Copies the on-device recognition assets for the browser:
//   onnxruntime-web wasm runtime  → frontend/public/ort/
//   U²-Netp model (Apache-2.0)    → frontend/public/ml/u2netp.onnx (+ licence) from the 3D module
//   MobileNetV2-12 (Apache-2.0)   → frontend/public/ml/mobilenetv2-12.onnx + synset.txt (+ licence): garment type (I-75)
// The runtime is git-ignored (copied from node_modules); run once after npm install (npm run ml:sync).
const { copyFileSync, mkdirSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const ORT = resolve('frontend/node_modules/onnxruntime-web/dist');
const MODELS = resolve(process.env.MODELS_SRC ?? '../public/models');
mkdirSync('frontend/public/ort', { recursive: true });
mkdirSync('frontend/public/ml', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(resolve(ORT, f), resolve('frontend/public/ort', f));
// the model itself is committed in frontend/public/ml (Apache-2.0); refresh it from the 3D module when that is next to us
for (const f of ['u2netp.onnx', 'U-2-Net-LICENSE.txt', 'mobilenetv2-12.onnx', 'synset.txt', 'onnx-models-LICENSE.txt']) {
  if (existsSync(resolve(MODELS, f))) copyFileSync(resolve(MODELS, f), resolve('frontend/public/ml', f));
  else if (!existsSync(resolve('frontend/public/ml', f))) throw new Error('missing ' + resolve(MODELS, f));
}
console.log('ml assets -> frontend/public/ort, frontend/public/ml');
