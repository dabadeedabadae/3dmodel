import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const file = process.argv[2];
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new FBXLoader();
const root = loader.parse(ab, '');
let meshes = [];
root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
console.log('root children:', root.children.length, 'meshes:', meshes.length);
const box = new THREE.Box3();
for (const m of meshes) {
  const g = m.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  console.log(`- ${m.name || '(unnamed)'} skinned=${!!m.isSkinnedMesh} verts=${pos.count} tris=${(idx ? idx.count : pos.count) / 3} attrs=${Object.keys(g.attributes).join(',')} groups=${g.groups.length} mat=${Array.isArray(m.material) ? m.material.map(x=>x.name).join('|') : m.material?.name}`);
  g.computeBoundingBox();
  box.union(g.boundingBox.clone().applyMatrix4(m.matrixWorld));
}
const bones = [];
root.traverse((o) => { if (o.isBone) bones.push(o.name); });
console.log('bones:', bones.length, bones.slice(0, 30).join(','));
const sz = new THREE.Vector3(); box.getSize(sz);
console.log('bbox min', box.min.toArray().map(v=>v.toFixed(3)).join(','), 'max', box.max.toArray().map(v=>v.toFixed(3)).join(','));
console.log('size', sz.toArray().map(v=>v.toFixed(3)).join(','));
