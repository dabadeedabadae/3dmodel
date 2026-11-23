// Ported from 3dmodel/imported-body/src/proportions.ts (I-68) — keep in sync.
/**
 * I-68 — linked body proportions from real measurements (ANSUR II, men, n=4082; see proportions.data.ts and
 * reports/stage-I68-proportions.md).
 *
 * All variables are logs of the ratio to the typical man; the base figure is taken as that typical man (175 cm, all
 * sliders at zero). The model is a multivariate normal, and every slider value is a conditional mean:
 *   • height (cm) is always given;
 *   • weight is "fuller or slimmer than usual for this height" — a residual z, so a taller figure also gets heavier;
 *   • each girth is "bigger or smaller than usual for this height and weight" — a residual z. A girth the user has
 *     moved is pinned; the others follow the residual correlations: at the same weight a bigger chest comes with a
 *     slightly bigger waist and shoulders and slightly slimmer hips and thighs, as in the data.
 * The output is in deform() weight units and is NOT clamped: the caller clamps to the figure's measured range.
 * Nothing here is in centimetres of the figure: the figure is not calibrated, only the ratios come from the data.
 */
import { GAIN, type Weights } from './deform';
import { PROPORTIONS } from './proportions.data';

export const GIRTHS = ['chest', 'waist', 'hip', 'shoulders', 'arms', 'thighs'] as const;
export type Girth = (typeof GIRTHS)[number];
export const BASE_HEIGHT_CM = 175;

export interface ShapeState {
  heightCm: number;
  /** fuller (+) or slimmer (−) than usual for the height, in standard deviations */
  weightZ: number;
  /** girths the user set: deviation from usual for this height and weight, in standard deviations */
  pins: Partial<Record<Girth, number>>;
}

export interface Shape {
  weights: Weights;
  /** weight relative to the base figure, e.g. 0.12 = 12 % heavier */
  weightRatio: number;
  /** every girth's deviation from usual for this height and weight, in standard deviations */
  z: Record<Girth, number>;
}

const names = PROPORTIONS.names as readonly string[];
const C = PROPORTIONS.cov.map((r) => [...r]);
const at = (n: string) => names.indexOf(n);
const S = at('stature'), W = at('weight');
const G = GIRTHS.map(at);

function inverse(M: number[][]): number[][] {
  const k = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    const d = A[i]![i]!;
    for (let j = 0; j < 2 * k; j++) A[i]![j]! /= d;
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r]![i]!; for (let j = 0; j < 2 * k; j++) A[r]![j]! -= f * A[i]![j]!; }
  }
  return A.map((r) => r.slice(k));
}

// weight given stature
const bWS = C[S]![W]! / C[S]![S]!;
const sdWgivenS = Math.sqrt(C[W]![W]! - C[S]![W]! ** 2 / C[S]![S]!);
// girths given stature and weight: x_g = B·[s, w] + e, e ~ N(0, R)
const cond = [S, W];
const Ccc = inverse(cond.map((a) => cond.map((b) => C[a]![b]!)));
const B = G.map((g) => cond.map((_, j) => cond.reduce((s, c, i) => s + C[g]![c]! * Ccc[i]![j]!, 0)));
const R = G.map((a, ia) => G.map((b) => C[a]![b]! - cond.reduce((s, c, i) => s + B[ia]![i]! * C[c]![b]!, 0)));
const sdR = R.map((r, i) => Math.sqrt(r[i]!));

/** typical log-girths for this stature and log-weight */
const typical = (s: number, w: number) => B.map((b) => b[0]! * s + b[1]! * w);
const logWeight = (st: ShapeState, s: number) => bWS * s + st.weightZ * sdWgivenS;

export function solveShape(st: ShapeState): Shape {
  const s = Math.log(st.heightCm / BASE_HEIGHT_CM);
  const w = logWeight(st, s);
  const pinned = GIRTHS.map((g, i) => (st.pins[g] !== undefined ? i : -1)).filter((i) => i >= 0);
  const e = GIRTHS.map((g, i) => (st.pins[g] !== undefined ? st.pins[g]! * sdR[i]! : 0));
  if (pinned.length) {
    const Rpp = inverse(pinned.map((a) => pinned.map((b) => R[a]![b]!)));
    const coef = pinned.map((_, j) => pinned.reduce((acc, p, i) => acc + Rpp[j]![i]! * e[p]!, 0));
    GIRTHS.forEach((g, u) => {
      if (st.pins[g] !== undefined) return;
      e[u] = pinned.reduce((acc, p, j) => acc + R[u]![p]! * coef[j]!, 0);
    });
  }
  const t = typical(s, w);
  const weights = {} as Weights;
  const z = {} as Record<Girth, number>;
  GIRTHS.forEach((g, i) => {
    weights[g] = (Math.exp(t[i]! + e[i]!) - 1) / GAIN[g];
    z[g] = e[i]! / sdR[i]!;
  });
  return { weights, weightRatio: Math.exp(w) - 1, z };
}

/** the residual z that puts girth `g` at slider value `v` (deform weight units) for this height and weight */
export function pinFromSlider(st: ShapeState, g: Girth, v: number): number {
  const s = Math.log(st.heightCm / BASE_HEIGHT_CM);
  const i = GIRTHS.indexOf(g);
  const x = Math.log(Math.max(1e-3, 1 + GAIN[g] * v));
  return (x - typical(s, logWeight(st, s))[i]!) / sdR[i]!;
}

/** plain words for a deviation in standard deviations; "usual" means usual for this height and weight */
export function describeZ(z: number): string {
  const a = Math.abs(z);
  if (a < 0.5) return 'typical';
  const dir = z > 0 ? 'larger' : 'smaller';
  if (a < 1.5) return `slightly ${dir} than typical`;
  if (a < 2.5) return `${dir} than typical`;
  return `much ${dir} than typical`;
}

/** body types in the same units: weight z and pinned girth z; everything not listed follows the data */
export const BODY_TYPES: { id: string; label: string; weightZ: number; pins: Partial<Record<Girth, number>> }[] = [
  { id: 'base', label: 'Average', weightZ: 0, pins: {} },
  { id: 'slim', label: 'Slim', weightZ: -1.3, pins: {} },
  { id: 'full', label: 'Heavy', weightZ: 1.5, pins: {} },
  { id: 'athletic', label: 'Athletic', weightZ: 0.6, pins: { shoulders: 1.5, chest: 1.2, waist: -1.2 } },
  { id: 'chest', label: 'Larger chest', weightZ: 0, pins: { chest: 2 } },
  { id: 'belly', label: 'Belly', weightZ: 0.8, pins: { waist: 1.6 } },
  { id: 'pear', label: 'Wide hips', weightZ: 0, pins: { hip: 2, shoulders: -1 } },
];
