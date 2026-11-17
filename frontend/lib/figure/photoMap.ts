// Ported verbatim from 3dmodel/imported-body/src/photoMap.ts (stage I-51); keep the two in sync.
/**
 * Stage I-51 — a photographed T-shirt onto the top garment of the dressed figure.
 *
 * The figure's shells have no UVs, so the photo itself is the texture: every front-facing triangle of the top
 * garment gets image coordinates, computed from the CANONICAL figure (sliders never change them) and from the
 * same confirmed landmarks and mask edges the template path uses (uvTransfer.ts, D-17):
 *   • torso below the armhole — rows hem → waist → chest → armpit, edges from the mask, columns across the width;
 *   • torso above the armhole — from the armpit line up to the shoulder line and the neckline curve;
 *   • sleeves — from the shoulder/armpit line to the cuff, top seam to underarm, front half only.
 * Sides: the photo is a FRONT view, so image-right is the wearer's LEFT (+X).
 * Back- and side-facing triangles are not in the photo: they take the garment's base colour and are reported
 * as "not reconstructed from the photo" — never mirrored from the front.
 *
 * Pure: no DOM, no three. The client uses this file verbatim (FitCast frontend/lib/figure/photoMap.ts).
 */

export interface P { x: number; y: number }
export type PhotoPointName =
  | 'neck_left' | 'neck_right' | 'neck_bottom' | 'shoulder_left' | 'shoulder_right' | 'armpit_left' | 'armpit_right'
  | 'cuff_left_top' | 'cuff_left_bottom' | 'cuff_right_top' | 'cuff_right_bottom' | 'hem_left' | 'hem_right';

/**
 * Everything the mapping needs from a photo, in image pixels. left/right = IMAGE left/right. `rows` are the side
 * edges at the hem, waist, chest and armpit lines (fractions 0, 0.38, 0.78, 1 of hem → armpit, as rows.ts).
 */
export interface PhotoAnchors {
  width: number;
  height: number;
  points: Record<PhotoPointName, P>;
  rows: { left: P; right: P }[];
}

export const ROW_FRACTIONS = [0, 0.38, 0.78, 1];

const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** quadratic curve that passes through c at t = 0.5 (as uvTransfer.ts) */
function bez(a: P, c: P, b: P, t: number): P {
  const u = 1 - t;
  const cc = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
  return { x: u * u * a.x + 2 * u * t * cc.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cc.y + t * t * b.y };
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** leftmost / rightmost mask pixel on row y, scanning outward from x (same rule as uvTransfer.ts) */
function maskEdges(mask: Uint8Array, width: number, height: number, y: number, cx: number): { left: number; right: number } | null {
  const row = clamp(Math.round(y), 0, height - 1) * width;
  let c = clamp(Math.round(cx), 0, width - 1);
  if (!mask[row + c]) {
    let best = -1;
    for (let d = 1; d < width && best < 0; d++) {
      if (c - d >= 0 && mask[row + c - d]) best = c - d;
      else if (c + d < width && mask[row + c + d]) best = c + d;
    }
    if (best < 0) return null;
    c = best;
  }
  let l = c, r = c;
  while (l > 0 && mask[row + l - 1]) l--;
  while (r < width - 1 && mask[row + r + 1]) r++;
  return { left: l, right: r };
}

/** Photo anchors from confirmed landmarks and the confirmed mask. */
export function anchorsFromLandmarks(points: Record<PhotoPointName, P>, mask: Uint8Array, width: number, height: number): PhotoAnchors {
  const { hem_left: hemL, hem_right: hemR, armpit_left: apL, armpit_right: apR } = points;
  const hemY = (hemL.y + hemR.y) / 2, apY = (apL.y + apR.y) / 2;
  const cx = (hemL.x + hemR.x + apL.x + apR.x) / 4;
  const rows = ROW_FRACTIONS.map((f) => {
    if (f === 0) return { left: hemL, right: hemR };
    if (f === 1) return { left: apL, right: apR };
    const y = hemY + (apY - hemY) * f;
    const fl = lerp(hemL, apL, f), fr = lerp(hemR, apR, f);
    const e = maskEdges(mask, width, height, y, cx);
    if (!e) return { left: { x: fl.x, y }, right: { x: fr.x, y } };
    // a sleeve hanging below the armpit must not pull the side edge out: stay within 12 % of the straight side
    const tol = 0.12 * (hemR.x - hemL.x);
    return {
      left: { x: Math.abs(e.left - fl.x) < tol ? e.left : fl.x, y },
      right: { x: Math.abs(e.right - fr.x) < tol ? e.right : fr.x, y },
    };
  });
  return { width, height, points, rows };
}

/**
 * Plausibility of the photo points before they are used (I-51). The landmark estimator can call a sleeve 'ok'
 * whose cuff point slid down to the hem; mapping such points produces a smeared sleeve. Rules, as fractions of
 * the hem width W (measured on the CC0 fixtures, 13 unflagged sleeves with 'ok' landmarks: opening 0.18–0.33 W,
 * top line 0.12–0.34 W, bottom line 0.12–0.25 W; the flagged ones had openings of 0.44–1.27 W):
 *   • cuff opening ≤ 0.4 W;
 *   • neither sleeve line (shoulder → cuff top, armpit → cuff bottom) longer than twice the other plus 0.1 W.
 * A flagged photo is still mapped, but must be confirmed by the user, like 'uncertain' landmarks.
 */
export function anchorIssues(a: PhotoAnchors): string[] {
  const P = a.points;
  const d = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y);
  const W = d(P.hem_left, P.hem_right);
  const out: string[] = [];
  if (!(W > 0)) return ['ширина подола нулевая'];
  for (const [label, sh, ap, ct, cb] of [
    ['правый на снимке', P.shoulder_right, P.armpit_right, P.cuff_right_top, P.cuff_right_bottom],
    ['левый на снимке', P.shoulder_left, P.armpit_left, P.cuff_left_top, P.cuff_left_bottom],
  ] as const) {
    const open = d(ct, cb) / W, top = d(sh, ct) / W, bot = d(ap, cb) / W;
    if (open > 0.4) out.push(`рукав ${label}: раскрыв манжеты ${open.toFixed(2)} ширины подола`);
    if (bot > 2 * top + 0.1 || top > 2 * bot + 0.1) out.push(`рукав ${label}: линии рукава ${top.toFixed(2)} / ${bot.toFixed(2)} ширины подола`);
  }
  return out;
}

export interface FigureTop {
  /** canonical figure positions (metres, +X wearer's left, +Z front) */
  base: Float32Array;
  index: Uint32Array;
  /** per-vertex part code; `topCode` marks the upper garment, `headCode` the head */
  part: Uint8Array;
  topCode: number;
  headCode: number;
  /** figure landmark: height of the armhole */
  armpit: number;
}

export interface PhotoMapping {
  /** triangle ids (into index/3) of the upper garment that show the photo */
  photoTriangles: number[];
  /** triangle ids of the upper garment that take the base colour (back, sides, not visible in the photo) */
  baseTriangles: number[];
  /** image UV (0..1, v up) per corner of each photo triangle: photoTriangles.length × 3 × 2 */
  uv: Float32Array;
  stats: { frontTriangles: number; baseTriangles: number; sleeveTriangles: number; outOfImage: number };
}

/**
 * Image position of every vertex of the upper garment, then UVs per front-facing triangle. Vertices are mapped
 * once, so neighbouring photo triangles share their corners and the print stays continuous.
 */
export function mapPhotoToTop(fig: FigureTop, photo: PhotoAnchors): PhotoMapping {
  const { base, index, part, topCode } = fig;
  const n = base.length / 3;
  const X = (i: number) => base[i * 3]!, Y = (i: number) => base[i * 3 + 1]!, Z = (i: number) => base[i * 3 + 2]!;
  const top: number[] = [];
  for (let i = 0; i < n; i++) if (part[i] === topCode) top.push(i);
  if (!top.length) throw new Error('figure has no upper garment');
  const hem = Math.min(...top.map(Y));
  const armpit = fig.armpit;
  // torso half-width just below the armhole: beyond it, at arm height, are the sleeves
  let s0 = 0;
  for (const i of top) if (Y(i) > armpit - 0.06 && Y(i) < armpit - 0.015) s0 = Math.max(s0, Math.abs(X(i)));
  if (!(s0 > 0)) throw new Error('cannot measure the torso width under the armhole');
  // neck half-width from the head's neck ring (the collar sits around it)
  let nh = 0;
  const neckLow = Math.min(...[...Array(n).keys()].filter((i) => part[i] === fig.headCode).map(Y));
  for (let i = 0; i < n; i++) if (part[i] === fig.headCode && Y(i) < neckLow + 0.02) nh = Math.max(nh, Math.abs(X(i)));
  if (!(nh > 0)) nh = 0.42 * s0;
  nh = clamp(nh * 1.15, 0.2 * s0, 0.8 * s0);

  /**
   * Profiles are sampled on a 1 cm grid and smoothed: on a low-poly shell a raw "widest vertex within ±1.5 cm"
   * steps between rows, and neighbouring vertices near the side seam then swap order in the photo (folds).
   */
  const profile = (from: number, to: number, f: (q: number) => number) => {
    const qs: number[] = [], vs: number[] = [];
    for (let q = from; q <= to + 1e-9; q += 0.01) { qs.push(q); vs.push(f(q)); }
    const sm = vs.map((_, k) => (vs[Math.max(0, k - 1)]! + vs[k]! * 2 + vs[Math.min(vs.length - 1, k + 1)]!) / 4);
    return (q: number) => {
      if (q <= qs[0]!) return sm[0]!;
      if (q >= qs[qs.length - 1]!) return sm[sm.length - 1]!;
      const k = Math.min(sm.length - 2, Math.floor((q - from) / 0.01));
      const t = (q - qs[k]!) / 0.01;
      return sm[k]! + (sm[k + 1]! - sm[k]!) * t;
    };
  };
  const halfAt = profile(hem, armpit, (y) => {
    let w = 0;
    for (const i of top) if (Math.abs(Y(i) - y) < 0.02 && Math.abs(X(i)) <= s0 * 1.05) w = Math.max(w, Math.abs(X(i)));
    return Math.max(w, 0.6 * s0);
  });
  const yTopAt = profile(-s0, s0, (x) => {
    let m = armpit + 0.01;
    for (const i of top) if (Math.abs(X(i) - x) < 0.02 && Y(i) > armpit && Math.abs(X(i)) <= s0) m = Math.max(m, Y(i));
    return m;
  });
  /** middle of the shell's depth at this height (torso) — what lies behind it is the back or an inner wall */
  const depthAt = (y: number) => {
    let z0 = Infinity, z1 = -Infinity;
    for (const i of top) if (Math.abs(Y(i) - y) < 0.02 && Math.abs(X(i)) <= s0) { z0 = Math.min(z0, Z(i)); z1 = Math.max(z1, Z(i)); }
    return Number.isFinite(z0) ? [z0, z1] : [0, 0];
  };
  const zMidTorso = profile(hem, Math.max(...top.map(Y)), (y) => { const [a0, a1] = depthAt(y); return (a0! + a1!) / 2; });
  const zHalfTorso = profile(hem, Math.max(...top.map(Y)), (y) => { const [a0, a1] = depthAt(y); return (a1! - a0!) / 2; });
  const ends = { [1]: 0, [-1]: 0 } as Record<number, number>;
  for (const i of top) { const sd = Math.sign(X(i)) || 1; if (Y(i) > armpit - 0.03) ends[sd] = Math.max(ends[sd]!, Math.abs(X(i))); }

  const pt = photo.points;
  const rowAt = (v: number) => {
    const f = ROW_FRACTIONS;
    let k = 1;
    while (k < f.length - 1 && v > f[k]!) k++;
    const t = clamp((v - f[k - 1]!) / (f[k]! - f[k - 1]!), 0, 1);
    const a = photo.rows[k - 1]!, b = photo.rows[k]!;
    return { left: lerp(a.left, b.left, t), right: lerp(a.right, b.right, t) };
  };
  // neckline share of the shoulder line, measured on the figure so its collar lands on the photo's collar
  const a = clamp((s0 - nh) / (2 * s0), 0.1, 0.45);
  const topCurve = (t: number): P => {
    if (t <= a) return lerp(pt.shoulder_left, pt.neck_left, t / a);
    if (t >= 1 - a) return lerp(pt.neck_right, pt.shoulder_right, (t - (1 - a)) / a);
    return bez(pt.neck_left, pt.neck_bottom, pt.neck_right, (t - a) / (1 - 2 * a));
  };

  /** top seam and underarm of each sleeve along its length, smoothed like the torso profiles */
  const sleeveProfiles = new Map<number, { top: (q: number) => number; bottom: (q: number) => number }>();
  const sleeveProfile = (side: number) => {
    let pr = sleeveProfiles.get(side);
    if (pr) return pr;
    const on = top.filter((j) => Math.sign(X(j)) === side && Y(j) > armpit - 0.03);
    const at = (q: number) => on.filter((j) => Math.abs(Math.abs(X(j)) - q) < 0.02);
    pr = {
      top: profile(s0, ends[side]!, (q) => { const l = at(q); return l.length ? Math.max(...l.map(Y)) : armpit + 0.08; }),
      bottom: profile(s0, ends[side]!, (q) => { const l = at(q); return l.length ? Math.min(...l.map(Y)) : armpit; }),
    };
    sleeveProfiles.set(side, pr);
    return pr;
  };
  const img = new Float32Array(n * 2).fill(NaN);
  const isSleeve = new Uint8Array(n);
  for (const i of top) {
    const x = X(i), y = Y(i), ax = Math.abs(x);
    let p: P;
    if (ax > s0 && y > armpit - 0.03) {
      isSleeve[i] = 1;
      const side = x > 0 ? 1 : -1; // +X = wearer left = IMAGE RIGHT
      const sh = side > 0 ? pt.shoulder_right : pt.shoulder_left;
      const ap = side > 0 ? pt.armpit_right : pt.armpit_left;
      const ct = side > 0 ? pt.cuff_right_top : pt.cuff_left_top;
      const cb = side > 0 ? pt.cuff_right_bottom : pt.cuff_left_bottom;
      const s = clamp((ax - s0) / (ends[side]! - s0 || 1), 0, 1);
      const prof = sleeveProfile(side);
      const yT = prof.top(ax), yB = prof.bottom(ax);
      const tv = clamp((yT - y) / (yT - yB || 1), 0, 1);
      p = lerp(lerp(sh, ct, s), lerp(ap, cb, s), tv);
    } else if (y < armpit) {
      const v = clamp((y - hem) / (armpit - hem), 0, 1);
      const r = rowAt(v);
      p = lerp(r.left, r.right, clamp((x / halfAt(y) + 1) / 2, 0, 1));
    } else {
      const t = clamp((x / s0 + 1) / 2, 0, 1);
      const v2 = clamp((y - armpit) / (yTopAt(x) - armpit), 0, 1);
      p = lerp(lerp(photo.rows[3]!.left, photo.rows[3]!.right, t), topCurve(t), v2);
    }
    img[i * 2] = p.x;
    img[i * 2 + 1] = p.y;
  }

  const photoTriangles: number[] = [], baseTriangles: number[] = [];
  const uv: number[] = [];
  let sleeveTriangles = 0, outOfImage = 0;
  for (let t = 0; t < index.length / 3; t++) {
    const v = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
    if (!v.every((k) => part[k] === topCode)) continue;
    // face normal in the canonical figure: the photo is a front view, so only front-facing faces show it
    const ux = X(v[1]!) - X(v[0]!), uy = Y(v[1]!) - Y(v[0]!), uz = Z(v[1]!) - Z(v[0]!);
    const wx = X(v[2]!) - X(v[0]!), wy = Y(v[2]!) - Y(v[0]!), wz = Z(v[2]!) - Z(v[0]!);
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    // only faces that look forward AND lie in front of the shell's middle: the inside of the back collar seen
    // through the neckline faces forward too, but it is the back of the garment
    const cx3 = (X(v[0]!) + X(v[1]!) + X(v[2]!)) / 3, cy3 = (Y(v[0]!) + Y(v[1]!) + Y(v[2]!)) / 3, cz3 = (Z(v[0]!) + Z(v[1]!) + Z(v[2]!)) / 3;
    const sleeve = v.some((k) => isSleeve[k]);
    let zMid: number, zHalf: number;
    if (sleeve) {
      const side = cx3 > 0 ? 1 : -1;
      let z0 = Infinity, z1 = -Infinity;
      for (const j of top) if (Math.sign(X(j)) === side && Math.abs(Math.abs(X(j)) - Math.abs(cx3)) < 0.02 && Y(j) > armpit - 0.03) { z0 = Math.min(z0, Z(j)); z1 = Math.max(z1, Z(j)); }
      zMid = (z0 + z1) / 2; zHalf = (z1 - z0) / 2;
    } else { zMid = zMidTorso(cy3); zHalf = zHalfTorso(cy3); }
    /**
     * Every corner must be on the front: a triangle with one corner on the side seam maps that corner to the
     * photo's edge and the others inside, and where the figure's side slopes differently from the photographed
     * shirt's it flips (I-51). The side strip takes the base colour — on the photo it is the shaded edge anyway.
     */
    const front = (k: number) => Z(k) - zMid >= 0.25 * zHalf;
    void cz3;
    if (nz / len < 0.2 || !v.every(front)) { baseTriangles.push(t); continue; }
    photoTriangles.push(t);
    if (sleeve) sleeveTriangles++;
    for (const k of v) {
      const px = img[k * 2]!, py = img[k * 2 + 1]!;
      if (px < 0 || py < 0 || px > photo.width || py > photo.height) outOfImage++;
      uv.push(clamp(px / photo.width, 0, 1), 1 - clamp(py / photo.height, 0, 1));
    }
  }
  return {
    photoTriangles, baseTriangles, uv: Float32Array.from(uv),
    stats: { frontTriangles: photoTriangles.length, baseTriangles: baseTriangles.length, sleeveTriangles, outOfImage },
  };
}
