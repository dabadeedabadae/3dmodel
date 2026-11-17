/**
 * Stage I-03 — measurements of the imported body, taken from the MESH, never from the weights.
 * Horizontal slices give the girths. The T-pose puts the arms in the plane of every chest-level slice, so the
 * shoulder width is taken from VERTICAL slices instead: walking outward in x, the cross-section girth falls to a
 * local minimum at the arm root — that neck of the surface is the shoulder joint.
 */
import { sliceContours } from './geom/measure';
import type { BodyAsset } from './asset';

export interface ImportedMeasurements {
  height_cm: number;
  chest_cm: number;
  waist_cm: number;
  hip_cm: number;
  /** width of the torso at the armhole level — NOT biacromial width (see measure.ts) */
  torso_width_cm: number;
  bicep_cm: number;
  thigh_cm: number;
  levels_m: Record<string, number>;
}

/** the girth of the body (not of a limb) at this height: the longest contour, which below the arms is the torso */
function girthAt(p: Float32Array, idx: Uint32Array, y: number): number {
  const cs = sliceContours(p, idx, y);
  if (!cs.length) return NaN;
  return Math.max(...cs.map((c) => c.perimeter));
}
/** girth of the limb contour that lies on one side (used for bicep / thigh, where two contours are cut) */
function sideGirthAt(p: Float32Array, idx: Uint32Array, y: number, side: 1 | -1): number {
  const cs = sliceContours(p, idx, y).filter((c) => {
    let sx = 0;
    for (const q of c.points) sx += q[0];
    return Math.sign(sx / c.points.length) === side;
  });
  if (!cs.length) return NaN;
  return Math.max(...cs.map((c) => c.perimeter));
}
/** rotate 90° about Z so that a "horizontal" slice of the copy is a vertical slice of the body */
function rotatedZ(p: Float32Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length / 3; i++) {
    out[i * 3] = -p[i * 3 + 1]!;
    out[i * 3 + 1] = p[i * 3]!;
    out[i * 3 + 2] = p[i * 3 + 2]!;
  }
  return out;
}

/**
 * Half-width of the TORSO at the armhole, and the fingertip reach. The arms lie in the plane of every slice at
 * shoulder height in a T-pose, so the level is stepped down until the slice is clearly the torso alone. One
 * definition, used by the measurements and by the skeleton — they disagreed once and the arm bones ended up
 * at the fingertips.
 */
export function armholeHalfWidth(asset: BodyAsset, positions: Float32Array): { half: number; level: number; tipX: number } {
  const n = positions.length / 3;
  let maxY = -Infinity, tipX = 0;
  for (let i = 0; i < n; i++) { maxY = Math.max(maxY, positions[i * 3 + 1]!); tipX = Math.max(tipX, Math.abs(positions[i * 3]!)); }
  const k = maxY / asset.landmarks.height;
  let half = 0,
    level = asset.landmarks.armpit * k - 0.006;
  for (let step = 0; step < 12; step++) {
    half = 0;
    for (const c of sliceContours(positions, asset.index, level)) for (const q of c.points) half = Math.max(half, Math.abs(q[0]));
    if (half < tipX * 0.45) break;
    level -= 0.01;
  }
  return { half, level, tipX };
}

export function measureImported(asset: BodyAsset, positions: Float32Array): ImportedMeasurements {
  const idx = asset.index;
  const L = asset.landmarks;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length / 3; i++) maxY = Math.max(maxY, positions[i * 3 + 1]!);
  const k = maxY / L.height; // the stature may have been scaled; landmark levels ride along
  const lv = (y: number) => y * k;
  const rot = rotatedZ(positions);
  // Shoulder width across the deltoids CANNOT be measured on a T-pose mesh: the deltoid continues into the arm
  // with no geometric break, so every threshold rule jumps around (tried and rejected — it moved the wrong way
  // when the shoulder weight went down). What IS well defined is the width of the TORSO at the armhole level,
  // taken just below the arm band where the slice is clean. That is also the number garment fitting needs.
  const { half: torsoHalf, tipX } = armholeHalfWidth(asset, positions);
  const bicepX = torsoHalf + (tipX - torsoHalf) * 0.16;
  const cm = (m: number) => Number((m * 100).toFixed(1));
  const armMidY = ((asset.armBand.low + asset.armBand.high) / 2) * k;
  return {
    height_cm: cm(maxY),
    chest_cm: cm(girthAt(positions, idx, lv(L.chest) - 0.004)),
    waist_cm: cm(girthAt(positions, idx, lv(L.waist))),
    hip_cm: cm(girthAt(positions, idx, lv(L.hip))),
    torso_width_cm: cm(2 * torsoHalf),
    // a vertical plane at this x cuts ONE arm, so the contour perimeter IS the girth (it was halved once —
    // that made every athletic target unreachable)
    bicep_cm: cm(girthAt(rot, idx, bicepX)),
    thigh_cm: cm(sideGirthAt(positions, idx, lv(L.crotch) * 0.92, 1)),
    levels_m: { chest: lv(L.chest), waist: lv(L.waist), hip: lv(L.hip), armMidY, armholeX: torsoHalf, bicepX },
  };
}
