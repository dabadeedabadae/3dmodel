/**
 * Geometry checks for the procedural body (node + browser). A pretty render is
 * not proof; these are:
 *  - finite values, no degenerate triangles
 *  - every part is a closed manifold (each edge in exactly 2 faces)
 *  - consistent winding, outward orientation (positive signed volume per part)
 *  - left/right mirror symmetry of positions
 *  - limbs stay outside the torso below the joints; legs do not intersect each other;
 *    arms do not intersect the torso at the elbow/wrist
 *  - feet on the floor (min y ≈ 0), head top at `height`
 *  - fixed topology across parameter sets
 */
import { bodyCapsules, capsuleSignedDistance, insideTorso } from './anatomy';
import { bodyTopology, buildBody, type BodyMesh } from './buildBody';
import { BODY_PARAM_LIMITS, BODY_PARAM_NAMES, defaultBodyParams, type BodyParams } from './params';
import type { CheckReport, CheckResult } from '../templates/checks';

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export function checkBodyMesh(mesh: BodyMesh): CheckReport {
  const results: CheckResult[] = [];
  const pos = mesh.geometry.attributes.position!.array as Float32Array;
  const idx = mesh.geometry.index!.array as Uint32Array;
  const vCount = pos.length / 3;
  const triCount = idx.length / 3;
  const P = (i: number): [number, number, number] => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];

  {
    let bad = 0;
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i]!)) bad++;
    results.push({ name: 'finite_values', pass: bad === 0, level: 'fail', detail: `${bad} non-finite values` });
  }
  {
    let deg = 0;
    for (let t = 0; t < triCount; t++) {
      const a = P(idx[t * 3]!),
        b = P(idx[t * 3 + 1]!),
        c = P(idx[t * 3 + 2]!);
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2],
        vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      if (Math.hypot(nx, ny, nz) < 1e-10) deg++;
    }
    results.push({ name: 'no_degenerate_triangles', pass: deg === 0, level: 'fail', detail: `${deg} degenerate of ${triCount}` });
  }
  // manifold + orientation + volume per part
  {
    let openEdges = 0,
      overEdges = 0,
      badWinding = 0,
      negVolume: string[] = [];
    for (const part of mesh.parts) {
      const edges = new Map<string, number>();
      const dir = new Map<string, number>(); // directed edge count
      let vol = 0;
      for (let t = part.triangleStart; t < part.triangleStart + part.triangleCount; t++) {
        const ia = idx[t * 3]!,
          ib = idx[t * 3 + 1]!,
          ic = idx[t * 3 + 2]!;
        for (const [u, v] of [
          [ia, ib],
          [ib, ic],
          [ic, ia],
        ] as const) {
          const k = edgeKey(u, v);
          edges.set(k, (edges.get(k) ?? 0) + 1);
          const dk = `${u}>${v}`;
          dir.set(dk, (dir.get(dk) ?? 0) + 1);
        }
        const a = P(ia),
          b = P(ib),
          c = P(ic);
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      }
      for (const [, n] of edges) {
        if (n === 1) openEdges++;
        if (n > 2) overEdges++;
      }
      for (const [k, n] of dir) {
        if (n > 1) badWinding++;
        const [u, v] = k.split('>');
        if ((dir.get(`${v}>${u}`) ?? 0) !== 1) badWinding++;
      }
      if (vol <= 0) negVolume.push(`${part.name}:${vol.toFixed(4)}`);
    }
    results.push({ name: 'closed_manifold_parts', pass: openEdges === 0 && overEdges === 0, level: 'fail', detail: `${openEdges} open edges, ${overEdges} edges with >2 faces` });
    results.push({ name: 'consistent_orientation', pass: badWinding === 0, level: 'fail', detail: `${badWinding} inconsistent directed edges` });
    results.push({ name: 'faces_point_outward', pass: negVolume.length === 0, level: 'fail', detail: negVolume.length ? `negative volume: ${negVolume.join(', ')}` : 'all parts have positive signed volume' });
  }
  // symmetry
  {
    const f4 = (v: number) => (Math.abs(v) < 5e-5 ? '0.0000' : v.toFixed(4));
    const key = (x: number, y: number, z: number) => `${f4(x)},${f4(y)},${f4(z)}`;
    const set = new Set<string>();
    for (let i = 0; i < vCount; i++) set.add(key(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!));
    let missing = 0;
    for (let i = 0; i < vCount; i++) {
      const mx = -pos[i * 3]!;
      if (!set.has(key(mx, pos[i * 3 + 1]!, pos[i * 3 + 2]!))) missing++;
    }
    results.push({ name: 'left_right_symmetry', pass: missing === 0, level: 'fail', detail: `${missing} vertices without a mirror twin` });
  }
  // floor and height
  {
    let minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < vCount; i++) {
      minY = Math.min(minY, pos[i * 3 + 1]!);
      maxY = Math.max(maxY, pos[i * 3 + 1]!);
    }
    const H = mesh.params.height;
    results.push({ name: 'feet_on_floor', pass: Math.abs(minY) < 0.005, level: 'fail', detail: `min y = ${minY.toFixed(4)}` });
    results.push({ name: 'head_top_at_height', pass: Math.abs(maxY - H) < 0.005, level: 'fail', detail: `max y = ${maxY.toFixed(3)}, height = ${H}` });
  }
  // limbs vs torso / each other (analytic frame)
  {
    const f = mesh.frame;
    const problems: string[] = [];
    for (const side of ['left', 'right'] as const) {
      const arm = f.arms[side];
      // from the mid upper arm down, the inner edge of the arm must be outside the torso
      for (let i = 1; i < arm.joints.length; i++) {
        const j = arm.joints[i]!;
        const inner: [number, number, number] = [j.pos[0] - Math.sign(j.pos[0]) * j.r, j.pos[1], j.pos[2]];
        if (insideTorso(f, inner[0], inner[1], inner[2], -0.0125)) problems.push(`arm_${side} joint ${i} inside torso`);
      }
      const leg = f.legs[side];
      for (let i = 2; i < leg.joints.length; i++) {
        const j = leg.joints[i]!;
        if (insideTorso(f, j.pos[0], j.pos[1], j.pos[2])) problems.push(`leg_${side} joint ${i} inside torso`);
      }
    }
    // legs don't cross: inner surfaces separated at knee / ankle
    for (let i = 1; i < f.legs.left.joints.length; i++) {
      const L = f.legs.left.joints[i]!,
        R = f.legs.right.joints[i]!;
      if (L.pos[0] - L.r < R.pos[0] + R.r - 0.002) problems.push(`legs overlap at joint ${i}`);
    }
    results.push({ name: 'limbs_clear_of_torso_and_each_other', pass: problems.length === 0, level: 'fail', detail: problems.length ? problems.join('; ') : 'ok' });
    // capsule sanity: torso surface points must not be inside limb capsules except near joints
    const caps = bodyCapsules(f).filter((c) => c.region.startsWith('arm'));
    let inside = 0;
    for (const part of mesh.parts.filter((p) => p.name === 'torso_head')) {
      for (const ring of part.rings) {
        if (!['waist', 'underbust', 'chest'].includes(ring.name)) continue;
        for (const vi of ring.indices) {
          const p = P(vi);
          if (capsuleSignedDistance(caps, p[0], p[1], p[2]) < -0.0125) inside++; // ≤ 1 cm overlap allowed (see params.ts ALLOWED_OVERLAP)
        }
      }
    }
    results.push({ name: 'arms_do_not_cut_into_torso', pass: inside === 0, level: 'fail', detail: `${inside} torso vertices deeper than 1 cm inside arm capsules (chest..waist rings)` });
  }
  const ok = results.every((r) => r.pass || r.level === 'warn');
  return { ok, results, summary: { vertices: vCount, logicalVertices: vCount, triangles: triCount, boundaryLoops: [] } };
}

export function sampleBodyParamSets(count: number, seed = 7): Partial<BodyParams>[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out: Partial<BodyParams>[] = [];
  for (let i = 0; i < count; i++) {
    const sex = rnd() < 0.5 ? 'male' : 'female';
    const base = defaultBodyParams(sex);
    const p: Partial<BodyParams> = { sex: base.sex };
    for (const n of BODY_PARAM_NAMES) {
      if (n === 'sex') continue;
      const L = BODY_PARAM_LIMITS[n];
      p[n] = L.min + (L.max - L.min) * rnd();
    }
    out.push(p);
  }
  return out;
}

export function checkBodyFixedTopology(count = 6): CheckResult {
  const ref = bodyTopology().index;
  let same = true;
  for (const p of sampleBodyParamSets(count, 11)) {
    const m = buildBody(p);
    const idx = m.geometry.index!.array as Uint32Array;
    if (idx.length !== ref.length) same = false;
    else for (let i = 0; i < idx.length && same; i++) if (idx[i] !== ref[i]) same = false;
    m.geometry.dispose();
    if (!same) break;
  }
  return { name: 'fixed_topology', pass: same, level: 'fail', detail: same ? `index buffer identical across ${count} parameter sets` : 'index buffer differs' };
}
