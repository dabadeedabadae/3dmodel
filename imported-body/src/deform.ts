/**
 * Stage I-02 — parametric deformation of an IMPORTED mesh.
 *
 * The mesh has no rig and arbitrary topology, so the parameters cannot be ring radii as in lowpoly-v2. Instead
 * each weight drives a smooth DISPLACEMENT FIELD over the canonical vertices:
 *   • torso  — scale in x/z about the body axis, with a per-height profile built from the landmarks
 *   • arms   — scale about the arm axis (the arms run along ±X in the T-pose) + the shoulder shift
 *   • legs   — scale about each leg's own axis
 * Region membership is a smooth weight, not a cut, so no seams open where the fields meet.
 *
 * Weights are DIMENSIONLESS in [−1, 1]. Centimetres come only from measuring the resulting mesh (stage I-03) —
 * never from the weights themselves.
 */
import type { BodyAsset } from './asset';

export interface Weights {
  chest: number;
  waist: number;
  hip: number;
  shoulders: number;
  arms: number;
  thighs: number;
}
export const WEIGHT_NAMES = ['chest', 'waist', 'hip', 'shoulders', 'arms', 'thighs'] as const;
export const ZERO: Weights = { chest: 0, waist: 0, hip: 0, shoulders: 0, arms: 0, thighs: 0 };
export const LIMIT = 1;
/** relative change of a girth at weight = ±1 */
export const GAIN: Record<keyof Weights, number> = { chest: 0.3, waist: 0.5, hip: 0.32, shoulders: 0.12, arms: 0.28, thighs: 0.3 };

export interface HeightMode {
  /** 'keep_girths': stature only; 'proportional': every length scales, girths follow */
  mode: 'keep_girths' | 'proportional';
  height_cm: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
/** piecewise-linear profile through (level, value) knots, flat outside */
function profile(knots: [number, number][], y: number): number {
  if (y <= knots[0]![0]) return knots[0]![1];
  const last = knots[knots.length - 1]!;
  if (y >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]!, b = knots[i]!;
    if (y <= b[0]) return a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0] || 1);
  }
  return last[1];
}

export function clampWeights(w: Partial<Weights>): Weights {
  const out = { ...ZERO };
  for (const n of WEIGHT_NAMES) out[n] = clamp(w[n] ?? 0, -LIMIT, LIMIT);
  return out;
}

/**
 * Canonical positions → deformed positions. Pure: the asset's base array is never written to.
 */
export function deform(asset: BodyAsset, weightsIn: Partial<Weights>, height?: HeightMode): Float32Array {
  const w = clampWeights(weightsIn);
  const L = asset.landmarks;
  const out = new Float32Array(asset.base);
  const n = out.length / 3;

  // torso girth profile: each weight owns a level and fades into its neighbours
  const g = (k: keyof Weights) => 1 + GAIN[k] * w[k];
  const sX: [number, number][] = [
    [0, g('hip')],
    [L.crotch, g('hip')],
    [L.hip, g('hip')],
    [(L.hip + L.waist) / 2, 1 + (GAIN.hip * w.hip + GAIN.waist * w.waist) / 2],
    [L.waist, g('waist')],
    [(L.waist + L.chest) / 2, 1 + (GAIN.waist * w.waist + GAIN.chest * w.chest) / 2],
    [L.chest, g('chest')],
    [L.armpit, 1 + GAIN.chest * w.chest * 0.85 + GAIN.shoulders * w.shoulders * 0.6],
    [L.shoulder_level, 1 + GAIN.shoulders * w.shoulders],
    [L.neck_base, 1 + GAIN.shoulders * w.shoulders * 0.35],
    [L.neck_base + (L.height - L.neck_base) * 0.25, 1],
    [L.height, 1],
  ];
  // depth follows width but softer: a wider chest is mostly frontal, a wider waist is all round
  const depthShare: Record<string, number> = { hip: 0.9, waist: 1, chest: 1.15, shoulders: 0.5 };
  const sZ: [number, number][] = sX.map(([y, s]) => {
    const k = y <= L.waist ? (y <= L.hip ? depthShare.hip! : depthShare.waist!) : y <= L.armpit ? depthShare.chest! : depthShare.shoulders!;
    return [y, 1 + (s - 1) * k];
  });

  // shoulder widening also carries the arms outward, otherwise they would detach from the deltoids
  const shoulderShift = (asset.axis.length ? profileHalfX(asset, L.shoulder_level) : 0) * GAIN.shoulders * w.shoulders;
  const armLow = asset.armBand.low, armHigh = asset.armBand.high;
  const armAxisY = (armLow + armHigh) / 2;
  const armIn = profileHalfX(asset, L.armpit) * 1.02;
  const armOut = armIn * 1.6;
  const legScale = 1 + GAIN.thighs * w.thighs;
  const armScale = 1 + GAIN.arms * w.arms;

  for (let i = 0; i < n; i++) {
    const x = out[i * 3]!, y = out[i * 3 + 1]!, z = out[i * 3 + 2]!;
    // smooth region weights
    const wArm = smooth(armIn, armOut, Math.abs(x)) * smooth(armLow - 0.06, armLow + 0.02, y);
    const wLeg = 1 - smooth(L.crotch - 0.05, L.crotch + 0.05, y);
    const wTorso = clamp(1 - Math.max(wArm, wLeg), 0, 1);
    let dx = 0, dy = 0, dz = 0;
    if (wTorso > 0) {
      const cz = axisCz(asset, y);
      dx += wTorso * x * (profile(sX, y) - 1);
      dz += wTorso * (z - cz) * (profile(sZ, y) - 1);
    }
    if (wLeg > 0) {
      // the side factor must vanish on the centre seam (x = 0), or those vertices are pushed to one side and
      // the mesh stops being symmetric — the symmetry check catches it immediately
      const side = Math.sign(x) * smooth(0, profileHalfX(asset, L.crotch) * 0.3, Math.abs(x));
      const c = legCentre(asset, y, side);
      dx += wLeg * (x - c.cx) * (legScale - 1);
      dz += wLeg * (z - c.cz) * (legScale - 1);
      // the thigh tops ride the pelvis width
      dx += wLeg * c.cx * (profile(sX, L.crotch) - 1) * smooth(L.crotch - 0.25, L.crotch, y);
    }
    if (wArm > 0) {
      const cz = axisCz(asset, armAxisY);
      dy += wArm * (y - armAxisY) * (armScale - 1);
      dz += wArm * (z - cz) * (armScale - 1);
      dx += wArm * Math.sign(x) * shoulderShift;
    }
    void i;
    out[i * 3] = x + dx;
    out[i * 3 + 1] = y + dy;
    out[i * 3 + 2] = z + dz;
  }
  if (height) applyHeight(out, asset, height);
  return out;
}

/** stature: mode A scales lengths only; mode B scales everything (the figure keeps its proportions) */
function applyHeight(p: Float32Array, asset: BodyAsset, h: HeightMode): void {
  const k = h.height_cm / 100 / asset.landmarks.height;
  if (Math.abs(k - 1) < 1e-9) return;
  for (let i = 0; i < p.length / 3; i++) {
    p[i * 3 + 1] = p[i * 3 + 1]! * k;
    if (h.mode === 'proportional') {
      p[i * 3] = p[i * 3]! * k;
      p[i * 3 + 2] = p[i * 3 + 2]! * k;
    }
  }
}

function axisCz(a: BodyAsset, y: number): number {
  return profile(a.axis.map((r) => [r.y, r.cz] as [number, number]), y);
}
function profileHalfX(a: BodyAsset, y: number): number {
  return profile(a.axis.map((r) => [r.y, r.halfX] as [number, number]), y);
}
/**
 * A leg's own axis. When the asset carries a measured one (a dressed figure does), it is used: the estimate
 * below — half the pelvis width tapering to the ankle — put the axis through the surface near the shin on a
 * figure in trousers, and scaling about it turned triangles inside out.
 */
function legCentre(a: BodyAsset, y: number, side: number): { cx: number; cz: number } {
  if (a.legAxis && a.legAxis.length > 1) {
    const arr = a.legAxis;
    let i0 = 0;
    while (i0 < arr.length - 2 && arr[i0 + 1]!.y < y) i0++;
    const p0 = arr[i0]!, p1 = arr[i0 + 1]!;
    const f = clamp((y - p0.y) / (p1.y - p0.y || 1e-9), 0, 1);
    return { cx: side * (p0.cx + (p1.cx - p0.cx) * f), cz: p0.cz + (p1.cz - p0.cz) * f };
  }
  const hipHalf = profileHalfX(a, a.landmarks.crotch);
  const t = clamp(y / Math.max(a.landmarks.crotch, 1e-6), 0, 1);
  return { cx: side * hipHalf * 0.5 * (0.55 + 0.45 * t), cz: axisCz(a, y) };
}
