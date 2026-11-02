/**
 * Row/column geometry of the T-shirt torso grid, shared by the mesh builder
 * and by the parameter clamp (which needs the exact armhole-ring tilt).
 * No three.js dependency.
 */
import type { WearerSide } from '../../domain/sides';
import type { TShirtParams } from './params';

export const M = 16; // columns around the torso
export const NECK_ROW = 6;
export const COLLAR_ROW = 7;

/** Armhole loops as [row, col] in loop order (counter-clockwise seen from outside), starting at the underarm.
 *  ARMHOLE_LEFT is on +X (wearer's left), ARMHOLE_RIGHT on -X. */
export const ARMHOLE_LEFT: [number, number][] = [
  [3, 4],
  [3, 5],
  [4, 5],
  [5, 5],
  [5, 4],
  [5, 3],
  [4, 3],
  [3, 3],
];
export const ARMHOLE_RIGHT: [number, number][] = [
  [3, 12],
  [3, 13],
  [4, 13],
  [5, 13],
  [5, 12],
  [5, 11],
  [4, 11],
  [3, 11],
];
export const armholeLoop = (side: WearerSide) => (side === 'left' ? ARMHOLE_LEFT : ARMHOLE_RIGHT);

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export function torsoRow(p: TShirtParams, row: number): { y: number; a: number; b: number } {
  const L = p.length;
  const AD = p.armholeDepth;
  const R = L - AD; // length below the armpit (clamp guarantees R > 0)
  const chestB = p.chestHalfWidth * p.depthRatio;
  // The shoulder ring is the shoulder LINE of a worn tee: thin front-to-back, just
  // deeper than the neck opening so the front/back panels run up to the neckline
  // instead of a flat "lid" (checkpoint A finding, DECISIONS D-10).
  const shoulderB = Math.min(chestB, p.neckHalfWidth * 0.85 + 0.03);
  const midA = (p.hemHalfWidth + p.chestHalfWidth) / 2;
  switch (row) {
    case 0:
      return { y: -L, a: p.hemHalfWidth, b: p.hemHalfWidth * p.depthRatio };
    case 1:
      return { y: -AD - 0.62 * R, a: midA, b: midA * p.depthRatio };
    case 2:
      return { y: -AD - 0.22 * R, a: p.chestHalfWidth, b: chestB };
    case 3:
      return { y: -AD, a: p.chestHalfWidth, b: chestB };
    case 4:
      // keep most of the depth up to mid-armhole so the front stays upright and the neckline reads as a cut, not a dome
      return { y: -AD * 0.5, a: (p.chestHalfWidth + p.shoulderHalfWidth) / 2, b: chestB * 0.75 + shoulderB * 0.25 };
    case 5:
      return { y: 0, a: p.shoulderHalfWidth, b: shoulderB };
    default:
      throw new Error(`bad torso row ${row}`);
  }
}

export function neckDrop(p: TShirtParams, theta: number): number {
  const front = Math.max(0, Math.cos(theta));
  return p.neckBackDrop + (p.neckFrontDrop - p.neckBackDrop) * Math.pow(front, 1.2);
}

/** Position of a logical grid vertex (rows 0..7). */
export function gridPosition<T extends V3>(p: TShirtParams, row: number, col: number, out: T): T {
  const theta = (2 * Math.PI * col) / M;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  if (row <= 5) {
    const r = torsoRow(p, row);
    let y = r.y;
    if (row === 5) y -= p.shoulderSlope * Math.abs(s);
    return set(out, r.a * s, y, r.b * c);
  }
  const neckB = p.neckHalfWidth * 0.85;
  const yNeck = 0.02 - neckDrop(p, theta);
  if (row === NECK_ROW) return set(out, p.neckHalfWidth * s, yNeck, neckB * c);
  // collar inner ring
  const k = (p.neckHalfWidth - p.collarWidth) / p.neckHalfWidth;
  return set(out, p.neckHalfWidth * k * s, yNeck + p.collarWidth * 0.6, neckB * k * c);
}


function set<T extends V3>(o: T, x: number, y: number, z: number): T {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
}

/**
 * Elevation (radians, + = up) of the sleeve base axis for these params: the
 * normal, in the XY plane, of the chord from the underarm vertex (row 3) to the
 * shoulder vertex (row 5) of the armhole at the side column. The builder uses
 * the same definition, so: sleeve is horizontal-or-down iff
 * armholeRingElevation(p) <= p.sleeveAngle. For a boxy cut (shoulder == chest)
 * it is exactly 0 whatever the shoulder slope.
 */
export function armholeRingElevation(p: TShirtParams): number {
  const bottom = gridPosition(p, 3, 4, { x: 0, y: 0, z: 0 });
  const top = gridPosition(p, 5, 4, { x: 0, y: 0, z: 0 });
  // chord direction (dx, dy); outward normal = (dy, -dx) for the +X side
  const dx = top.x - bottom.x;
  const dy = top.y - bottom.y;
  let nx = dy;
  let ny = -dx;
  if (nx < 0) {
    nx = -nx;
    ny = -ny;
  }
  return Math.atan2(ny, nx);
}
