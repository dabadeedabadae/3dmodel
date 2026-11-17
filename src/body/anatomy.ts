/**
 * M01 — derived body frame: key heights, torso cross-sections, limb axes,
 * landmarks and collision capsules, all computed from `BodyParams`.
 *
 * Space: metres, Y up, +Z front, +X = WEARER's left, origin between the feet.
 * Nothing here is a mesh; `buildBody.ts` turns the frame into geometry and
 * fitting (F-stages) queries it through `getCrossSection` / `getCapsules`.
 *
 * Vertical layout (fractions of head height h and torso length T are the
 * classical canon; every constant is named so it can be reviewed):
 *   headTop = H
 *   chin    = H − h
 *   neckBase (suprasternal notch) = crotch + T
 *   shoulder (acromion) = neckBase − tan(slope)·(shoulderWidth/2 − neckR)
 *   armpit  = neckBase − 0.22 T     chest = neckBase − 0.30 T
 *   underbust = neckBase − 0.40 T   waist = neckBase − 0.55 T
 *   hip (greatest) = crotch + 0.15 T  crotch = legRatio·H
 *   knee = 0.61·crotch              ankle = 0.045·H
 */
import { bodySex, ellipseHalfWidth, type BodyParams } from './params';
import type { WearerSide } from '../domain/sides';

export interface Ellipse {
  y: number;
  cx: number;
  cz: number;
  /** half-width (x) and half-depth (z) */
  a: number;
  b: number;
  /** extra forward bulge (bust), applied to the front half only */
  bulge: number;
}

export type TorsoRingName = 'crotch' | 'hip' | 'waist' | 'underbust' | 'chest' | 'armpit' | 'deltoid' | 'shoulder' | 'neck_base';
export const TORSO_RING_NAMES: TorsoRingName[] = ['crotch', 'hip', 'waist', 'underbust', 'chest', 'armpit', 'deltoid', 'shoulder', 'neck_base'];

export interface LimbJoint {
  pos: [number, number, number];
  /** radius of the limb at this joint */
  r: number;
}

export interface LimbAxis {
  side: WearerSide;
  /** shoulder → elbow → wrist  |  hip → knee → ankle, each with radius; extra mid points for bulge */
  joints: LimbJoint[];
}

export interface Capsule {
  region: string;
  a: [number, number, number];
  b: [number, number, number];
  ra: number;
  rb: number;
}

export interface BodyFrame {
  params: BodyParams;
  heights: Record<'floor' | 'ankle' | 'knee' | 'crotch' | 'hip' | 'waist' | 'underbust' | 'chest' | 'armpit' | 'shoulder' | 'neck_base' | 'chin' | 'head_top', number>;
  head: { h: number; width: number; depth: number; cy: number; cz: number };
  neck: { r: number; yBottom: number; yTop: number };
  torso: Record<TorsoRingName, Ellipse>;
  arms: Record<WearerSide, LimbAxis>;
  legs: Record<WearerSide, LimbAxis>;
  hand: { length: number; width: number; thick: number };
  foot: { length: number; width: number; height: number };
  /** metres per "head" — handy for UI */
  headUnit: number;
}

const F = {
  armpit: 0.22,
  chest: 0.3,
  underbust: 0.4,
  waist: 0.55,
  hipAboveCrotch: 0.15,
  kneeOfCrotch: 0.61,
  ankleOfHeight: 0.045,
  neckOfHead: 0.4,
  upperArmOfArm: 0.56,
  thighOfLeg: 0.53,
  handOfHeight: 0.108,
  handWidthOfHeight: 0.05,
  footOfHeight: 0.152,
  footWidthOfHeight: 0.06,
  headWidthOfH: 0.72,
  headDepthOfH: 0.86,
};

export function computeFrame(p: BodyParams): BodyFrame {
  const sex = bodySex(p);
  const H = p.height;
  const h = H / p.headRatio;
  const crotch = p.legRatio * H;
  const T = p.torsoRatio * H;
  const neckBase = crotch + T;
  const neckR = p.neckCirc / (2 * Math.PI);
  const shoulderDrop = Math.tan(p.shoulderSlope) * Math.max(0.02, p.shoulderWidth / 2 - neckR);
  const heights: BodyFrame['heights'] = {
    floor: 0,
    ankle: F.ankleOfHeight * H,
    knee: F.kneeOfCrotch * crotch,
    crotch,
    hip: crotch + F.hipAboveCrotch * T,
    waist: neckBase - F.waist * T,
    underbust: neckBase - F.underbust * T,
    chest: neckBase - F.chest * T,
    armpit: neckBase - F.armpit * T,
    shoulder: neckBase - shoulderDrop,
    neck_base: neckBase,
    chin: H - h,
    head_top: H,
  };
  const dr = p.torsoDepthRatio;
  const ell = (y: number, circ: number, r: number, bulge = 0, cz = 0): Ellipse => {
    const a = ellipseHalfWidth(circ, r);
    return { y, cx: 0, cz, a, b: a * r, bulge };
  };
  const chest = ell(heights.chest, p.chestCirc, dr, p.bust);
  const hipR = sex === 'female' ? dr * 0.94 : dr;
  const hip = ell(heights.hip, p.hipCirc, hipR);
  const waist = ell(heights.waist, p.waistCirc, dr * 1.08);
  // shoulder ring: ribcage top, narrower than acromions by the arm joint radius
  const upperArmR = p.upperArmCirc / (2 * Math.PI);
  // deltoid cap: the torso surface wraps over the arm root, so the acromion ring is as wide as the shoulders
  const deltoidY = heights.shoulder - upperArmR * 0.75;
  const torso: BodyFrame['torso'] = {
    crotch: { y: heights.crotch + 0.012, cx: 0, cz: 0, a: hip.a * 0.6, b: hip.b * 0.66, bulge: 0 },
    hip,
    waist,
    underbust: ell(heights.underbust, (p.chestCirc + p.waistCirc) / 2, dr * 1.02, p.bust * 0.6),
    chest,
    armpit: { y: heights.armpit, cx: 0, cz: 0, a: chest.a * 0.98, b: chest.b * 0.96, bulge: p.bust * 0.35 },
    deltoid: { y: Math.max(heights.armpit + 0.01, deltoidY), cx: 0, cz: -0.003, a: p.shoulderWidth / 2 + upperArmR * 0.05, b: chest.b * 0.9, bulge: 0 },
    shoulder: { y: heights.shoulder, cx: 0, cz: -0.006, a: p.shoulderWidth / 2 - upperArmR * 0.45, b: chest.b * 0.72, bulge: 0 },
    neck_base: { y: heights.neck_base, cx: 0, cz: -0.01, a: neckR * 1.15, b: neckR * 1.05, bulge: 0 },
  };
  // arms (A-pose: abducted by armAbduction, elbow slightly forward)
  const armLen = p.armRatio * H;
  const upper = armLen * F.upperArmOfArm;
  const fore = armLen - upper;
  const forearmR = p.forearmCirc / (2 * Math.PI);
  const wristR = p.wristCirc / (2 * Math.PI);
  const arms = {} as Record<WearerSide, LimbAxis>;
  for (const side of ['left', 'right'] as WearerSide[]) {
    const s = side === 'left' ? 1 : -1;
    const sx = s * p.shoulderWidth / 2;
    const sy = heights.shoulder - upperArmR * 0.6;
    const dir = [s * Math.sin(p.armAbduction), -Math.cos(p.armAbduction), 0];
    const elbow: [number, number, number] = [sx + dir[0]! * upper, sy + dir[1]! * upper, 0.01];
    const wrist: [number, number, number] = [elbow[0] + dir[0]! * fore * 0.9, elbow[1] + dir[1]! * fore, 0.04];
    arms[side] = {
      side,
      joints: [
        { pos: [sx, sy, 0], r: upperArmR },
        { pos: [sx + dir[0]! * upper * 0.5, sy + dir[1]! * upper * 0.5, 0.005], r: upperArmR * 1.0 },
        { pos: elbow, r: (upperArmR * 0.8 + forearmR * 0.8) / 2 },
        { pos: [elbow[0] + dir[0]! * fore * 0.3, elbow[1] + dir[1]! * fore * 0.3, 0.02], r: forearmR },
        { pos: wrist, r: wristR },
      ],
    };
  }
  // legs
  const thighR = p.thighCirc / (2 * Math.PI);
  const calfR = p.calfCirc / (2 * Math.PI);
  const ankleR = p.ankleCirc / (2 * Math.PI);
  const legs = {} as Record<WearerSide, LimbAxis>;
  for (const side of ['left', 'right'] as WearerSide[]) {
    const s = side === 'left' ? 1 : -1;
    const hx = s * Math.min(Math.max(thighR + 0.004, hip.a * 0.46), Math.max(thighR + 0.004, hip.a - thighR));
    const ax = s * Math.max(ankleR * 1.3, hip.a * 0.42);
    const kx = (hx + ax) / 2;
    legs[side] = {
      side,
      joints: [
        { pos: [hx, heights.crotch + 0.07, 0], r: thighR },
        { pos: [hx * 0.9 + kx * 0.1, heights.crotch - (heights.crotch - heights.knee) * 0.35, 0.005], r: thighR * 0.92 },
        { pos: [kx, heights.knee, 0], r: (thighR * 0.72 + calfR * 0.9) / 2 },
        { pos: [kx * 0.5 + ax * 0.5, heights.knee - (heights.knee - heights.ankle) * 0.3, -0.01], r: calfR },
        { pos: [ax, heights.ankle, -0.01], r: ankleR },
      ],
    };
  }
  return {
    params: p,
    heights,
    head: { h, width: h * F.headWidthOfH, depth: h * F.headDepthOfH, cy: heights.chin + h / 2, cz: -0.012 },
    neck: { r: neckR, yBottom: heights.neck_base, yTop: heights.chin + 0.01 },
    torso,
    arms,
    legs,
    hand: { length: F.handOfHeight * H, width: F.handWidthOfHeight * H, thick: 0.028 * (H / 1.75) },
    foot: { length: F.footOfHeight * H, width: F.footWidthOfHeight * H, height: heights.ankle * 0.9 },
    headUnit: h,
  };
}

/** Torso cross-section at height y (linear interpolation between named rings; null outside torso). */
export function torsoCrossSection(frame: BodyFrame, y: number): Ellipse | null {
  const rings = TORSO_RING_NAMES.map((n) => frame.torso[n]);
  if (y < rings[0]!.y || y > rings[rings.length - 1]!.y) return null;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i]!,
      B = rings[i + 1]!;
    if (y >= A.y && y <= B.y) {
      const t = B.y === A.y ? 0 : (y - A.y) / (B.y - A.y);
      const L = (u: number, v: number) => u + (v - u) * t;
      return { y, cx: L(A.cx, B.cx), cz: L(A.cz, B.cz), a: L(A.a, B.a), b: L(A.b, B.b), bulge: L(A.bulge, B.bulge) };
    }
  }
  return null;
}

/** Point on an ellipse ring at angle θ (0 = +X wearer-left, π/2 = +Z front). Bust bulge applied on the front half. */
export function ellipsePoint(e: Ellipse, theta: number): [number, number, number] {
  const c = Math.cos(theta),
    s = Math.sin(theta);
  const bulge = s > 0 ? e.bulge * Math.pow(s, 2) * Math.pow(Math.max(0, 1 - Math.abs(c) * 0.6), 1) : 0;
  return [e.cx + e.a * c, e.y, e.cz + (e.b + bulge) * s];
}

/** Collision capsules for limbs + torso approximated by stacked capsules. */
export function bodyCapsules(frame: BodyFrame): Capsule[] {
  const out: Capsule[] = [];
  const limb = (axis: LimbAxis, region: string) => {
    for (let i = 0; i < axis.joints.length - 1; i++) {
      const A = axis.joints[i]!,
        B = axis.joints[i + 1]!;
      out.push({ region, a: A.pos, b: B.pos, ra: A.r, rb: B.r });
    }
  };
  limb(frame.arms.left, 'arm_left');
  limb(frame.arms.right, 'arm_right');
  limb(frame.legs.left, 'leg_left');
  limb(frame.legs.right, 'leg_right');
  // torso: central capsule per ring pair, radius = mean of half axes (fitting uses cross-sections for precision)
  for (let i = 0; i < TORSO_RING_NAMES.length - 1; i++) {
    const A = frame.torso[TORSO_RING_NAMES[i]!],
      B = frame.torso[TORSO_RING_NAMES[i + 1]!];
    out.push({ region: 'torso', a: [A.cx, A.y, A.cz], b: [B.cx, B.y, B.cz], ra: (A.a + A.b) / 2, rb: (B.a + B.b) / 2 });
  }
  out.push({ region: 'neck', a: [0, frame.neck.yBottom, -0.01], b: [0, frame.neck.yTop, -0.005], ra: frame.neck.r, rb: frame.neck.r * 0.95 });
  out.push({ region: 'head', a: [0, frame.heights.chin + frame.head.h * 0.3, frame.head.cz], b: [0, frame.heights.head_top - frame.head.width / 2, frame.head.cz], ra: frame.head.width / 2, rb: frame.head.width / 2 });
  return out;
}

/** Signed distance from point to the capsule set (negative = inside). */
export function capsuleSignedDistance(caps: Capsule[], x: number, y: number, z: number): number {
  let best = Infinity;
  for (const c of caps) {
    const ax = c.a[0],
      ay = c.a[1],
      az = c.a[2];
    const dx = c.b[0] - ax,
      dy = c.b[1] - ay,
      dz = c.b[2] - az;
    const L2 = dx * dx + dy * dy + dz * dz || 1e-12;
    let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t,
      py = ay + dy * t,
      pz = az + dz * t;
    const r = c.ra + (c.rb - c.ra) * t;
    const d = Math.hypot(x - px, y - py, z - pz) - r;
    if (d < best) best = d;
  }
  return best;
}

/** Is a point inside the torso cross-section ellipse at its height (with margin)? */
export function insideTorso(frame: BodyFrame, x: number, y: number, z: number, margin = 0): boolean {
  const e = torsoCrossSection(frame, y);
  if (!e) return false;
  const nx = (x - e.cx) / (e.a + margin);
  const nz = (z - e.cz) / (e.b + margin);
  return nx * nx + nz * nz < 1;
}
