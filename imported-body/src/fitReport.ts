/**
 * Stage I-14 — the fit report: what a fitter would say about the garment on this body.
 *
 * Two things, both measured on the settled meshes, not on the parameters:
 *  • EASE per zone — the garment's own girth at a height minus the body's girth there, in centimetres. This is
 *    the number a pattern maker uses; for a jersey tee the chest ease is normally 8–14 cm.
 *  • CLEARANCE per vertex — the gap between fabric and skin, used to colour the garment so tight and loose
 *    places are visible rather than described.
 */
import { sliceContours } from './geom/measure';
import type { BodyColliders } from './collider';

export interface ZoneEase {
  zone: string;
  y: number;
  body_cm: number;
  garment_cm: number;
  ease_cm: number;
  verdict: 'tight' | 'close' | 'regular' | 'loose';
}

/**
 * Girth of the piece that sits on the body axis (or on one side, for a sleeve). Taking the largest contour was
 * wrong on a garment: just under the armhole the slice cuts the sleeve and the body of the shirt as one loop,
 * and the chest read 149 cm against a 106 cm body.
 */
function girth(p: Float32Array, idx: Uint32Array, y: number, side: -1 | 0 | 1 = 0): number {
  try {
    const cs = sliceContours(p, idx, y);
    if (!cs.length) return NaN;
    const cx = (c: (typeof cs)[number]) => c.points.reduce((s, q) => s + q[0], 0) / c.points.length;
    const pick = side === 0 ? cs.filter((c) => Math.abs(cx(c)) < 0.09) : cs.filter((c) => Math.sign(cx(c)) === side && Math.abs(cx(c)) > 0.12);
    if (!pick.length) return NaN;
    return Math.max(...pick.map((c) => c.perimeter));
  } catch {
    return NaN;
  }
}

export function zoneEase(bodyPos: Float32Array, bodyIdx: Uint32Array, gPos: Float32Array, gIdx: Uint32Array, zones: { zone: string; y: number; side?: -1 | 0 | 1 }[]): ZoneEase[] {
  return zones.map(({ zone, y, side }) => {
    const b = girth(bodyPos, bodyIdx, y, side ?? 0) * 100;
    const g = girth(gPos, gIdx, y, side ?? 0) * 100;
    const ease = g - b;
    const verdict: ZoneEase['verdict'] = !Number.isFinite(ease) ? 'regular' : ease < 2 ? 'tight' : ease < 8 ? 'close' : ease < 16 ? 'regular' : 'loose';
    return { zone, y: Number(y.toFixed(3)), body_cm: Number(b.toFixed(1)), garment_cm: Number(g.toFixed(1)), ease_cm: Number(ease.toFixed(1)), verdict };
  });
}

/** signed gap from a point to the collider surface, in metres (negative = inside) */
export function clearance(c: BodyColliders, x: number, y: number, z: number): number {
  let best = Infinity;
  if (y >= c.yMin && y <= c.yMax && c.torso.length > 1) {
    const t = ((y - c.yMin) / (c.yMax - c.yMin)) * (c.torso.length - 1);
    const i0 = Math.max(0, Math.min(c.torso.length - 2, Math.floor(t)));
    const f = t - i0;
    const r0 = c.torso[i0]!, r1 = c.torso[i0 + 1]!;
    const cx = r0.cx + (r1.cx - r0.cx) * f, cz = r0.cz + (r1.cz - r0.cz) * f;
    const dx = x - cx, dz = z - cz;
    const dl = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    const NA = r0.r.length;
    const at = (ring: typeof r0) => {
      const u = ((ang / (2 * Math.PI)) * NA + NA) % NA;
      const k0 = Math.floor(u) % NA, k1 = (k0 + 1) % NA, ff = u - Math.floor(u);
      return ring.r[k0]! + (ring.r[k1]! - ring.r[k0]!) * ff;
    };
    best = Math.min(best, dl - (at(r0) + (at(r1) - at(r0)) * f));
  }
  for (const cap of c.capsules) {
    const bx = cap.b[0] - cap.a[0], by = cap.b[1] - cap.a[1], bz = cap.b[2] - cap.a[2];
    const len2 = bx * bx + by * by + bz * bz || 1e-9;
    let u = ((x - cap.a[0]) * bx + (y - cap.a[1]) * by + (z - cap.a[2]) * bz) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const d = Math.hypot(x - (cap.a[0] + bx * u), y - (cap.a[1] + by * u), z - (cap.a[2] + bz * u));
    best = Math.min(best, d - cap.r);
  }
  return best;
}

/** per-vertex clearance in millimetres, for the fit map */
export function clearanceMap(c: BodyColliders, g: Float32Array): Float32Array {
  const out = new Float32Array(g.length / 3);
  for (let i = 0; i < out.length; i++) out[i] = clearance(c, g[i * 3]!, g[i * 3 + 1]!, g[i * 3 + 2]!) * 1000;
  return out;
}
