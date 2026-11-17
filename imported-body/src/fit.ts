/**
 * Stage I-05 — measurements in centimetres → slider weights.
 *
 * Damped Gauss–Newton on the ACTUAL mesh measurements (stage I-03), not on a formula: every iteration deforms
 * the body, measures it by slicing, and compares. The Jacobian is numerical. Weights stay inside ±1, and a
 * target that the body cannot reach is reported as out_of_range with the limiting weights named — never
 * silently rounded to the nearest body.
 *
 * Stature is NOT fitted: it is set directly (the height slider is exact by construction).
 * Shoulder width is NOT fitted: it cannot be measured on a T-pose mesh (see measure.ts).
 */
import type { BodyAsset } from './asset';
import { deform, LIMIT, type Weights } from './deform';
import { measureImported } from './measure';
import fitConfig from '../config/fit.json';

export const FIT_TARGETS = ['chest', 'waist', 'hip', 'thigh', 'bicep'] as const;
export type FitTarget = (typeof FIT_TARGETS)[number];
/** which weight drives which target (one each; the solver still sees the full coupling through the Jacobian) */
const DRIVER: Record<FitTarget, keyof Weights> = { chest: 'chest', waist: 'waist', hip: 'hip', thigh: 'thighs', bicep: 'arms' };

export interface FitRequest {
  height_cm?: number;
  heightMode?: 'keep_girths' | 'proportional';
  targets: Partial<Record<FitTarget, number>>;
}
export interface FitResult {
  weights: Weights;
  height_cm: number;
  status: 'ok' | 'approximate' | 'out_of_range' | 'failed';
  iterations: number;
  achieved: Record<string, number>;
  residual_cm: Record<string, number>;
  /** weights the solver could not move further (at a bound) */
  limiting: string[];
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function measureFor(asset: BodyAsset, w: Weights, height_cm: number, mode: 'keep_girths' | 'proportional') {
  const p = deform(asset, w, { mode, height_cm });
  const m = measureImported(asset, p);
  return { chest: m.chest_cm, waist: m.waist_cm, hip: m.hip_cm, thigh: m.thigh_cm, bicep: m.bicep_cm, height: m.height_cm };
}

export function fitToMeasurements(asset: BodyAsset, req: FitRequest): FitResult {
  const C = fitConfig;
  const names = (Object.keys(req.targets) as FitTarget[]).filter((t) => Number.isFinite(req.targets[t]));
  const vars = names.map((t) => DRIVER[t]);
  const height_cm = req.height_cm ?? asset.landmarks.height * 100;
  const mode = req.heightMode ?? 'keep_girths';
  const w: Weights = { chest: 0, waist: 0, hip: 0, shoulders: 0, arms: 0, thighs: 0 };
  const limiting = new Set<string>();
  let it = 0;
  let cur = measureFor(asset, w, height_cm, mode);
  if (!names.length) return { weights: w, height_cm, status: 'ok', iterations: 0, achieved: cur, residual_cm: {}, limiting: [] };

  const resid = () => names.map((t) => req.targets[t]! - (cur as any)[t]);
  for (it = 1; it <= C.max_iterations; it++) {
    const r = resid();
    if (Math.max(...r.map(Math.abs)) <= C.tolerance_ok_cm) break;
    // numerical Jacobian: one deform+measure per variable, forward or backward at a bound
    const J: number[][] = [];
    for (let j = 0; j < vars.length; j++) {
      const v = vars[j]!;
      const h = w[v] + C.jacobian_step <= LIMIT ? C.jacobian_step : -C.jacobian_step;
      const w2 = { ...w, [v]: clamp(w[v] + h, -LIMIT, LIMIT) };
      const m2 = measureFor(asset, w2, height_cm, mode);
      J.push(names.map((t) => ((m2 as any)[t] - (cur as any)[t]) / h));
    }
    // damped normal equations (JᵀJ + λI) d = Jᵀr, solved by Gauss–Jordan
    const n = vars.length;
    const A: number[][] = Array.from({ length: n }, (_, a) => Array.from({ length: n + 1 }, (_, b) => 0));
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let k = 0; k < names.length; k++) s += J[a]![k]! * J[b]![k]!;
        A[a]![b] = s + (a === b ? C.damping : 0);
      }
      let s = 0;
      for (let k = 0; k < names.length; k++) s += J[a]![k]! * r[k]!;
      A[a]![n] = s;
    }
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let rI = c + 1; rI < n; rI++) if (Math.abs(A[rI]![c]!) > Math.abs(A[piv]![c]!)) piv = rI;
      if (Math.abs(A[piv]![c]!) < 1e-12) continue;
      [A[c], A[piv]] = [A[piv]!, A[c]!];
      const d = A[c]![c]!;
      for (let k = c; k <= n; k++) A[c]![k] = A[c]![k]! / d;
      for (let rI = 0; rI < n; rI++) {
        if (rI === c) continue;
        const f = A[rI]![c]!;
        if (!f) continue;
        for (let k = c; k <= n; k++) A[rI]![k] = A[rI]![k]! - f * A[c]![k]!;
      }
    }
    let moved = false;
    for (let j = 0; j < n; j++) {
      const step = clamp(A[j]![n] ?? 0, -C.step_limit, C.step_limit);
      const before = w[vars[j]!];
      w[vars[j]!] = clamp(before + step, -LIMIT, LIMIT);
      if (Math.abs(w[vars[j]!] - before) > 1e-6) moved = true;
      if (Math.abs(w[vars[j]!]) >= LIMIT - 1e-9) limiting.add(vars[j]!);
    }
    cur = measureFor(asset, w, height_cm, mode);
    if (!moved) break;
  }
  const r = resid();
  const worst = Math.max(...r.map(Math.abs));
  const status: FitResult['status'] = worst <= C.tolerance_ok_cm ? 'ok' : limiting.size ? 'out_of_range' : worst <= C.tolerance_approx_cm ? 'approximate' : 'out_of_range';
  const residual: Record<string, number> = {};
  names.forEach((t, i) => (residual[t] = Number(r[i]!.toFixed(2))));
  return { weights: w, height_cm, status, iterations: Math.min(it, C.max_iterations), achieved: cur, residual_cm: residual, limiting: [...limiting] };
}
