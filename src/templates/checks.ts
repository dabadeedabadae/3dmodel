/**
 * Geometry checks for garment templates. Pure functions, no DOM, runnable in
 * node (scripts/check-tshirt.ts) and in the browser (dev page status panel).
 *
 * A "pretty render" never proves correctness; these checks do:
 *  - no NaN / degenerate triangles
 *  - every edge is shared by 1 or 2 faces (manifold), using LOGICAL vertices
 *  - duplicated geometry vertices of one logical vertex share one position
 *  - consistent face orientation across the whole surface (no flipped quads)
 *  - exactly the expected open boundary loops (hem, neck, two cuffs)
 *  - one connected component
 *  - UVs inside [0,1], islands do not overlap, every UV triangle has positive
 *    orientation (a negative one = mirrored texture)
 *  - UV stretch spread within a tolerance (reported, soft fail)
 *  - left/right symmetry of positions
 *  - island normal sanity (front faces +Z, back -Z, sleeves ±X)
 *  - fixed topology: index buffer identical across parameter sets
 */

import * as THREE from 'three';
import { buildTShirt, M, type TShirtMesh } from './tshirt/buildTShirt';
import { TSHIRT_PARAM_LIMITS, TSHIRT_PARAM_NAMES, defaultTShirtParams, type TShirtParams } from './tshirt/params';

export interface CheckResult {
  name: string;
  pass: boolean;
  /** `warn` results do not fail the run but are reported. */
  level: 'fail' | 'warn';
  detail: string;
  data?: Record<string, unknown>;
}

export interface CheckReport {
  ok: boolean;
  results: CheckResult[];
  summary: { vertices: number; logicalVertices: number; triangles: number; boundaryLoops: number[] };
}

const EPS_POS = 1e-6;

function edgeKey(a: number, b: number) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function checkTShirtMesh(mesh: TShirtMesh, opts: { stretchTolerance?: number } = {}): CheckReport {
  const results: CheckResult[] = [];
  const geo = mesh.geometry;
  const pos = geo.attributes.position!.array as ArrayLike<number>;
  const uv = geo.attributes.uv!.array as ArrayLike<number>;
  const idx = geo.index!.array as ArrayLike<number>;
  const vCount = geo.attributes.position!.count;
  const triCount = idx.length / 3;
  const L = mesh.logicalIndex;

  // 1. NaN / finite
  {
    let bad = 0;
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i]!)) bad++;
    for (let i = 0; i < uv.length; i++) if (!Number.isFinite(uv[i]!)) bad++;
    results.push({ name: 'finite_values', pass: bad === 0, level: 'fail', detail: `${bad} non-finite values` });
  }

  // 2. degenerate triangles (3D)
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const triNormals: THREE.Vector3[] = [];
  const triAreas: number[] = [];
  {
    let degenerate = 0;
    for (let t = 0; t < triCount; t++) {
      a.fromArray(pos, idx[t * 3]! * 3);
      b.fromArray(pos, idx[t * 3 + 1]! * 3);
      c.fromArray(pos, idx[t * 3 + 2]! * 3);
      n.subVectors(b, a).cross(c.clone().sub(a));
      const area2 = n.length();
      triAreas.push(area2 / 2);
      triNormals.push(area2 > 0 ? n.clone().divideScalar(area2) : new THREE.Vector3());
      if (area2 < 1e-9) degenerate++;
    }
    results.push({ name: 'no_degenerate_triangles', pass: degenerate === 0, level: 'fail', detail: `${degenerate} degenerate of ${triCount}` });
  }

  // 3. duplicated vertices of a logical vertex share one position
  {
    const first = new Map<number, number>();
    let mismatches = 0;
    for (let i = 0; i < vCount; i++) {
      const l = L[i]!;
      const f = first.get(l);
      if (f === undefined) {
        first.set(l, i);
        continue;
      }
      const d = Math.hypot(pos[i * 3]! - pos[f * 3]!, pos[i * 3 + 1]! - pos[f * 3 + 1]!, pos[i * 3 + 2]! - pos[f * 3 + 2]!);
      if (d > EPS_POS) mismatches++;
    }
    results.push({ name: 'seam_duplicates_coincide', pass: mismatches === 0, level: 'fail', detail: `${mismatches} seam duplicates with differing positions` });
  }

  // 4. manifold edges + orientation consistency (logical topology)
  const edgeFaces = new Map<string, number[]>(); // key -> triangle ids
  const directed = new Map<string, number>(); // "a>b" -> count
  for (let t = 0; t < triCount; t++) {
    const l0 = L[idx[t * 3]!]!;
    const l1 = L[idx[t * 3 + 1]!]!;
    const l2 = L[idx[t * 3 + 2]!]!;
    for (const [p, q] of [
      [l0, l1],
      [l1, l2],
      [l2, l0],
    ] as const) {
      const k = edgeKey(p, q);
      const arr = edgeFaces.get(k);
      if (arr) arr.push(t);
      else edgeFaces.set(k, [t]);
      const dk = `${p}>${q}`;
      directed.set(dk, (directed.get(dk) ?? 0) + 1);
    }
  }
  {
    let nonManifold = 0;
    let inconsistent = 0;
    let boundaryEdges = 0;
    for (const [k, faces] of edgeFaces) {
      if (faces.length > 2) nonManifold++;
      if (faces.length === 1) boundaryEdges++;
      if (faces.length === 2) {
        const [p, q] = k.split('_').map(Number) as [number, number];
        // consistent orientation: the edge is traversed once each way
        if ((directed.get(`${p}>${q}`) ?? 0) !== 1 || (directed.get(`${q}>${p}`) ?? 0) !== 1) inconsistent++;
      }
    }
    results.push({ name: 'manifold_edges', pass: nonManifold === 0, level: 'fail', detail: `${nonManifold} edges with >2 faces` });
    results.push({ name: 'consistent_orientation', pass: inconsistent === 0, level: 'fail', detail: `${inconsistent} edges with inconsistent winding` });
    results.push({ name: 'boundary_edges_present', pass: boundaryEdges > 0, level: 'fail', detail: `${boundaryEdges} boundary edges (openings are expected)` });
  }

  // 5. boundary loops
  const loops: number[][] = [];
  {
    const next = new Map<number, number>();
    for (const [k, faces] of edgeFaces) {
      if (faces.length !== 1) continue;
      const [p, q] = k.split('_').map(Number) as [number, number];
      // boundary edge direction as it appears in its single face
      if ((directed.get(`${p}>${q}`) ?? 0) === 1) next.set(p, q);
      else next.set(q, p);
    }
    const seen = new Set<number>();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const loop: number[] = [];
      let cur = start;
      let guard = 0;
      while (!seen.has(cur) && guard++ < 10000) {
        seen.add(cur);
        loop.push(cur);
        const nx = next.get(cur);
        if (nx === undefined) break;
        cur = nx;
      }
      loops.push(loop);
    }
    const sizes = loops.map((l) => l.length).sort((x, y) => x - y);
    const expected = mesh.rings
      .filter((r) => r.isOpening)
      .map((r) => r.logical.length)
      .sort((x, y) => x - y);
    const same = sizes.length === expected.length && sizes.every((s, i) => s === expected[i]);
    results.push({
      name: 'boundary_loops',
      pass: same,
      level: 'fail',
      detail: `found loops ${JSON.stringify(sizes)}, expected ${JSON.stringify(expected)} (hem, collar, 2 cuffs)`,
      data: { sizes, expected },
    });
    // each expected opening ring must be exactly one of the loops
    let matched = 0;
    for (const ring of mesh.rings.filter((r) => r.isOpening)) {
      const set = new Set(ring.logical);
      if (loops.some((l) => l.length === set.size && l.every((v) => set.has(v)))) matched++;
    }
    results.push({ name: 'openings_match_named_rings', pass: matched === expected.length, level: 'fail', detail: `${matched}/${expected.length} named openings found as boundary loops` });
  }

  // 6. connectivity (logical)
  {
    const adj = new Map<number, Set<number>>();
    const link = (p: number, q: number) => {
      if (!adj.has(p)) adj.set(p, new Set());
      if (!adj.has(q)) adj.set(q, new Set());
      adj.get(p)!.add(q);
      adj.get(q)!.add(p);
    };
    for (const k of edgeFaces.keys()) {
      const [p, q] = k.split('_').map(Number) as [number, number];
      link(p, q);
    }
    const used = new Set<number>(adj.keys());
    const seen = new Set<number>();
    let components = 0;
    for (const s of used) {
      if (seen.has(s)) continue;
      components++;
      const stack = [s];
      while (stack.length) {
        const v = stack.pop()!;
        if (seen.has(v)) continue;
        seen.add(v);
        for (const w of adj.get(v)!) if (!seen.has(w)) stack.push(w);
      }
    }
    results.push({ name: 'single_connected_surface', pass: components === 1, level: 'fail', detail: `${components} connected component(s)` });
    const unusedLogical = mesh.logicalCount - used.size;
    results.push({ name: 'no_unused_logical_vertices', pass: unusedLogical === 2, level: 'warn', detail: `${unusedLogical} logical vertices unused (2 expected: armhole centres row 4 cols 4/12)` });
    const referenced = new Set<number>();
    for (let i = 0; i < idx.length; i++) referenced.add(idx[i]!);
    results.push({ name: 'no_unused_geometry_vertices', pass: referenced.size === vCount, level: 'fail', detail: `${vCount - referenced.size} geometry vertices unreferenced` });
  }

  // 7. UV checks
  {
    let outOfRange = 0;
    for (let i = 0; i < uv.length; i++) if (uv[i]! < 0 || uv[i]! > 1) outOfRange++;
    results.push({ name: 'uv_in_unit_square', pass: outOfRange === 0, level: 'fail', detail: `${outOfRange} uv components outside [0,1]` });

    // island bounding boxes inside their rects and pairwise disjoint
    const boxes = mesh.islands.map((isl) => {
      let u0 = Infinity,
        v0 = Infinity,
        u1 = -Infinity,
        v1 = -Infinity;
      for (const v of isl.vertices) {
        u0 = Math.min(u0, uv[v * 2]!);
        u1 = Math.max(u1, uv[v * 2]!);
        v0 = Math.min(v0, uv[v * 2 + 1]!);
        v1 = Math.max(v1, uv[v * 2 + 1]!);
      }
      return { name: isl.name, u0, v0, u1, v1, rect: isl.uvRect };
    });
    let outsideRect = 0;
    for (const bx of boxes) {
      const r = bx.rect;
      if (bx.u0 < r.u0 - 1e-6 || bx.u1 > r.u1 + 1e-6 || bx.v0 < r.v0 - 1e-6 || bx.v1 > r.v1 + 1e-6) outsideRect++;
    }
    let overlaps = 0;
    const gutter = 0.01; // ≥ 10 px at 1024
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i]!,
          B = boxes[j]!;
        const sep = A.u1 + gutter <= B.u0 || B.u1 + gutter <= A.u0 || A.v1 + gutter <= B.v0 || B.v1 + gutter <= A.v0;
        if (!sep) overlaps++;
      }
    }
    results.push({ name: 'uv_islands_inside_rects', pass: outsideRect === 0, level: 'fail', detail: `${outsideRect} islands leave their reserved rect` });
    results.push({ name: 'uv_islands_disjoint_with_gutter', pass: overlaps === 0, level: 'fail', detail: `${overlaps} island pairs closer than ${gutter} uv`, data: { boxes } });

    // orientation: positive signed UV area for every triangle (negative = mirrored)
    let mirrored = 0;
    let uvDegenerate = 0;
    const ratios: number[] = [];
    for (let t = 0; t < triCount; t++) {
      const i0 = idx[t * 3]!,
        i1 = idx[t * 3 + 1]!,
        i2 = idx[t * 3 + 2]!;
      const ax = uv[i0 * 2]!,
        ay = uv[i0 * 2 + 1]!;
      const bx = uv[i1 * 2]!,
        by = uv[i1 * 2 + 1]!;
      const cx = uv[i2 * 2]!,
        cy = uv[i2 * 2 + 1]!;
      const signed = ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      if (Math.abs(signed) < 1e-12) uvDegenerate++;
      else if (signed < 0) mirrored++;
      const area3 = triAreas[t]!;
      if (area3 > 0 && Math.abs(signed) > 0) ratios.push(Math.sqrt(Math.abs(signed) / area3) / mesh.uvScale);
    }
    results.push({ name: 'uv_not_mirrored', pass: mirrored === 0, level: 'fail', detail: `${mirrored} triangles with negative UV orientation` });
    results.push({ name: 'uv_no_degenerate_triangles', pass: uvDegenerate === 0, level: 'fail', detail: `${uvDegenerate} degenerate UV triangles` });
    ratios.sort((x, y) => x - y);
    const med = ratios[Math.floor(ratios.length / 2)] ?? 1;
    const min = ratios[0] ?? 1;
    const max = ratios[ratios.length - 1] ?? 1;
    const tol = opts.stretchTolerance ?? 2.0;
    results.push({
      name: 'uv_stretch_spread',
      pass: max / med <= tol && med / min <= tol,
      level: 'warn',
      detail: `linear stretch ratio (uv/3d relative to uvScale) min ${min.toFixed(2)} / median ${med.toFixed(2)} / max ${max.toFixed(2)} (tolerance x${tol})`,
      data: { min, med, max },
    });
  }

  // 8. symmetry in X (logical positions): for every vertex, a mirrored one exists
  {
    const q = (v: number) => (Math.abs(v) < 1e-7 ? 0 : v).toFixed(5);
    const key = (x: number, y: number, z: number) => `${q(x)}|${q(y)}|${q(z)}`;
    const set = new Set<string>();
    for (let i = 0; i < vCount; i++) set.add(key(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!));
    let missing = 0;
    for (let i = 0; i < vCount; i++) {
      const mx = -pos[i * 3]!;
      if (!set.has(key(mx, pos[i * 3 + 1]!, pos[i * 3 + 2]!))) missing++;
    }
    results.push({ name: 'mirror_symmetry_x', pass: missing === 0, level: 'fail', detail: `${missing} vertices without an X-mirrored partner` });
  }

  // 9. every face points outward (away from the local axis of its part)
  {
    const centroid = new THREE.Vector3();
    const ref = new THREE.Vector3();
    const bad: Record<string, number> = {};
    const ringCentre = (name: string) => {
      const ring = mesh.rings.find((r) => r.name === name)!;
      const out = new THREE.Vector3();
      const first = new Map<number, number>();
      for (let i = 0; i < vCount; i++) if (!first.has(L[i]!)) first.set(L[i]!, i);
      for (const l of ring.logical) out.add(new THREE.Vector3().fromArray(pos, first.get(l)! * 3));
      return out.multiplyScalar(1 / ring.logical.length);
    };
    const axes = {
      sleeve_left: { c: ringCentre('armhole_left'), tip: ringCentre('cuff_left') },
      sleeve_right: { c: ringCentre('armhole_right'), tip: ringCentre('cuff_right') },
    };
    for (const isl of mesh.islands) {
      let count = 0;
      for (let t = isl.indexStart / 3; t < (isl.indexStart + isl.indexCount) / 3; t++) {
        centroid
          .fromArray(pos, idx[t * 3]! * 3)
          .add(new THREE.Vector3().fromArray(pos, idx[t * 3 + 1]! * 3))
          .add(new THREE.Vector3().fromArray(pos, idx[t * 3 + 2]! * 3))
          .multiplyScalar(1 / 3);
        if (isl.name === 'sleeve_left' || isl.name === 'sleeve_right') {
          // outward = away from the sleeve axis (root centre -> cuff centre)
          const ax = axes[isl.name];
          const d = ax.tip.clone().sub(ax.c).normalize();
          const rel = centroid.clone().sub(ax.c);
          ref.copy(rel).addScaledVector(d, -rel.dot(d));
        } else if (L[idx[t * 3]!]! < 5 * M || L[idx[t * 3 + 1]!]! < 5 * M || L[idx[t * 3 + 2]!]! < 5 * M) {
          // torso tube (touches rows 0..4): radial from the Y axis
          ref.set(centroid.x, 0, centroid.z);
        } else {
          // shoulder yoke / collar (rows 5..7 only): up and slightly outward
          ref.set(centroid.x * 0.3, 1, centroid.z * 0.3);
        }
        if (triNormals[t]!.dot(ref) <= 0) count++;
      }
      if (count) bad[isl.name] = count;
    }
    const total = Object.values(bad).reduce((x, y) => x + y, 0);
    results.push({ name: 'faces_point_outward', pass: total === 0, level: 'fail', detail: total ? `inward faces: ${JSON.stringify(bad)}` : 'all faces point away from their part axis' });
  }

  // 9b. sleeves never rise: cuff centre is not above the armhole centre (wearer sides)
  {
    const first = new Map<number, number>();
    for (let i = 0; i < vCount; i++) if (!first.has(L[i]!)) first.set(L[i]!, i);
    const centreY = (name: string) => {
      const ring = mesh.rings.find((r) => r.name === name)!;
      return ring.logical.reduce((acc, l) => acc + pos[first.get(l)! * 3 + 1]!, 0) / ring.logical.length;
    };
    const rises: string[] = [];
    for (const side of ['left', 'right'] as const) {
      const dy = centreY(`cuff_${side}`) - centreY(`armhole_${side}`);
      if (dy > 1e-6) rises.push(`${side}: cuff ${dy.toFixed(3)} above armhole`);
    }
    results.push({ name: 'sleeves_do_not_rise', pass: rises.length === 0, level: 'fail', detail: rises.length ? rises.join('; ') : 'cuff centres at or below armhole centres' });
  }

  // 10. no vertex outside a sane bounding region (template space): shoulder line at y=0, hem below
  {
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const ok = bb.max.y < 0.35 && bb.min.y < -0.3 && Math.abs(bb.min.x + bb.max.x) < 1e-4;
    results.push({ name: 'bounds_sane', pass: ok, level: 'fail', detail: `bbox y [${bb.min.y.toFixed(3)}, ${bb.max.y.toFixed(3)}], x [${bb.min.x.toFixed(3)}, ${bb.max.x.toFixed(3)}]` });
  }

  const ok = results.every((r) => r.pass || r.level === 'warn');
  return {
    ok,
    results,
    summary: {
      vertices: vCount,
      logicalVertices: mesh.stats.logicalVertices,
      triangles: triCount,
      boundaryLoops: loops.map((l) => l.length).sort((x, y) => x - y),
    },
  };
}

/** Deterministic pseudo-random parameter sets inside the limits (for fixed-topology checks). */
export function sampleParamSets(count: number, seed = 42): Partial<TShirtParams>[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const sets: Partial<TShirtParams>[] = [];
  for (let i = 0; i < count; i++) {
    const p: Partial<TShirtParams> = {};
    for (const k of TSHIRT_PARAM_NAMES) {
      const lim = TSHIRT_PARAM_LIMITS[k];
      p[k] = lim.min + (lim.max - lim.min) * rnd();
    }
    sets.push(p);
  }
  return sets;
}

/** Topology must not depend on parameters: identical index buffers + logical maps. */
export function checkFixedTopology(count = 8): CheckResult {
  const base = buildTShirt(defaultTShirtParams());
  const baseIdx = Array.from(base.geometry.index!.array).join(',');
  const baseL = Array.from(base.logicalIndex).join(',');
  const baseUV = Array.from(base.geometry.attributes.uv!.array).join(',');
  let diff = 0;
  for (const p of sampleParamSets(count)) {
    const m = buildTShirt(p);
    if (Array.from(m.geometry.index!.array).join(',') !== baseIdx) diff++;
    else if (Array.from(m.logicalIndex).join(',') !== baseL) diff++;
    else if (Array.from(m.geometry.attributes.uv!.array).join(',') !== baseUV) diff++;
    m.geometry.dispose();
  }
  base.geometry.dispose();
  return { name: 'fixed_topology_and_uv_across_params', pass: diff === 0, level: 'fail', detail: `${diff}/${count} random parameter sets changed index/logical/uv buffers` };
}
