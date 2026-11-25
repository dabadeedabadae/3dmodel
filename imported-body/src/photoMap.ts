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
  if (!(W > 0)) return ['hem width is zero'];
  for (const [label, sh, ap, ct, cb] of [
    ['right in the photo', P.shoulder_right, P.armpit_right, P.cuff_right_top, P.cuff_right_bottom],
    ['left in the photo', P.shoulder_left, P.armpit_left, P.cuff_left_top, P.cuff_left_bottom],
  ] as const) {
    const open = d(ct, cb) / W, top = d(sh, ct) / W, bot = d(ap, cb) / W;
    if (open > 0.4) out.push(`sleeve ${label}: cuff opening is ${open.toFixed(2)} of hem width`);
    if (bot > 2 * top + 0.1 || top > 2 * bot + 0.1) out.push(`sleeve ${label}: sleeve edges are ${top.toFixed(2)} / ${bot.toFixed(2)} of hem width`);
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
/**
 * Torso half-width just below the armhole: beyond it, at arm height, are the sleeves. Shared by the mapping and
 * its check (scripts/photo-garment.ts) so both split torso and sleeve at the same place.
 */
export function torsoHalfWidth(fig: FigureTop): number {
  const { base, index, part, topCode } = fig;
  const n = base.length / 3;
  const X = (i: number) => base[i * 3]!, Y = (i: number) => base[i * 3 + 1]!;
  const armpit = fig.armpit;
  const top: number[] = [];
  for (let i = 0; i < n; i++) if (part[i] === topCode) top.push(i);
  let s0 = 0;
  for (const i of top) if (Y(i) > armpit - 0.06 && Y(i) < armpit - 0.015) s0 = Math.max(s0, Math.abs(X(i)));
  /**
   * On a coarse shell (women's base, I-75) few vertices fall into that band and the torso came out too narrow
   * (0.14 m against ~0.2): shoulder and side vertices were mapped as sleeve and the sleeve ran the wrong way.
   * The section of the top's triangles at the same heights is measured as well; s0 only grows, so a figure whose
   * vertices already gave the width keeps it.
   */
  for (const yc of [armpit - 0.05, armpit - 0.035, armpit - 0.02]) {
    for (let t = 0; t < index.length; t += 3) {
      const v = [index[t]!, index[t + 1]!, index[t + 2]!];
      if (!v.every((k) => part[k] === topCode)) continue;
      for (let e = 0; e < 3; e++) {
        const p = v[e]!, q = v[(e + 1) % 3]!;
        if ((Y(p) - yc) * (Y(q) - yc) > 0 || Y(p) === Y(q)) continue;
        const x = X(p) + ((yc - Y(p)) / (Y(q) - Y(p))) * (X(q) - X(p));
        s0 = Math.max(s0, Math.abs(x));
      }
    }
  }
  return s0;
}

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
  const s0 = torsoHalfWidth(fig);
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

/* ======================================================================================================
 * Trousers and jeans (I-53). Same idea as the T-shirt: front-view flat-lay photo, landmarks from the mask,
 * the photo is the texture of the front faces of the figure's lower garment, the rest in the base colour.
 * All mask-derived edges are sampled into the anchors, so neither the client nor the server needs the mask.
 * ====================================================================================================== */

export type PantsPointName =
  | 'waist_left' | 'waist_right' | 'crotch' | 'hip_left' | 'hip_right'
  | 'hem_left_outer' | 'hem_left_inner' | 'hem_right_inner' | 'hem_right_outer';

/** left/right = IMAGE left/right; the image-right leg is the wearer's LEFT leg (+X) */
export interface PantsAnchors {
  width: number;
  height: number;
  points: Record<PantsPointName, P>;
  /** seat: side edges from the crotch line (k = 0) up to the waist (k = last) */
  seat: { left: P; right: P }[];
  /** legs: edges from the crotch line (k = 0) down to the hem (k = last); inner = towards the other leg */
  legLeft: { outer: P; inner: P }[];
  legRight: { inner: P; outer: P }[];
}

export const PANTS_SEAT_ROWS = 5;
export const PANTS_LEG_ROWS = 9;

/** runs of mask pixels on row y: [x0, x1] inclusive */
function runs(mask: Uint8Array, width: number, height: number, y: number): [number, number][] {
  const row = clamp(Math.round(y), 0, height - 1) * width;
  const out: [number, number][] = [];
  let x = 0;
  while (x < width) {
    while (x < width && !mask[row + x]) x++;
    if (x >= width) break;
    const s = x;
    while (x < width && mask[row + x]) x++;
    if (x - s >= 3) out.push([s, x - 1]);
  }
  return out;
}

export interface PantsLandmarks { points: Record<PantsPointName, P>; status: 'ok' | 'uncertain'; anchors: PantsAnchors | null; reasons: string[] }

/**
 * Landmarks of front-view trousers from the confirmed mask. Crotch: walking up from the hem, the last row where
 * the mask still splits into two legs around the middle. Waist: a row just below the top (hanger clips and
 * belt loops make the very top ragged). Hems: the outer and inner edge of each leg near the bottom.
 */
export function estimatePantsLandmarks(mask: Uint8Array, width: number, height: number): PantsLandmarks {
  let y0 = -1, y1 = -1, x0 = width, x1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
    if (y0 < 0) y0 = y; y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x;
  }
  const reasons: string[] = [];
  const empty = (): PantsLandmarks => ({ points: {} as Record<PantsPointName, P>, status: 'uncertain', anchors: null, reasons });
  if (y0 < 0) { reasons.push('mask is empty'); return empty(); }
  const H = y1 - y0, cx = (x0 + x1) / 2, W = x1 - x0;
  // two legs: two runs whose gap lies in the middle 40 % of the garment's width, each a real leg (≥ 8 % of it)
  const legsAt = (y: number) => {
    const r = runs(mask, width, height, y);
    if (r.length < 2) return null;
    let best: { l: [number, number]; r: [number, number] } | null = null;
    for (let k = 0; k + 1 < r.length; k++) {
      const gap = (r[k]![1] + r[k + 1]![0]) / 2;
      const l: [number, number] = [r[0]![0], r[k]![1]], rr: [number, number] = [r[k + 1]![0], r[r.length - 1]![1]];
      if (Math.abs(gap - cx) < 0.2 * W && l[1] - l[0] >= 0.08 * W && rr[1] - rr[0] >= 0.08 * W) best = { l, r: rr };
    }
    return best;
  };
  /**
   * The legs are the longest run of rows where the mask splits into two real legs. Its top is the crotch; its
   * bottom, a little inside, is the hem line where BOTH legs are still whole — one leg often ends lower than the
   * other on a flat-lay, and the ragged last rows of a mask are a few pixels wide.
   */
  let bestTop = -1, bestBot = -1, runTop = -1;
  for (let y = y0; y <= y1 + 1; y++) {
    const ok = y <= y1 && !!legsAt(y);
    if (ok && runTop < 0) runTop = y;
    if (!ok && runTop >= 0) { if (y - 1 - runTop > bestBot - bestTop) { bestTop = runTop; bestBot = y - 1; } runTop = -1; }
  }
  if (bestTop < 0 || bestBot - bestTop < 0.1 * H) { reasons.push('legs are not separated in the photo'); return empty(); }
  const crotchY = bestTop;
  const hemY = bestBot - 0.01 * H;
  const hem = legsAt(hemY) ?? legsAt(bestBot)!;
  const gapRow = legsAt(crotchY)!;
  const crotch = { x: (gapRow.l[1] + gapRow.r[0]) / 2, y: crotchY };
  const waistY = y0 + 0.04 * H;
  const wr = runs(mask, width, height, waistY);
  const waistL = wr.length ? wr[0]![0] : x0, waistR = wr.length ? wr[wr.length - 1]![1] : x1;
  const hipRow = runs(mask, width, height, crotchY - 2);
  const hipL = hipRow.length ? hipRow[0]![0] : gapRow.l[0], hipR = hipRow.length ? hipRow[hipRow.length - 1]![1] : gapRow.r[1];
  const points: Record<PantsPointName, P> = {
    waist_left: { x: waistL, y: waistY }, waist_right: { x: waistR, y: waistY }, crotch,
    hip_left: { x: hipL, y: crotchY }, hip_right: { x: hipR, y: crotchY },
    hem_left_outer: { x: hem.l[0], y: hemY }, hem_left_inner: { x: hem.l[1], y: hemY },
    hem_right_inner: { x: hem.r[0], y: hemY }, hem_right_outer: { x: hem.r[1], y: hemY },
  };
  // edges sampled from the mask, so the mapping never needs the mask again
  const seat = [...Array(PANTS_SEAT_ROWS).keys()].map((k) => {
    const f = k / (PANTS_SEAT_ROWS - 1);
    const y = crotchY + (waistY - crotchY) * f;
    const r = runs(mask, width, height, y);
    const fl = lerp(points.hip_left, points.waist_left, f), fr = lerp(points.hip_right, points.waist_right, f);
    return r.length ? { left: { x: r[0]![0], y }, right: { x: r[r.length - 1]![1], y } } : { left: fl, right: fr };
  });
  const legLeft: { outer: P; inner: P }[] = [], legRight: { inner: P; outer: P }[] = [];
  for (let k = 0; k < PANTS_LEG_ROWS; k++) {
    const f = k / (PANTS_LEG_ROWS - 1);
    const y = crotchY + (hemY - crotchY) * f;
    const g = k === 0 ? gapRow : legsAt(y);
    const fallbackL = { outer: lerp(points.hip_left, points.hem_left_outer, f), inner: lerp(crotch, points.hem_left_inner, f) };
    const fallbackR = { inner: lerp(crotch, points.hem_right_inner, f), outer: lerp(points.hip_right, points.hem_right_outer, f) };
    if (!g) { legLeft.push(fallbackL); legRight.push(fallbackR); continue; }
    legLeft.push({ outer: { x: k === 0 ? hipL : g.l[0], y }, inner: { x: k === 0 ? crotch.x : g.l[1], y } });
    legRight.push({ inner: { x: k === 0 ? crotch.x : g.r[0], y }, outer: { x: k === 0 ? hipR : g.r[1], y } });
  }
  const anchors: PantsAnchors = { width, height, points, seat, legLeft, legRight };
  const issues = pantsIssues(anchors);
  reasons.push(...issues);
  return { points, status: issues.length ? 'uncertain' : 'ok', anchors, reasons };
}

/**
 * Plausibility of trouser points (fractions of the length L = waist → hem):
 *   • the rise (waist → crotch) is 0.15–0.5 L — real trousers measure 0.25–0.35; a mask that filled the space
 *     between the legs pushes the crotch down towards the hem;
 *   • each leg at the hem is at least 0.06 of the waist width and the two hems do not overlap.
 */
export function pantsIssues(a: PantsAnchors): string[] {
  const P = a.points;
  const out: string[] = [];
  const waistY = (P.waist_left.y + P.waist_right.y) / 2;
  const hemY = (P.hem_left_outer.y + P.hem_right_outer.y) / 2;
  const L = hemY - waistY, Ww = P.waist_right.x - P.waist_left.x;
  if (!(L > 0) || !(Ww > 0)) return ['waistband and hems not found'];
  const rise = (P.crotch.y - waistY) / L;
  if (rise < 0.15 || rise > 0.5) out.push(`crotch is at ${rise.toFixed(2)} of the length from the waistband (expected 0.15–0.5)`);
  const wl = (P.hem_left_inner.x - P.hem_left_outer.x) / Ww, wrr = (P.hem_right_outer.x - P.hem_right_inner.x) / Ww;
  if (wl < 0.06 || wrr < 0.06) out.push('leg is too narrow at the hem');
  if (P.hem_left_inner.x >= P.hem_right_inner.x) out.push('legs overlap at the hem');
  return out;
}

export interface FigureBottom {
  base: Float32Array;
  index: Uint32Array;
  part: Uint8Array;
  bottomCode: number;
  /** figure landmark: crotch height */
  crotch: number;
}

/** Photo of trousers onto the figure's lower garment (front faces). Same output as mapPhotoToTop. */
export function mapPhotoToBottom(fig: FigureBottom, photo: PantsAnchors): PhotoMapping {
  const { base, index, part, bottomCode } = fig;
  const n = base.length / 3;
  const X = (i: number) => base[i * 3]!, Y = (i: number) => base[i * 3 + 1]!, Z = (i: number) => base[i * 3 + 2]!;
  const bot: number[] = [];
  for (let i = 0; i < n; i++) if (part[i] === bottomCode) bot.push(i);
  if (!bot.length) throw new Error('figure has no lower garment');
  const crotch = fig.crotch;
  const waist = Math.max(...bot.map(Y));
  const hemOf = (side: number) => Math.min(...bot.filter((i) => Math.sign(X(i)) === side).map(Y));
  const hem = { [1]: hemOf(1), [-1]: hemOf(-1) } as Record<number, number>;

  const profile = (from: number, to: number, f: (q: number) => number) => {
    const qs: number[] = [], vs: number[] = [];
    for (let q = from; q <= to + 1e-9; q += 0.01) { qs.push(q); vs.push(f(q)); }
    const sm = vs.map((_, k) => (vs[Math.max(0, k - 1)]! + vs[k]! * 2 + vs[Math.min(vs.length - 1, k + 1)]!) / 4);
    return (q: number) => {
      if (q <= qs[0]!) return sm[0]!;
      if (q >= qs[qs.length - 1]!) return sm[sm.length - 1]!;
      const k = Math.min(sm.length - 2, Math.floor((q - from) / 0.01));
      return sm[k]! + (sm[k + 1]! - sm[k]!) * ((q - qs[k]!) / 0.01);
    };
  };
  /**
   * Cross-sections of the SURFACE, not of nearby vertices: the trousers are a coarse mesh (around the crotch a
   * ±2 cm band holds 14 vertices and none on the side), so "widest vertex near this height" gave a seat 13 cm wide
   * where the surface is 19 cm, and the side faces folded. Every edge of the lower garment crossing the height
   * contributes its exact intersection point.
   */
  const botTris: number[] = [];
  for (let t = 0; t < index.length / 3; t++) if (part[index[t * 3]!] === bottomCode && part[index[t * 3 + 1]!] === bottomCode && part[index[t * 3 + 2]!] === bottomCode) botTris.push(t);
  const section = (y: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (const t of botTris) for (let e = 0; e < 3; e++) {
      const a = index[t * 3 + e]!, b = index[t * 3 + ((e + 1) % 3)]!;
      const ya = Y(a), yb = Y(b);
      if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
      const f = (y - ya) / (yb - ya);
      pts.push([X(a) + (X(b) - X(a)) * f, Z(a) + (Z(b) - Z(a)) * f]);
    }
    return pts;
  };
  const seatHalf = profile(crotch, waist, (y) => {
    let w = 0;
    for (const [x] of section(y)) w = Math.max(w, Math.abs(x));
    return w || 0.1;
  });
  const legProfiles = new Map<number, { inner: (y: number) => number; outer: (y: number) => number; zMid: (y: number) => number; zHalf: (y: number) => number }>();
  const legProfile = (side: number) => {
    let pr = legProfiles.get(side);
    if (pr) return pr;
    const at = (y: number) => section(y).filter(([x]) => Math.sign(x) === side);
    const lo = hem[side]!, hi = crotch;
    pr = {
      inner: profile(lo, hi, (y) => { const l = at(y); return l.length ? Math.min(...l.map(([x]) => Math.abs(x))) : 0; }),
      outer: profile(lo, hi, (y) => { const l = at(y); return l.length ? Math.max(...l.map(([x]) => Math.abs(x))) : 0.1; }),
      zMid: profile(lo, hi, (y) => { const l = at(y); return l.length ? (Math.min(...l.map(([, z]) => z)) + Math.max(...l.map(([, z]) => z))) / 2 : 0; }),
      zHalf: profile(lo, hi, (y) => { const l = at(y); return l.length ? (Math.max(...l.map(([, z]) => z)) - Math.min(...l.map(([, z]) => z))) / 2 : 0.05; }),
    };
    legProfiles.set(side, pr);
    return pr;
  };
  const seatDepth = (y: number) => {
    const sec = section(y);
    if (!sec.length) return [0, 0];
    return [Math.min(...sec.map(([, z]) => z)), Math.max(...sec.map(([, z]) => z))];
  };
  const seatZMid = profile(crotch, waist, (y) => { const [a, b] = seatDepth(y); return (a! + b!) / 2; });
  const seatZHalf = profile(crotch, waist, (y) => { const [a, b] = seatDepth(y); return (b! - a!) / 2; });

  const rowsAt = <T>(rows: T[], f: number, mix: (a: T, b: T, t: number) => T): T => {
    const k = clamp(f, 0, 1) * (rows.length - 1);
    const k0 = Math.min(rows.length - 2, Math.floor(k));
    return mix(rows[k0]!, rows[k0 + 1]!, k - k0);
  };
  const mixLR = (a: { left: P; right: P }, b: { left: P; right: P }, t: number) => ({ left: lerp(a.left, b.left, t), right: lerp(a.right, b.right, t) });
  const mixIO = (a: { inner: P; outer: P }, b: { inner: P; outer: P }, t: number) => ({ inner: lerp(a.inner, b.inner, t), outer: lerp(a.outer, b.outer, t) });

  const img = new Float32Array(n * 2).fill(NaN);
  const isLeg = new Uint8Array(n);
  for (const i of bot) {
    const x = X(i), y = Y(i);
    let p: P;
    if (y >= crotch) {
      const r = rowsAt(photo.seat, (y - crotch) / (waist - crotch), mixLR);
      p = lerp(r.left, r.right, clamp((x / seatHalf(y) + 1) / 2, 0, 1));
    } else {
      isLeg[i] = 1;
      const side = x >= 0 ? 1 : -1; // +X = wearer left = IMAGE RIGHT leg
      const pr = legProfile(side);
      const f = (crotch - y) / (crotch - hem[side]!);
      const t = clamp((Math.abs(x) - pr.inner(y)) / (pr.outer(y) - pr.inner(y) || 1), 0, 1);
      const r = side > 0 ? rowsAt(photo.legRight, f, mixIO) : rowsAt(photo.legLeft, f, mixIO);
      p = lerp(r.inner, r.outer, t);
      // just under the crotch the leg mapping fades into the seat mapping of the crotch line, so the two schemes
      // meet without a seam (they disagree by a few pixels there and thin faces across the line flipped)
      const band = 0.04;
      if (crotch - y < band) {
        const s0row = photo.seat[0]!;
        const seatP = lerp(s0row.left, s0row.right, clamp((x / seatHalf(crotch) + 1) / 2, 0, 1));
        p = lerp(seatP, p, (crotch - y) / band);
      }
    }
    img[i * 2] = p.x;
    img[i * 2 + 1] = p.y;
  }

  const photoTriangles: number[] = [], baseTriangles: number[] = [];
  const uv: number[] = [];
  let legTriangles = 0, outOfImage = 0;
  for (let t = 0; t < index.length / 3; t++) {
    const v = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
    if (!v.every((k) => part[k] === bottomCode)) continue;
    const ux = X(v[1]!) - X(v[0]!), uy = Y(v[1]!) - Y(v[0]!), uz = Z(v[1]!) - Z(v[0]!);
    const wx = X(v[2]!) - X(v[0]!), wy = Y(v[2]!) - Y(v[0]!), wz = Z(v[2]!) - Z(v[0]!);
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    // every corner on the front of its own cross-section (seat or that leg), as for the T-shirt
    const front = (k: number) => {
      if (Y(k) >= crotch) return Z(k) - seatZMid(Y(k)) >= 0.25 * seatZHalf(Y(k));
      const pr = legProfile(X(k) >= 0 ? 1 : -1);
      return Z(k) - pr.zMid(Y(k)) >= 0.25 * pr.zHalf(Y(k));
    };
    // a face spanning both legs (the crotch seam) is not on the photo's front either
    const mixedLegs = v.some((k) => isLeg[k]) && new Set(v.filter((k) => isLeg[k]).map((k) => (X(k) >= 0 ? 1 : -1))).size > 1;
    // legs are tubes: a face turned more than 60° from the camera is their side, the silhouette of a flat-lay
    const minFacing = v.some((k) => isLeg[k]) ? 0.5 : 0.2;
    if (nz / len < minFacing || mixedLegs || !v.every(front)) { baseTriangles.push(t); continue; }
    photoTriangles.push(t);
    if (v.some((k) => isLeg[k])) legTriangles++;
    for (const k of v) {
      const px = img[k * 2]!, py = img[k * 2 + 1]!;
      if (px < 0 || py < 0 || px > photo.width || py > photo.height) outOfImage++;
      uv.push(clamp(px / photo.width, 0, 1), 1 - clamp(py / photo.height, 0, 1));
    }
  }
  return {
    photoTriangles, baseTriangles, uv: Float32Array.from(uv),
    stats: { frontTriangles: photoTriangles.length, baseTriangles: baseTriangles.length, sleeveTriangles: legTriangles, outOfImage },
  };
}
