// Moved from lowpoly-v2/src/measure.ts on 2026-11-18 when lowpoly-v2 went to archive/ (I-45). Unchanged.
/**
 * Stage 05 — measurement core: measurements are taken from the ACTUAL mesh surface in the rest pose.
 *
 *  - circumferences: intersect the triangle mesh with a horizontal plane y = level, chain the segments into
 *    closed contours, pick the torso contour (the one that contains the centre line x = 0 … and is not an arm
 *    or a leg), return its perimeter. Arms are never included: a plane through the chest also cuts both
 *    arms, which give their own closed contours and are discarded.
 *  - "surface perimeter" (polygon length) vs "tape" (convex hull of the contour): a tape bridges concavities;
 *    both are returned, `tape` is what a tailor would read.
 *  - levels are tied to landmarks of the frame (chest/waist/hip heights), so they move with height changes.
 *  - diagnostic errors (`MeasureError`) when a contour is open or ambiguous — never a silent guess.
 *  - shoulder width = distance between the acromion landmarks of the frame (paired landmarks, not a bbox).
 *  - discretisation: an 8-gon inscribed in a circle has perimeter 8·2r·sin(π/8) ≈ 0.974 × 2πr (−2.6 %),
 *    a 14-gon ≈ −0.84 %; a low-poly body "measures" slightly less than its smooth intent. Reported as `note`.
 */
import type { BodyFrame, BodyMeshV2 } from './mesh';

export type MeasureName = 'height' | 'chest' | 'waist' | 'hip' | 'shoulder_width';
export const MEASURE_NAMES: MeasureName[] = ['height', 'chest', 'waist', 'hip', 'shoulder_width'];

export interface Contour {
  points: [number, number][]; // (x, z)
  closed: boolean;
  perimeter: number;
  /** convex-hull ("tape") perimeter */
  tape: number;
  centroid: [number, number];
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export class MeasureError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_CONTOUR' | 'OPEN_CONTOUR' | 'AMBIGUOUS' | 'OUT_OF_RANGE',
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** All closed contours of the mesh cut by the plane y = level. */
export function sliceContours(positions: Float32Array, index: Uint32Array, level: number): Contour[] {
  const segs: [number, number, number, number][] = [];
  const P = (i: number) => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!] as const;
  for (let t = 0; t < index.length; t += 3) {
    const pts = [P(index[t]!), P(index[t + 1]!), P(index[t + 2]!)];
    const cross: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = pts[k]!,
        b = pts[(k + 1) % 3]!;
      const da = a[1] - level,
        db = b[1] - level;
      if (da === 0 && db === 0) continue;
      if ((da < 0 && db < 0) || (da > 0 && db > 0)) continue;
      if (da === 0) {
        cross.push([a[0], a[2]]);
        continue;
      }
      if (db === 0) continue; // counted at the next edge (as its start)
      const s = da / (da - db);
      cross.push([a[0] + (b[0] - a[0]) * s, a[2] + (b[2] - a[2]) * s]);
    }
    if (cross.length >= 2) {
      const [p, q] = [cross[0]!, cross[1]!];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) segs.push([p[0], p[1], q[0], q[1]]);
    }
  }
  // chain segments by endpoint proximity
  const f6 = (v: number) => (Math.abs(v) < 5e-7 ? '0.000000' : v.toFixed(6));
  const key = (x: number, z: number) => `${f6(x)},${f6(z)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) (ends.get(k) ?? ends.set(k, []).get(k)!).push(i);
  });
  const used = new Uint8Array(segs.length);
  const contours: Contour[] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const pts: [number, number][] = [[segs[s0]![0], segs[s0]![1]]];
    let cur: [number, number] = [segs[s0]![2], segs[s0]![3]];
    let closed = false;
    for (let guard = 0; guard < segs.length + 1; guard++) {
      pts.push(cur);
      if (key(cur[0], cur[1]) === key(pts[0]![0], pts[0]![1]) && pts.length > 2) {
        closed = true;
        pts.pop();
        break;
      }
      const cands = (ends.get(key(cur[0], cur[1])) ?? []).filter((i) => !used[i]);
      if (!cands.length) break;
      const i = cands[0]!;
      used[i] = 1;
      const s = segs[i]!;
      cur = key(s[0], s[1]) === key(cur[0], cur[1]) ? [s[2], s[3]] : [s[0], s[1]];
    }
    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!,
        b = pts[(i + 1) % pts.length]!;
      if (i === pts.length - 1 && !closed) break;
      per += Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
      cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const hull = convexHull(pts);
    let tape = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!,
        b = hull[(i + 1) % hull.length]!;
      tape += Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    contours.push({ points: pts, closed, perimeter: per, tape, centroid: [cx, cz], bbox: { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])) } });
  }
  return contours;
}

export function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The torso contour at a level: closed, encloses the centre line (x≈0 inside its x-range), and is the widest such. */
export function torsoContour(positions: Float32Array, index: Uint32Array, level: number): Contour {
  // measurement levels coincide with ring rows; a plane exactly through vertices makes the chaining ambiguous,
  // so the cut is taken 0.01 mm above the nominal level (documented, negligible)
  const all = sliceContours(positions, index, level + 1e-5);
  if (!all.length) throw new MeasureError(`no contour at y=${level.toFixed(3)}`, 'NO_CONTOUR', { level });
  const open = all.filter((c) => !c.closed);
  const central = all.filter((c) => c.closed && c.bbox.minX < 0 && c.bbox.maxX > 0 && c.bbox.minZ < 0 && c.bbox.maxZ > 0);
  if (!central.length) {
    if (open.length) throw new MeasureError(`only open contours at y=${level.toFixed(3)} (${open.length})`, 'OPEN_CONTOUR', { level, open: open.length });
    throw new MeasureError(`no closed contour around the centre line at y=${level.toFixed(3)} (${all.length} contours: arms/legs only?)`, 'AMBIGUOUS', { level, contours: all.length });
  }
  if (central.length > 1) {
    // e.g. both legs straddling x=0 never happens (each leg is on one side); nested contours would be a mesh bug
    throw new MeasureError(`${central.length} closed contours around the centre line at y=${level.toFixed(3)}`, 'AMBIGUOUS', { level, central: central.length });
  }
  return central[0]!;
}

export interface Measurements {
  /** centimetres, from the surface */
  height_cm: number;
  chest_cm: number;
  waist_cm: number;
  hip_cm: number;
  shoulder_width_cm: number;
  /** polygon perimeters (not tape) for reference */
  surface_cm: { chest: number; waist: number; hip: number };
  levels_m: { chest: number; waist: number; hip: number };
  contours: { chest: Contour; waist: Contour; hip: Contour };
  note: string;
}

export function measureBody(mesh: BodyMeshV2): Measurements {
  const pos = mesh.geometry.attributes.position!.array as Float32Array;
  const idx = mesh.geometry.index!.array as Uint32Array;
  const F: BodyFrame = mesh.frame;
  const levels = { chest: F.heights['chest']!, waist: F.heights['waist']!, hip: F.heights['hip']! };
  const chest = torsoContour(pos, idx, levels.chest);
  const waist = torsoContour(pos, idx, levels.waist);
  const hip = torsoContour(pos, idx, levels.hip);
  let maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) maxY = Math.max(maxY, pos[i]!);
  const l = F.joints.left.shoulder,
    r = F.joints.right.shoulder;
  // acromion landmarks: the frame's shoulder joints sit 0.55·armR below the acromion; shoulder width is their X distance
  const sw = Math.hypot(l[0] - r[0], l[1] - r[1], l[2] - r[2]);
  return {
    height_cm: maxY * 100,
    chest_cm: chest.tape * 100,
    waist_cm: waist.tape * 100,
    hip_cm: hip.tape * 100,
    shoulder_width_cm: sw * 100,
    surface_cm: { chest: chest.perimeter * 100, waist: waist.perimeter * 100, hip: hip.perimeter * 100 },
    levels_m: levels,
    contours: { chest, waist, hip },
    note: 'tape = convex hull of the plane cut (bridges concavities, like a tape measure); surface = polygon perimeter. Levels follow the frame landmarks (chest/waist/hip heights). Low-poly discretisation: a 14-gon reads ≈0.8 % below the smooth circumference.',
  };
}
