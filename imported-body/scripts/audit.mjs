import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const file = process.argv[2];
const buf = readFileSync(file);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
let mesh = null;
root.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
root.updateMatrixWorld(true);

let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
g.deleteAttribute('normal');
const before = g.attributes.position.count;
g = mergeVertices(g, 1e-5);
const after = g.attributes.position.count;
const idx = g.index.array, pos = g.attributes.position.array;
const tCount = idx.length / 3, vCount = after;
console.log(`welded: ${before} -> ${after} vertices, ${tCount} triangles`);

// edges / manifold / orientation / components
const edge = new Map(), dir = new Map(), adj = Array.from({length:vCount},()=>[]);
for (let t = 0; t < tCount; t++) {
  const tri = [idx[t*3], idx[t*3+1], idx[t*3+2]];
  for (let k = 0; k < 3; k++) {
    const u = tri[k], v = tri[(k+1)%3];
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    edge.set(key, (edge.get(key) ?? 0) + 1);
    dir.set(`${u}>${v}`, (dir.get(`${u}>${v}`) ?? 0) + 1);
    adj[u].push(v); adj[v].push(u);
  }
}
let open = 0, over = 0;
for (const n of edge.values()) { if (n === 1) open++; if (n > 2) over++; }
let badDir = 0;
for (const [k, n] of dir) { if (n !== 1) badDir++; const [u,v]=k.split('>'); if ((dir.get(`${v}>${u}`) ?? 0) !== 1) badDir++; }
const seen = new Uint8Array(vCount); let comps = 0, sizes = [];
for (let s = 0; s < vCount; s++) { if (seen[s]) continue; comps++; let n=0; const st=[s]; seen[s]=1;
  while (st.length) { const u = st.pop(); n++; for (const v of adj[u]) if (!seen[v]) { seen[v]=1; st.push(v); } } sizes.push(n); }
let vol = 0, deg = 0;
const P = (i) => new THREE.Vector3(pos[i*3], pos[i*3+1], pos[i*3+2]);
for (let t = 0; t < tCount; t++) {
  const a=P(idx[t*3]), b=P(idx[t*3+1]), c=P(idx[t*3+2]);
  vol += a.dot(new THREE.Vector3().crossVectors(b,c))/6;
  if (new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).length() < 1e-10) deg++;
}
// symmetry across X
const f3 = (v) => (Math.abs(v) < 5e-4 ? '0.000' : v.toFixed(3));
const set = new Set();
for (let i = 0; i < vCount; i++) set.add(`${f3(pos[i*3])},${f3(pos[i*3+1])},${f3(pos[i*3+2])}`);
let noTwin = 0;
for (let i = 0; i < vCount; i++) if (!set.has(`${f3(-pos[i*3])},${f3(pos[i*3+1])},${f3(pos[i*3+2])}`)) noTwin++;
const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
console.log(`manifold: ${open} boundary edges, ${over} non-manifold edges`);
console.log(`orientation: ${badDir} inconsistent directed edges`);
console.log(`components: ${comps} (sizes ${sizes.sort((a,b)=>b-a).slice(0,6).join(',')})`);
console.log(`signed volume: ${vol.toFixed(5)} (positive = outward)`);
console.log(`degenerate triangles: ${deg}`);
console.log(`symmetry: ${noTwin}/${vCount} vertices without a mirror twin at 1 mm`);
console.log(`bbox: y ${box.min.y.toFixed(4)}..${box.max.y.toFixed(4)}  x ±${Math.max(-box.min.x,box.max.x).toFixed(4)}  z ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)}`);
mkdirSync('imported-body/out', { recursive: true });
writeFileSync('imported-body/out/welded.json', JSON.stringify({ vertices: vCount, triangles: tCount, open, over, badDir, comps, vol, deg, noTwin, bbox: { min: box.min.toArray(), max: box.max.toArray() } }, null, 2));
