// Moved from lowpoly-v2/src/meshChecks.ts on 2026-11-18 when lowpoly-v2 went to archive/ (I-45). Unchanged.
/**
 * Stage 04 geometry checks for the single working mesh. Pure functions (node + browser).
 * No node-only imports here: the same checks run in the browser (see imported-body/src/pose.ts).
 * A BVH/bbox candidate is NOT an intersection: candidates go through an exact
 * triangle–triangle test (Möller) and only proven crossings count.
 */
import * as THREE from 'three';
import type { BodyMeshV2 } from './mesh';

export interface Check {
  name: string;
  pass: boolean;
  level: 'fail' | 'warn';
  detail: string;
  data?: Record<string, unknown>;
}

export function checkBodyMesh(mesh: BodyMeshV2, opts: { maxTriangles?: number; minTriangles?: number } = {}): { ok: boolean; checks: Check[] } {
  const checks: Check[] = [];
  const pos = mesh.geometry.attributes.position!.array as Float32Array;
  const idx = mesh.geometry.index!.array as Uint32Array;
  const vCount = pos.length / 3,
    tCount = idx.length / 3;
  const P = (i: number) => new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);

  let bad = 0;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i]!)) bad++;
  checks.push({ name: 'finite_values', pass: bad === 0, level: 'fail', detail: `${bad} non-finite` });

  let deg = 0;
  for (let t = 0; t < tCount; t++) {
    const a = P(idx[t * 3]!),
      b = P(idx[t * 3 + 1]!),
      c = P(idx[t * 3 + 2]!);
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() < 1e-10) deg++;
  }
  checks.push({ name: 'no_degenerate_triangles', pass: deg === 0, level: 'fail', detail: `${deg} degenerate of ${tCount}` });

  // manifold / orientation / components
  const edges = new Map<string, number>();
  const dir = new Map<string, number>();
  const adj: number[][] = Array.from({ length: vCount }, () => []);
  for (let t = 0; t < tCount; t++) {
    const tri = [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!];
    for (let k = 0; k < 3; k++) {
      const u = tri[k]!,
        v = tri[(k + 1) % 3]!;
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      dir.set(`${u}>${v}`, (dir.get(`${u}>${v}`) ?? 0) + 1);
      adj[u]!.push(v);
    }
  }
  let open = 0,
    over = 0;
  for (const n of edges.values()) {
    if (n === 1) open++;
    if (n > 2) over++;
  }
  checks.push({ name: 'closed_manifold', pass: open === 0 && over === 0, level: 'fail', detail: `${open} boundary edges, ${over} edges with >2 faces` });
  let badDir = 0;
  for (const [k, n] of dir) {
    if (n !== 1) badDir++;
    const [u, v] = k.split('>');
    if ((dir.get(`${v}>${u}`) ?? 0) !== 1) badDir++;
  }
  checks.push({ name: 'consistent_orientation', pass: badDir === 0, level: 'fail', detail: `${badDir} inconsistent directed edges` });
  // connected components (BFS over edges)
  const seen = new Uint8Array(vCount);
  let comps = 0;
  for (let s = 0; s < vCount; s++) {
    if (seen[s]) continue;
    comps++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of adj[u]!) if (!seen[v]) {
        seen[v] = 1;
        stack.push(v);
      }
    }
  }
  checks.push({ name: 'single_connected_surface', pass: comps === 1, level: 'fail', detail: `${comps} connected component(s)` });
  // volume
  let vol = 0;
  for (let t = 0; t < tCount; t++) {
    const a = P(idx[t * 3]!),
      b = P(idx[t * 3 + 1]!),
      c = P(idx[t * 3 + 2]!);
    vol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
  }
  checks.push({ name: 'faces_point_outward', pass: vol > 0, level: 'fail', detail: `signed volume ${vol.toFixed(4)} m³` , data: { volume: vol } });
  // duplicates
  const keys = new Map<string, number>();
  let dups = 0;
  for (let i = 0; i < vCount; i++) {
    const k = `${pos[i * 3]!.toFixed(5)},${pos[i * 3 + 1]!.toFixed(5)},${pos[i * 3 + 2]!.toFixed(5)}`;
    if (keys.has(k)) dups++;
    else keys.set(k, i);
  }
  checks.push({ name: 'no_duplicate_vertices', pass: dups === 0, level: 'fail', detail: `${dups} duplicates` });
  // symmetry
  const f4 = (v: number) => (Math.abs(v) < 5e-5 ? '0.0000' : v.toFixed(4));
  const set = new Set<string>();
  for (let i = 0; i < vCount; i++) set.add(`${f4(pos[i * 3]!)},${f4(pos[i * 3 + 1]!)},${f4(pos[i * 3 + 2]!)}`);
  let missing = 0;
  for (let i = 0; i < vCount; i++) if (!set.has(`${f4(-pos[i * 3]!)},${f4(pos[i * 3 + 1]!)},${f4(pos[i * 3 + 2]!)}`)) missing++;
  checks.push({ name: 'left_right_symmetry', pass: missing === 0, level: 'fail', detail: `${missing} vertices without mirror twin` });
  // floor / height
  let minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < vCount; i++) {
    minY = Math.min(minY, pos[i * 3 + 1]!);
    maxY = Math.max(maxY, pos[i * 3 + 1]!);
  }
  checks.push({ name: 'feet_on_floor', pass: Math.abs(minY) < 0.01, level: 'fail', detail: `min y ${minY.toFixed(4)}` });
  checks.push({ name: 'head_top_at_height', pass: Math.abs(maxY - mesh.frame.height) < 0.005, level: 'fail', detail: `max y ${maxY.toFixed(4)} vs ${mesh.frame.height}` });
  // budget
  const minT = opts.minTriangles ?? 1500,
    maxT = opts.maxTriangles ?? 3000;
  checks.push({ name: 'triangle_budget', pass: tCount >= minT && tCount <= maxT, level: 'warn', detail: `${tCount} triangles (target ${minT}–${maxT})` });
  // self-intersection: bbox candidates → exact test, excluding triangles that share a vertex
  const si = selfIntersections(pos, idx);
  checks.push({ name: 'no_self_intersections', pass: si.proven === 0, level: 'fail', detail: `${si.candidates} bbox candidates, ${si.proven} proven crossings${si.examples.length ? ' e.g. ' + si.examples.join(' ') : ''}`, data: si });
  return { ok: checks.every((c) => c.pass || c.level === 'warn'), checks };
}

// ---- triangle / triangle (Möller 1997, via segment-plane clipping) --------
function selfIntersections(pos: Float32Array, idx: Uint32Array) {
  const tCount = idx.length / 3;
  const box: [number, number, number, number, number, number][] = [];
  const V = (i: number) => new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
  const tris: THREE.Vector3[][] = [];
  for (let t = 0; t < tCount; t++) {
    const a = V(idx[t * 3]!),
      b = V(idx[t * 3 + 1]!),
      c = V(idx[t * 3 + 2]!);
    tris.push([a, b, c]);
    box.push([Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z), Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z)]);
  }
  let candidates = 0,
    proven = 0;
  const examples: string[] = [];
  const eps = 1e-6;
  for (let i = 0; i < tCount; i++) {
    const bi = box[i]!;
    for (let j = i + 1; j < tCount; j++) {
      const bj = box[j]!;
      if (bi[3] < bj[0] - eps || bj[3] < bi[0] - eps || bi[4] < bj[1] - eps || bj[4] < bi[1] - eps || bi[5] < bj[2] - eps || bj[5] < bi[2] - eps) continue;
      // skip neighbours sharing a vertex index
      const A = [idx[i * 3]!, idx[i * 3 + 1]!, idx[i * 3 + 2]!],
        B = [idx[j * 3]!, idx[j * 3 + 1]!, idx[j * 3 + 2]!];
      if (A.some((v) => B.includes(v))) continue;
      candidates++;
      if (triTri(tris[i]!, tris[j]!)) {
        proven++;
        if (examples.length < 5) examples.push(`${i}x${j}`);
      }
    }
  }
  return { candidates, proven, examples };
}

/** exact test: does segment of tri A's edges cross tri B's interior, or vice versa (robust enough for closed meshes) */
function triTri(A: THREE.Vector3[], B: THREE.Vector3[]): boolean {
  return edgesCross(A, B) || edgesCross(B, A);
}
function edgesCross(A: THREE.Vector3[], B: THREE.Vector3[]): boolean {
  const n = new THREE.Vector3().subVectors(B[1]!, B[0]!).cross(new THREE.Vector3().subVectors(B[2]!, B[0]!));
  if (n.lengthSq() < 1e-18) return false;
  n.normalize();
  const d = n.dot(B[0]!);
  for (let k = 0; k < 3; k++) {
    const p = A[k]!,
      q = A[(k + 1) % 3]!;
    const dp = n.dot(p) - d,
      dq = n.dot(q) - d;
    if ((dp > 1e-7 && dq > 1e-7) || (dp < -1e-7 && dq < -1e-7)) continue;
    if (Math.abs(dp - dq) < 1e-12) continue; // segment in the plane: treat as touching, not crossing
    const t = dp / (dp - dq);
    if (t < -1e-7 || t > 1 + 1e-7) continue;
    const x = new THREE.Vector3().lerpVectors(p, q, t);
    if (pointInTri(x, B, n)) return true;
  }
  return false;
}
function pointInTri(x: THREE.Vector3, T: THREE.Vector3[], n: THREE.Vector3): boolean {
  for (let k = 0; k < 3; k++) {
    const a = T[k]!,
      b = T[(k + 1) % 3]!;
    const c = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(x, a));
    if (c.dot(n) < -1e-9) return false;
  }
  // strictly inside (not on the edge) — edge touches are not crossings
  for (let k = 0; k < 3; k++) {
    const a = T[k]!,
      b = T[(k + 1) % 3]!;
    const c = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(x, a));
    if (c.length() < 1e-9) return false;
  }
  return true;
}
