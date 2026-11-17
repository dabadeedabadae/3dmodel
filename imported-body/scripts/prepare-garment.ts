/**
 * Garment import: FBX → weld → audit → align to the body by landmarks → out/garment-<id>.json
 *   node --import tsx imported-body/scripts/prepare-garment.ts imported-body/assets/tshirt.fbx tshirt
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const file = process.argv[2]!;
const id = process.argv[3] ?? 'garment';
const buf = readFileSync(file);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
root.updateMatrixWorld(true);
let src: THREE.Mesh | null = null;
root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !src) src = o as THREE.Mesh; });
let g = (src as unknown as THREE.Mesh).geometry.clone().applyMatrix4((src as unknown as THREE.Mesh).matrixWorld);
g.deleteAttribute('normal');
if (g.hasAttribute('uv')) g.deleteAttribute('uv');
const before = g.attributes.position!.count;
g = mergeVertices(g, 1e-5);
const pos = g.attributes.position!.array as Float32Array;
const idx = g.index!.array as Uint32Array;
const n = pos.length / 3, t = idx.length / 3;

// audit: a garment may legitimately be an open shell (neck, hem and cuff openings) — boundary loops are counted
const edge = new Map<string, number>();
const adj: number[][] = Array.from({ length: n }, () => []);
for (let i = 0; i < t; i++) {
  const tri = [idx[i * 3]!, idx[i * 3 + 1]!, idx[i * 3 + 2]!];
  for (let k = 0; k < 3; k++) {
    const u = tri[k]!, v = tri[(k + 1) % 3]!;
    edge.set(u < v ? `${u}_${v}` : `${v}_${u}`, (edge.get(u < v ? `${u}_${v}` : `${v}_${u}`) ?? 0) + 1);
    adj[u]!.push(v); adj[v]!.push(u);
  }
}
let open = 0, over = 0;
for (const c of edge.values()) { if (c === 1) open++; if (c > 2) over++; }
const seen = new Uint8Array(n);
let comps = 0;
for (let s = 0; s < n; s++) {
  if (seen[s]) continue;
  comps++; const st = [s]; seen[s] = 1;
  while (st.length) { const u = st.pop()!; for (const v of adj[u]!) if (!seen[v]) { seen[v] = 1; st.push(v); } }
}
const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute);
const size = new THREE.Vector3(); box.getSize(size);
let eMin = Infinity, eMax = 0, eSum = 0, eN = 0;
for (const key of edge.keys()) {
  const [a, b] = key.split('_').map(Number) as [number, number];
  const d = Math.hypot(pos[a * 3]! - pos[b * 3]!, pos[a * 3 + 1]! - pos[b * 3 + 1]!, pos[a * 3 + 2]! - pos[b * 3 + 2]!);
  eMin = Math.min(eMin, d); eMax = Math.max(eMax, d); eSum += d; eN++;
}
const report = {
  id, source: file,
  weld: { before, after: n, triangles: t },
  shell: { boundaryEdges: open, nonManifoldEdges: over, components: comps },
  bbox: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() },
  edges: { count: eN, min: eMin, max: eMax, mean: eSum / eN },
};
mkdirSync('imported-body/out', { recursive: true });
writeFileSync(`imported-body/out/garment-${id}.json`, JSON.stringify({ ...report, positions: Array.from(pos).map((v) => Number(v.toFixed(6))), index: Array.from(idx) }));
console.log(JSON.stringify(report, null, 2));
