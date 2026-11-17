/**
 * Stage I-09 — colliders for the mannequin.
 *
 * Two kinds, both DERIVED from the posed mesh, nothing hand-placed:
 *  • torso — a stack of elliptical cross-sections measured by slicing (a torso is not a capsule: a capsule is
 *    round, the body is ~1.5× wider than deep, and a round collider either lets cloth sink in at the sides or
 *    pushes it off the chest);
 *  • limbs, neck and head — capsules along the measured limb axes.
 * A point is resolved against the closest surface, with a margin for the fabric's own thickness.
 */
import { sliceContours } from './geom/measure';
import type { BodyAsset } from './asset';
import { buildSkeleton } from './rig';

export interface Capsule { name: string; a: [number, number, number]; b: [number, number, number]; r: number }
/** a cross-section as a radial profile about its own centre: r[k] is the radius at angle 2πk/NA */
export const NA = 32;
export interface TorsoRing { y: number; cx: number; cz: number; a: number; b: number; r: number[] }
export interface BodyColliders {
  torso: TorsoRing[];
  capsules: Capsule[];
  /** y range covered by the profile stack (now up to the top of the head) */
  yMin: number;
  yMax: number;
  /** the acromion level — what garments are anchored to; NOT the top of the stack */
  shoulderY: number;
}

function ringAt(p: Float32Array, idx: Uint32Array, y: number): TorsoRing | null {
  let cs;
  try { cs = sliceContours(p, idx, y); } catch { return null; }
  if (!cs.length) return null;
  const meanX = (c: (typeof cs)[number]) => c.points.reduce((s, q) => s + q[0], 0) / c.points.length;
  const c = cs.reduce((best, cur) => (Math.abs(meanX(cur)) < Math.abs(meanX(best)) ? cur : best));
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const q of c.points) { xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]); zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1]); }
  const cx = (xmin + xmax) / 2, cz = (zmin + zmax) / 2;
  /**
   * The section is kept as a RADIAL PROFILE, not as an ellipse. An ellipse through the extreme points cuts
   * inside the body on the diagonals, and growing it until it contains the contour inflates the body instead —
   * at chest height that read a half-width of 29 cm against a true 17.8 cm, and the garment could never fit.
   * A profile follows the real outline, including the places where the body is concave.
   */
  const r = new Array<number>(NA).fill(0);
  for (const q of c.points) {
    const dx = q[0] - cx, dz = q[1] - cz;
    const ang = Math.atan2(dz, dx);
    const k = ((Math.round((ang / (2 * Math.PI)) * NA) % NA) + NA) % NA;
    r[k] = Math.max(r[k]!, Math.hypot(dx, dz));
  }
  // fill the bins no contour point landed in, from their neighbours
  for (let pass = 0; pass < NA; pass++) {
    let filled = true;
    for (let k = 0; k < NA; k++) {
      if (r[k]! > 0) continue;
      const a = r[(k - 1 + NA) % NA]!, b = r[(k + 1) % NA]!;
      if (a > 0 && b > 0) r[k] = (a + b) / 2;
      else if (a > 0) r[k] = a;
      else if (b > 0) r[k] = b;
      else filled = false;
    }
    if (filled) break;
  }
  if (r.every((v) => v === 0)) return null;
  return { y, cx, cz, a: (xmax - xmin) / 2, b: (zmax - zmin) / 2, r };
}

/** the interpolated profile of the body at a height and angle — used by garment shaping as well as collision */
export function profileAt(c: BodyColliders, y: number, ang: number): { r: number; cx: number; cz: number } | null {
  if (y < c.yMin || y > c.yMax || c.torso.length < 2) return null;
  const t = ((y - c.yMin) / (c.yMax - c.yMin)) * (c.torso.length - 1);
  const i0 = Math.max(0, Math.min(c.torso.length - 2, Math.floor(t)));
  const f = t - i0;
  const r0 = c.torso[i0]!, r1 = c.torso[i0 + 1]!;
  return {
    r: ringRadius(r0, ang) + (ringRadius(r1, ang) - ringRadius(r0, ang)) * f,
    cx: r0.cx + (r1.cx - r0.cx) * f,
    cz: r0.cz + (r1.cz - r0.cz) * f,
  };
}

/** radius of a ring at a given angle, linearly between bins */
function ringRadius(ring: TorsoRing, ang: number): number {
  const t = ((ang / (2 * Math.PI)) * NA + NA) % NA;
  const k0 = Math.floor(t) % NA, k1 = (k0 + 1) % NA, f = t - Math.floor(t);
  return ring.r[k0]! + (ring.r[k1]! - ring.r[k0]!) * f;
}

export function buildColliders(asset: BodyAsset, posed: Float32Array, step = 0.012): BodyColliders {
  const n = posed.length / 3;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) maxY = Math.max(maxY, posed[i * 3 + 1]!);
  const k = maxY / asset.landmarks.height;
  const yMin = asset.landmarks.crotch * k * 0.9;
  const shoulderY = asset.landmarks.neck_base * k;
  /**
   * The stack runs all the way to the top of the head. It used to stop at the acromion and leave the neck to a
   * capsule, but at collar height the body is the neck PLUS the trapezius behind it — 17 cm wide and 13 cm
   * deep, against a 6 cm capsule — so the back of the collar sat inside the body (349 vertices did).
   */
  const yMax = maxY;
  const torso: TorsoRing[] = [];
  for (let y = yMin; y <= yMax + 1e-9; y += step) {
    const r = ringAt(posed, asset.index, y);
    if (r) torso.push(r);
  }
  const bones = buildSkeleton(asset, posed);
  const bone = (nm: string) => bones.find((b) => b.name === nm)!;
  const capsules: Capsule[] = [];
  /**
   * Limb capsules follow the limb as it is POSED, measured by slicing. They used to be laid out from the
   * skeleton, whose bone heads are written in the T-pose layout — so with the arms down the capsules stayed
   * horizontal at shoulder height and the arms themselves had no collider at all: sleeves went straight
   * through them.
   */
  const limbChain = (side: 'left' | 'right', from: number, to: number, minX: number, segments: number): Capsule[] => {
    const sgn = (side === 'left' ? 1 : -1) as 1 | -1;
    const samples: { x: number; y: number; z: number; r: number }[] = [];
    const stepY = (from - to) / 48;
    for (let y = from; y > to; y -= stepY) {
      let cs;
      try { cs = sliceContours(posed, asset.index, y); } catch { continue; }
      const mine = cs.filter((c) => {
        const mx = c.points.reduce((t, q) => t + q[0], 0) / c.points.length;
        return Math.sign(mx) === sgn && Math.abs(mx) > minX;
      });
      if (!mine.length) continue;
      const c = mine.reduce((best, cur) => (cur.perimeter > best.perimeter ? cur : best));
      const mx = c.points.reduce((t, q) => t + q[0], 0) / c.points.length;
      const mz = c.points.reduce((t, q) => t + q[1], 0) / c.points.length;
      let r = 0;
      for (const q of c.points) r = Math.max(r, Math.hypot(q[0] - mx, q[1] - mz));
      samples.push({ x: mx, y, z: mz, r });
    }
    if (samples.length < 2) return [];
    const out: Capsule[] = [];
    for (let k = 0; k < segments; k++) {
      const i0 = Math.round((k / segments) * (samples.length - 1));
      const i1 = Math.round(((k + 1) / segments) * (samples.length - 1));
      if (i1 <= i0) continue;
      const A = samples[i0]!, B = samples[i1]!;
      out.push({ name: `${side}-limb-${k}`, a: [A.x, A.y, A.z], b: [B.x, B.y, B.z], r: Math.max(A.r, B.r) });
    }
    return out;
  };
  // the chain starts ABOVE the armpit so the deltoid is covered: starting at the armpit left a gap where the
  // shoulder capsule ends and the arm begins, and the sleeve sank into it (53 vertices did)
  const armTop = asset.landmarks.armpit * (maxY / asset.landmarks.height) + 0.05;
  const crotch = asset.landmarks.crotch * (maxY / asset.landmarks.height);
  for (const side of ['left', 'right'] as const) {
    const armMinX = Math.abs(bone(`upper_arm_${side}`).head[0]) * 0.75;
    capsules.push(...limbChain(side, armTop, crotch * 0.78, armMinX, 6).map((c) => ({ ...c, name: `arm_${side}_${c.name.split('-').pop()}` })));
    // the chain stops above the ankles: a foot contour is long and thin, and its max-distance radius reads as a
    // 12 cm ball around the ankle, which is wrong for anything below the knee
    capsules.push(...limbChain(side, crotch - 0.01, maxY * 0.07, 0.01, 5).map((c) => ({ ...c, name: `leg_${side}_${c.name.split('-').pop()}` })));
  }
  // Shoulders. The torso stack stops at the acromion level and the arm capsules start at the shoulder JOINT,
  // which leaves the deltoid slope — the span between the neck and the joint — covered by nothing. A collar
  // dropped straight through that gap, which is why the shirt slid off on every run. One capsule per side
  // closes it without filling the armhole, which an over-wide torso ring would have done.
  for (const side of ['left', 'right'] as const) {
    const sgn = side === 'left' ? 1 : -1;
    const j = bone(`upper_arm_${side}`).head;
    const topRing = ringAt(posed, asset.index, shoulderY - 0.01);
    const r = Math.max(0.035, Math.min(0.07, Math.abs(j[1] - shoulderY) * 0.9));
    capsules.push({ name: `shoulder_${side}`, a: [sgn * 0.02, shoulderY - 0.01, topRing ? topRing.cz : 0], b: [j[0] * 0.92, j[1] + r * 0.4, j[2]], r });
  }
  // Neck and head. The neck is SEARCHED for, not taken at a fixed height: one slice just above the shoulders
  // still cuts the shoulders, and that read a neck of radius 19.6 cm — wider than the shirt's own collar, so
  // the collar could never sit on the neck and the shirt was pushed off every time.
  const neckY = shoulderY, headTop = maxY;
  let nr = Infinity, nz = 0, nyBest = neckY;
  for (let y = neckY; y < neckY + (headTop - neckY) * 0.55; y += 0.005) {
    const r = ringAt(posed, asset.index, y);
    if (!r) continue;
    const rr = Math.max(r.a, r.b);
    if (rr < 0.02) continue; // a sliver (an ear, a jaw edge) is not the neck
    if (rr < nr) { nr = rr; nz = r.cz; nyBest = y; }
  }
  if (Number.isFinite(nr)) capsules.push({ name: 'neck', a: [0, neckY - 0.01, nz], b: [0, nyBest + (headTop - nyBest) * 0.15, nz], r: nr });
  const head = ringAt(posed, asset.index, (nyBest + headTop) / 2);
  if (head) capsules.push({ name: 'head', a: [0, (nyBest + headTop) / 2, head.cz], b: [0, headTop - (headTop - nyBest) * 0.15, head.cz], r: Math.max(head.a, head.b) });
  return { torso, capsules, yMin, yMax, shoulderY };
}

/**
 * Pushes a point out of the body. Returns true when it moved. `margin` is the fabric's own standoff.
 *
 * `normals` (optional) is the garment's per-vertex normal array. A garment modelled with thickness is TWO
 * surfaces about a millimetre apart; its inner wall faces the body. Giving both walls the same standoff shears
 * that millimetre apart — edges across the gap were stretched twentyfold and the mesh tore. With normals
 * supplied, a vertex whose normal opposes the push is treated as the inner wall and gets no standoff: it rests
 * on the body surface and the outer wall rides on top of it, which is where fabric actually sits.
 *
 * Written to be called millions of times: no allocation, no closures.
 */
export function resolvePoint(c: BodyColliders, p: Float32Array, i: number, margin: number, normals?: Float32Array | null): boolean {
  const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
  const innerMargin = (ux: number, uy: number, uz: number) => {
    if (!normals) return margin;
    const d = normals[i * 3]! * ux + normals[i * 3 + 1]! * uy + normals[i * 3 + 2]! * uz;
    // the inner wall still keeps a millimetre: the profile is sampled every 12 mm in height and every 11°, so
    // a point sitting exactly ON it can be a couple of millimetres inside the faceted body mesh
    return d >= 0 ? margin : 0.001;
  };
  /**
   * Every collider is resolved in turn, worst first. Correcting only the deepest violation per call was tried
   * — a proper projection onto the union, which should behave better in the armpit crevice — and it made
   * contact too weak overall: the shirt started sliding again (3.4 cm) and penetration did not improve.
   */
  let moved = false;
  if (y >= c.yMin && y <= c.yMax && c.torso.length > 1) {
    const t = ((y - c.yMin) / (c.yMax - c.yMin)) * (c.torso.length - 1);
    const i0 = Math.max(0, Math.min(c.torso.length - 2, Math.floor(t)));
    const f = t - i0;
    const r0 = c.torso[i0]!, r1 = c.torso[i0 + 1]!;
    const cx = r0.cx + (r1.cx - r0.cx) * f, cz = r0.cz + (r1.cz - r0.cz) * f;
    const dx = x - cx, dz = z - cz;
    const dl = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    const ux = dl > 1e-9 ? dx / dl : 1, uz = dl > 1e-9 ? dz / dl : 0;
    const want = ringRadius(r0, ang) + (ringRadius(r1, ang) - ringRadius(r0, ang)) * f + innerMargin(ux, 0, uz);
    if (dl < want) { p[i * 3] = cx + ux * want; p[i * 3 + 2] = cz + uz * want; moved = true; }
  }
  for (const cap of c.capsules) {
    const ax = cap.a[0], ay = cap.a[1], az = cap.a[2];
    const ex = cap.b[0] - ax, ey = cap.b[1] - ay, ez = cap.b[2] - az;
    const len2 = ex * ex + ey * ey + ez * ez || 1e-9;
    let u = ((p[i * 3]! - ax) * ex + (p[i * 3 + 1]! - ay) * ey + (p[i * 3 + 2]! - az) * ez) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + ex * u, qy = ay + ey * u, qz = az + ez * u;
    let dx = p[i * 3]! - qx, dy = p[i * 3 + 1]! - qy, dz = p[i * 3 + 2]! - qz;
    const d = Math.hypot(dx, dy, dz);
    const dl = d || 1e-9;
    const R = cap.r + innerMargin(dx / dl, dy / dl, dz / dl);
    if (d < R) {
      if (d < 1e-9) { dx = 1; dy = 0; dz = 0; }
      const s2 = R / dl;
      p[i * 3] = qx + dx * s2; p[i * 3 + 1] = qy + dy * s2; p[i * 3 + 2] = qz + dz * s2;
      moved = true;
    }
  }
  return moved;
}
