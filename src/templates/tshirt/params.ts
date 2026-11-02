/**
 * T-shirt template parameters (canonical units = adapter metres, see
 * fitting/AvatarAdapter.ts). Defaults are chosen so the canonical shirt sits
 * sensibly on the TEST chibi mannequin; stage 04 will derive them from the
 * avatar instead of hard-coding.
 *
 * Every parameter is bounded. `clampTShirtParams` never throws: it clamps and
 * reports what it clamped, so a bad estimate can be shown rather than crash.
 */

import { armholeRingElevation } from './rows';

export const TSHIRT_TEMPLATE_ID = 'tshirt-basic';
export const TSHIRT_TEMPLATE_VERSION = '1.2.0'; // 1.1.0: shoulder ring depth = neck depth + 0.03 (D-10); 1.2.0: limits widened to real garment proportions (D-15), canonical defaults and UV unchanged
/** Changes whenever vertex/face layout changes (not when only defaults change). */
export const TSHIRT_TOPOLOGY_VERSION = 'tshirt-basic-topo-1';

export interface TShirtParams {
  /** shoulder line -> hem, along Y */
  length: number;
  /** half width at chest (X) */
  chestHalfWidth: number;
  /** half width at hem (X) */
  hemHalfWidth: number;
  /** half width of the shoulder ring (X) */
  shoulderHalfWidth: number;
  /** Z / X ratio of the torso cross-section (1 = round, lower = flatter) */
  depthRatio: number;
  /** vertical size of the armhole: shoulder line -> underarm */
  armholeDepth: number;
  /** sleeve length from the armhole centre along the sleeve axis */
  sleeveLength: number;
  /** radius of the cuff opening */
  cuffRadius: number;
  /** downward tilt of the sleeve axis, radians (0 = horizontal) */
  sleeveAngle: number;
  /** half width of the neck opening (X) */
  neckHalfWidth: number;
  /** how far the front of the neckline dips below the shoulder line */
  neckFrontDrop: number;
  /** how far the back of the neckline dips */
  neckBackDrop: number;
  /** width of the collar rib band */
  collarWidth: number;
  /** shoulder slope: how much lower the shoulder tip is than the neck side, along Y */
  shoulderSlope: number;
}

export interface ParamLimit {
  min: number;
  max: number;
  default: number;
  label: string;
  step: number;
}

export const TSHIRT_PARAM_LIMITS: Record<keyof TShirtParams, ParamLimit> = {
  length: { min: 0.4, max: 1.6, default: 0.72, label: 'Length (shoulder→hem)', step: 0.01 },
  chestHalfWidth: { min: 0.25, max: 0.7, default: 0.44, label: 'Chest half-width', step: 0.01 },
  hemHalfWidth: { min: 0.25, max: 0.75, default: 0.46, label: 'Hem half-width', step: 0.01 },
  shoulderHalfWidth: { min: 0.25, max: 0.75, default: 0.46, label: 'Shoulder half-width', step: 0.01 },
  depthRatio: { min: 0.55, max: 1.0, default: 0.8, label: 'Depth ratio (Z/X)', step: 0.01 },
  armholeDepth: { min: 0.12, max: 0.7, default: 0.26, label: 'Armhole depth', step: 0.01 },
  sleeveLength: { min: 0.06, max: 0.7, default: 0.22, label: 'Sleeve length', step: 0.01 },
  cuffRadius: { min: 0.05, max: 0.3, default: 0.15, label: 'Cuff radius', step: 0.005 },
  sleeveAngle: { min: 0.0, max: 0.8, default: 0.35, label: 'Sleeve tilt (rad)', step: 0.01 },
  neckHalfWidth: { min: 0.06, max: 0.32, default: 0.17, label: 'Neck half-width', step: 0.005 },
  neckFrontDrop: { min: 0.0, max: 0.4, default: 0.08, label: 'Neck front drop', step: 0.005 },
  neckBackDrop: { min: 0.0, max: 0.08, default: 0.02, label: 'Neck back drop', step: 0.005 },
  collarWidth: { min: 0.01, max: 0.05, default: 0.025, label: 'Collar width', step: 0.001 },
  shoulderSlope: { min: 0.0, max: 0.15, default: 0.06, label: 'Shoulder slope', step: 0.005 },
};

export const TSHIRT_PARAM_NAMES = Object.keys(TSHIRT_PARAM_LIMITS) as (keyof TShirtParams)[];

export function defaultTShirtParams(): TShirtParams {
  const out = {} as TShirtParams;
  for (const k of TSHIRT_PARAM_NAMES) out[k] = TSHIRT_PARAM_LIMITS[k].default;
  return out;
}

export interface ClampReport {
  params: TShirtParams;
  clamped: { name: keyof TShirtParams; requested: number; applied: number }[];
}

/** Clamp partial params into the supported range; missing/NaN values fall back to defaults. */
export function clampTShirtParams(partial: Partial<Record<keyof TShirtParams, number>>): ClampReport {
  const params = defaultTShirtParams();
  const clamped: ClampReport['clamped'] = [];
  for (const k of TSHIRT_PARAM_NAMES) {
    const v = partial[k];
    if (v === undefined || v === null || Number.isNaN(v)) continue;
    const lim = TSHIRT_PARAM_LIMITS[k];
    const applied = Math.min(lim.max, Math.max(lim.min, v));
    if (applied !== v) clamped.push({ name: k, requested: v, applied });
    params[k] = applied;
  }
  // Derived consistency rules (keep the rows ordered and the openings apart):
  const rule = (name: keyof TShirtParams, max: number) => {
    if (params[name] > max) {
      clamped.push({ name, requested: params[name], applied: max });
      params[name] = max;
    }
  };
  // the neck must fit inside the shoulder ring with room for the collar
  rule('neckHalfWidth', params.shoulderHalfWidth - params.collarWidth - 0.08);
  // ...and inside the (flatter) shoulder ring front-to-back: neck depth 0.85*n <= shoulder depth 0.78*depthRatio*chest - 0.04
  rule('neckHalfWidth', (0.78 * params.depthRatio * params.chestHalfWidth - 0.04) / 0.85);
  // the armpit must stay well above the hem
  rule('armholeDepth', params.length * 0.6);
  // the front neckline must stay above the armpit level
  rule('neckFrontDrop', params.armholeDepth * 0.6);
  // the shoulder tip must stay above the mid-armhole row
  rule('shoulderSlope', params.armholeDepth * 0.4);
  // shoulder ring within ±0.1 of the chest ring (keeps the armhole ring near-planar)
  rule('shoulderHalfWidth', params.chestHalfWidth + 0.1);
  // Sleeves must never rise above horizontal. The sleeve axis is the armhole-ring
  // normal tilted down by sleeveAngle; a shoulder narrower than the chest tilts
  // that ring (and the sleeve) upward. The shoulder may be narrower only as far
  // as sleeveAngle compensates. Boxy cut (shoulder == chest) is always allowed.
  // Exact: bisection on shoulderHalfWidth against the builder's own ring normal.
  const rises = (q: TShirtParams) => armholeRingElevation(q) > q.sleeveAngle + 1e-9;
  if (rises(params)) {
    const requested = params.shoulderHalfWidth;
    let lo = params.shoulderHalfWidth; // rises
    let hi = Math.min(params.chestHalfWidth + 0.1, TSHIRT_PARAM_LIMITS.shoulderHalfWidth.max); // must not rise
    if (rises({ ...params, shoulderHalfWidth: hi })) hi = params.chestHalfWidth + 0.1; // widest allowed by the ±0.1 rule
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (rises({ ...params, shoulderHalfWidth: mid })) lo = mid;
      else hi = mid;
    }
    params.shoulderHalfWidth = hi;
    clamped.push({ name: 'shoulderHalfWidth', requested, applied: hi });
  }
  return { params, clamped };
}
