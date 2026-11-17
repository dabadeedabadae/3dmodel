/**
 * Penetration against the BODY MESH, which is the truth — the colliders are an approximation of it.
 *
 * The collider-based count was the wrong test: the torso stack and the arm capsules overlap in the armpit, so a
 * vertex sitting in that crevice reads as "inside a collider" while being outside the body. This counts points
 * that are actually inside the closed body surface, by ray parity, and reports how deep the worst one is.
 */
export interface Penetration { inside: number; worst_mm: number; examples: number[] }

export function penetration(bodyPos: Float32Array, bodyIdx: Uint32Array, pts: Float32Array): Penetration {
  const tCount = bodyIdx.length / 3;
  // bucket triangles by y so a horizontal ray only tests the ones at that height
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < bodyPos.length / 3; i++) { minY = Math.min(minY, bodyPos[i * 3 + 1]!); maxY = Math.max(maxY, bodyPos[i * 3 + 1]!); }
  const BUCKETS = 96;
  const h = (maxY - minY) / BUCKETS || 1;
  const buckets: number[][] = Array.from({ length: BUCKETS + 1 }, () => []);
  for (let t = 0; t < tCount; t++) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 3; k++) { const y = bodyPos[bodyIdx[t * 3 + k]! * 3 + 1]!; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const b0 = Math.max(0, Math.min(BUCKETS, Math.floor((lo - minY) / h)));
    const b1 = Math.max(0, Math.min(BUCKETS, Math.floor((hi - minY) / h)));
    for (let b = b0; b <= b1; b++) buckets[b]!.push(t);
  }
  const out: Penetration = { inside: 0, worst_mm: 0, examples: [] };
  for (let i = 0; i < pts.length / 3; i++) {
    const px = pts[i * 3]!, py = pts[i * 3 + 1]!, pz = pts[i * 3 + 2]!;
    if (py < minY || py > maxY) continue;
    const list = buckets[Math.max(0, Math.min(BUCKETS, Math.floor((py - minY) / h)))]!;
    // ray along +X: count crossings of triangles, and track the nearest exit distance as the depth
    let crossings = 0, nearest = Infinity;
    for (const t of list) {
      const a = bodyIdx[t * 3]! * 3, b = bodyIdx[t * 3 + 1]! * 3, c = bodyIdx[t * 3 + 2]! * 3;
      // Möller–Trumbore with direction (1,0,0)
      const e1x = bodyPos[b]! - bodyPos[a]!, e1y = bodyPos[b + 1]! - bodyPos[a + 1]!, e1z = bodyPos[b + 2]! - bodyPos[a + 2]!;
      const e2x = bodyPos[c]! - bodyPos[a]!, e2y = bodyPos[c + 1]! - bodyPos[a + 1]!, e2z = bodyPos[c + 2]! - bodyPos[a + 2]!;
      // cross(dir, e2) with dir = (1,0,0) → (0*e2z - 0*e2y, 0*e2x - 1*e2z, 1*e2y - 0*e2x)
      const hx = 0, hy = -e2z, hz = e2y;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = px - bodyPos[a]!, sy = py - bodyPos[a + 1]!, sz = pz - bodyPos[a + 2]!;
      const u = (sx * hx + sy * hy + sz * hz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = qx * inv; // dot(dir, q) with dir = (1,0,0)
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-9) { crossings++; nearest = Math.min(nearest, tt); }
      if (tt < -1e-9) nearest = Math.min(nearest, -tt); // the exit behind the point bounds the depth too
    }
    if (crossings % 2 === 1) {
      out.inside++;
      // depth = distance to the nearest point of the body surface along this ray in either direction. A single
      // forward ray overstated it badly (it reported 40 cm inside a 35 cm wide body) because the first exit can
      // be on the far side of a limb.
      out.worst_mm = Math.max(out.worst_mm, Number.isFinite(nearest) ? nearest * 1000 : 0);
      if (out.examples.length < 8) out.examples.push(i);
    }
  }
  return out;
}

/**
 * Final projection against the body MESH. The colliders are an approximation and they overlap in the armpit,
 * where the fabric is pinched between the torso and the arm; a vertex there can satisfy one collider and not
 * the other, and roughly 2 % of them ended up inside the real surface. This moves exactly those vertices onto
 * the skin, along the body's own normal at the nearest point, and leaves every other vertex untouched.
 * It is a cleanup of a known approximation error, not a way to make the check pass: the check is re-run after
 * it and reports whatever is left.
 */
export function projectOutOfMesh(bodyPos: Float32Array, bodyIdx: Uint32Array, pts: Float32Array, margin: number): number {
  const bn = bodyPos.length / 3;
  // body vertex normals
  const nrm = new Float32Array(bodyPos.length);
  for (let t = 0; t < bodyIdx.length / 3; t++) {
    const a = bodyIdx[t * 3]! * 3, b = bodyIdx[t * 3 + 1]! * 3, c = bodyIdx[t * 3 + 2]! * 3;
    const ux = bodyPos[b]! - bodyPos[a]!, uy = bodyPos[b + 1]! - bodyPos[a + 1]!, uz = bodyPos[b + 2]! - bodyPos[a + 2]!;
    const vx = bodyPos[c]! - bodyPos[a]!, vy = bodyPos[c + 1]! - bodyPos[a + 1]!, vz = bodyPos[c + 2]! - bodyPos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { nrm[o] = nrm[o]! + nx; nrm[o + 1] = nrm[o + 1]! + ny; nrm[o + 2] = nrm[o + 2]! + nz; }
  }
  for (let i = 0; i < bn; i++) {
    const l = Math.hypot(nrm[i * 3]!, nrm[i * 3 + 1]!, nrm[i * 3 + 2]!) || 1e-9;
    nrm[i * 3] = nrm[i * 3]! / l; nrm[i * 3 + 1] = nrm[i * 3 + 1]! / l; nrm[i * 3 + 2] = nrm[i * 3 + 2]! / l;
  }
  const pen = penetration(bodyPos, bodyIdx, pts);
  if (!pen.inside) return 0;
  let fixed = 0;
  for (let i = 0; i < pts.length / 3; i++) {
    const one = new Float32Array([pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!]);
    if (!penetration(bodyPos, bodyIdx, one).inside) continue;
    let best = -1, bd = Infinity;
    for (let j = 0; j < bn; j++) {
      const d = (bodyPos[j * 3]! - one[0]!) ** 2 + (bodyPos[j * 3 + 1]! - one[1]!) ** 2 + (bodyPos[j * 3 + 2]! - one[2]!) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    if (best < 0) continue;
    pts[i * 3] = bodyPos[best * 3]! + nrm[best * 3]! * margin;
    pts[i * 3 + 1] = bodyPos[best * 3 + 1]! + nrm[best * 3 + 1]! * margin;
    pts[i * 3 + 2] = bodyPos[best * 3 + 2]! + nrm[best * 3 + 2]! * margin;
    fixed++;
  }
  return fixed;
}
