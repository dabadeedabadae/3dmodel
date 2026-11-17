/**
 * Stage I-06 — export. Writes the current body as GLB (binary glTF) plus a manifest with the asset id, version,
 * topology version, weights and the measurements that were actually taken from the exported mesh.
 *   node --import tsx imported-body/scripts/export.ts [--pose a|t] [--height 180] [--chest 0.4] ...
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadAsset } from '../src/load';
import { deform, WEIGHT_NAMES, type Weights } from '../src/deform';
import { buildSkeleton, computeSkin } from '../src/rig';
import { verifiedAPose } from '../src/pose';
import { measureImported } from '../src/measure';
import { ASSET_VERSION, TOPOLOGY_VERSION } from '../src/asset';

// three's GLTFExporter finishes a binary export through FileReader, which Node does not define. Blob does
// exist here, so a four-line adapter is enough — no extra dependency, no change to the exporter.
if (typeof (globalThis as any).FileReader === 'undefined') {
  (globalThis as any).FileReader = class {
    onloadend: null | (() => void) = null;
    result: ArrayBuffer | null = null;
    readAsArrayBuffer(blob: Blob) {
      blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); });
    }
  };
}

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1]! : d);
const asset = loadAsset();
const w: Partial<Weights> = {};
for (const n of WEIGHT_NAMES) { const v = opt(n); if (v !== undefined) w[n] = Number(v); }
const height_cm = Number(opt('height', String(asset.landmarks.height * 100)));
const mode = (opt('mode', 'keep_girths') as 'keep_girths' | 'proportional');
const wantPose = opt('pose', 'a');

const base = deform(asset, w, { mode, height_cm });
const measurements = measureImported(asset, base);
let positions = base;
let poseInfo: Record<string, unknown> = { pose: 't' };
if (wantPose === 'a') {
  const sk = computeSkin(asset, base, buildSkeleton(asset, base));
  const v = verifiedAPose(asset, base, sk);
  positions = v.positions;
  poseInfo = { pose: v.verified ? 'a' : 't', shoulderDegrees: v.shoulderDegrees, verified: v.verified, failed: v.failed };
}
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
g.setIndex(Array.from(asset.index));
g.computeVertexNormals();
const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'body', color: 0xc9ccd4, flatShading: true, roughness: 0.75, metalness: 0.02 }));
mesh.name = `${asset.id}-${ASSET_VERSION}`;

mkdirSync('imported-body/out', { recursive: true });
const file = opt('out', `imported-body/out/body-${wantPose}pose.glb`)!;
await new Promise<void>((resolve, reject) => {
  new GLTFExporter().parse(
    mesh,
    (res) => {
      writeFileSync(file, Buffer.from(res as ArrayBuffer));
      resolve();
    },
    (e) => reject(e),
    { binary: true },
  );
});
const manifest = {
  generatedAt: new Date().toISOString(),
  asset: { id: asset.id, version: ASSET_VERSION, topologyVersion: TOPOLOGY_VERSION },
  weights: w,
  height_cm,
  heightMode: mode,
  ...poseInfo,
  measurements,
  file,
  vertices: positions.length / 3,
  triangles: asset.index.length / 3,
};
writeFileSync(file.replace(/\.glb$/, '.manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ ...manifest, measurements: { ...measurements, levels_m: undefined } }, null, 2));
