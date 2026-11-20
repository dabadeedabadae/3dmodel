// Ported from 3dmodel/src/shape/landmarks.ts (photo-garments pipeline); keep in sync.
/**
 * Stage 08 — landmarks of a front-view flat-lay T-shirt from the CONFIRMED mask.
 *
 * Pure geometry on the binary mask (no ML): outer contour -> convex hull ->
 * convexity defects. Armpits are the deepest concavities on each side, the
 * neckline is the concavity in the top hull edge, sleeve tips are the extreme
 * hull points, hem corners the lowest hull points.
 *
 * Everything is a SUGGESTION with a status; the user can drag every point.
 * Coordinates are working-photo pixels. Sides are IMAGE sides here
 * ('image_left' = smaller x); the mapping to wearer sides happens in
 * shape/params.ts via domain/sides.ts (front view: image_right = wearer left).
 */
import type { Landmark } from './types';

export interface Pt {
  x: number;
  y: number;
}

export type TShirtLandmarkName =
  | 'neck_left'
  | 'neck_right'
  | 'neck_bottom'
  | 'shoulder_left'
  | 'shoulder_right'
  | 'armpit_left'
  | 'armpit_right'
  | 'cuff_left_top'
  | 'cuff_left_bottom'
  | 'cuff_right_top'
  | 'cuff_right_bottom'
  | 'hem_left'
  | 'hem_right';

/** Order in which points are listed / drawn. left/right here = IMAGE left/right. */
export const TSHIRT_LANDMARK_NAMES: TShirtLandmarkName[] = [
  'neck_left',
  'neck_bottom',
  'neck_right',
  'shoulder_left',
  'shoulder_right',
  'armpit_left',
  'armpit_right',
  'cuff_left_top',
  'cuff_left_bottom',
  'cuff_right_top',
  'cuff_right_bottom',
  'hem_left',
  'hem_right',
];

export interface LandmarkEstimate {
  points: Record<TShirtLandmarkName, Landmark>;
  /** Outer contour of the mask (subsampled) for drawing. */
  contour: Pt[];
  hull: Pt[];
  /** Overall status: 'ok' when every sanity check passed, 'uncertain' otherwise (user should check the points). */
  status: 'ok' | 'uncertain';
  checks: { name: string; pass: boolean; detail: string }[];
}

// ---------------------------------------------------------------------------
// contour (Moore neighbour tracing on the largest region's outer boundary)
// ---------------------------------------------------------------------------

export function traceOuterContour(mask: Uint8Array, width: number, height: number): Pt[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  // start: topmost-leftmost foreground pixel
  let sx = -1,
    sy = -1;
  outer: for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (at(x, y)) {
        sx = x;
        sy = y;
        break outer;
      }
  if (sx < 0) return [];
  // 8-neighbour offsets clockwise starting from west
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy = [0, -1, -1, -1, 0, 1, 1, 1];
  const contour: Pt[] = [];
  let cx = sx,
    cy = sy;
  let dir = 0; // backtrack direction index (we came from the west)
  let guard = width * height * 4;
  do {
    contour.push({ x: cx, y: cy });
    let found = false;
    // start searching from the backtrack direction + 1 (clockwise)
    for (let k = 0; k < 8; k++) {
      const d = (dir + k) % 8;
      const nx = cx + dx[d]!;
      const ny = cy + dy[d]!;
      if (at(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = (d + 5) % 8; // new backtrack = direction we came from, rotated
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
  } while ((cx !== sx || cy !== sy) && guard-- > 0);
  return contour;
}

// ---------------------------------------------------------------------------
// convex hull (Andrew monotone chain), returns CCW in image coords (y down -> visually clockwise)
// ---------------------------------------------------------------------------

export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Deepest contour point between two hull vertices (indices into contour), measured from the chord. */
function deepestBetween(contour: Pt[], iA: number, iB: number, a: Pt, b: Pt): { index: number; depth: number } {
  let best = -1,
    depth = 0;
  const n = contour.length;
  let i = iA;
  const steps = ((iB - iA) % n + n) % n;
  for (let k = 0; k <= steps; k++) {
    const d = distToSegment(contour[i]!, a, b);
    if (d > depth) {
      depth = d;
      best = i;
    }
    i = (i + 1) % n;
  }
  return { index: best, depth };
}

// ---------------------------------------------------------------------------
// estimation
// ---------------------------------------------------------------------------

export function estimateTShirtLandmarks(mask: Uint8Array, width: number, height: number): LandmarkEstimate {
  const full = traceOuterContour(mask, width, height);
  const checks: LandmarkEstimate['checks'] = [];
  const mk = (name: TShirtLandmarkName, p: Pt | null, status: Landmark['status'] = 'ok'): Landmark => ({
    name,
    x: p ? Math.round(p.x) : 0,
    y: p ? Math.round(p.y) : 0,
    source: 'estimated',
    status: p ? status : 'unknown',
  });
  if (full.length < 20) {
    const empty = {} as Record<TShirtLandmarkName, Landmark>;
    for (const n of TSHIRT_LANDMARK_NAMES) empty[n] = mk(n, null);
    return { points: empty, contour: full, hull: [], status: 'uncertain', checks: [{ name: 'contour', pass: false, detail: 'mask is empty or too small' }] };
  }
  // subsample contour for speed (keep every k-th point, but at least ~600 points)
  const step = Math.max(1, Math.floor(full.length / 1200));
  const contour = full.filter((_, i) => i % step === 0);
  const n = contour.length;
  const hull = convexHull(contour);
  // index of each hull vertex in the contour
  const hullIdx = hull.map((h) => contour.findIndex((p) => p.x === h.x && p.y === h.y));

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of contour) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const W = maxX - minX,
    H = maxY - minY;
  const cx = (minX + maxX) / 2;

  // --- hem corners: lowest hull vertices on each side
  const hemL = hull.filter((p) => p.x < cx).reduce((a, b) => (b.y > a.y || (b.y === a.y && b.x < a.x) ? b : a));
  const hemR = hull.filter((p) => p.x >= cx).reduce((a, b) => (b.y > a.y || (b.y === a.y && b.x > a.x) ? b : a));

  // --- sleeve tips: extreme-x hull vertices in the upper 70 %
  const upper = hull.filter((p) => p.y < minY + 0.7 * H);
  const tipL = upper.reduce((a, b) => (b.x < a.x ? b : a));
  const tipR = upper.reduce((a, b) => (b.x > a.x ? b : a));

  // --- armpits: deepest defect on each side between the sleeve tip and the hem corner, walking the contour along the outer side
  const idxOf = (p: Pt) => hullIdx[hull.indexOf(p)]!;
  // contour runs clockwise visually (starting top-left, going right along the top). From tipR go down to hemR; from hemL go up to tipL.
  const defR = deepestBetween(contour, idxOf(tipR), idxOf(hemR), tipR, hemR);
  const defL = deepestBetween(contour, idxOf(hemL), idxOf(tipL), hemL, tipL);
  let armL = defL.index >= 0 ? contour[defL.index]! : null;
  let armR = defR.index >= 0 ? contour[defR.index]! : null;
  // the deepest defect between tip and hem may be the cuff underside rather than the armpit when the sleeve droops;
  // require the armpit to be inside the body band (|x-cx| < 0.45 W) and above 65 % height; otherwise look for the
  // deepest point restricted to that band
  const band = (p: Pt) => Math.abs(p.x - cx) < 0.45 * W && p.y < minY + 0.65 * H && p.y > minY + 0.08 * H;
  const restrict = (iA: number, iB: number, a: Pt, b: Pt) => {
    let best: Pt | null = null,
      depth = 0;
    let i = iA;
    const steps = ((iB - iA) % n + n) % n;
    for (let k = 0; k <= steps; k++) {
      const p = contour[i]!;
      if (band(p)) {
        const d = distToSegment(p, a, b);
        if (d > depth) {
          depth = d;
          best = p;
        }
      }
      i = (i + 1) % n;
    }
    return best;
  };
  if (!armR || !band(armR)) armR = restrict(idxOf(tipR), idxOf(hemR), tipR, hemR) ?? armR;
  if (!armL || !band(armL)) armL = restrict(idxOf(hemL), idxOf(tipL), hemL, tipL) ?? armL;

  // --- shoulders: a tee's shoulder seam sits above the armpit. Shoulder = highest contour point in a narrow
  // column band just outside the armpit x. Robust to drooping sleeves and raised collars.
  const shoulderAbove = (ap: Pt | null, side: -1 | 1): Pt | null => {
    if (!ap) return null;
    const x0 = side < 0 ? ap.x - 0.06 * W : ap.x - 0.01 * W;
    const x1 = side < 0 ? ap.x + 0.01 * W : ap.x + 0.06 * W;
    let best: Pt | null = null;
    for (const p of contour) if (p.x >= x0 && p.x <= x1 && p.y < ap.y && (!best || p.y < best.y)) best = p;
    return best;
  };
  const shL = shoulderAbove(armL, -1);
  const shR = shoulderAbove(armR, 1);
  const topL: Pt = shL ?? tipL;
  const topR: Pt = shR ?? tipR;
  const topLi = contour.indexOf(topL);
  const topRi = contour.indexOf(topR);

  // --- neck. Walking the top contour from each shoulder towards the centre, the shoulder line rises gently;
  // the collar shows as a STEEP rise (collar back visible in a flat lay — the usual case) or as a DIP (flat /
  // v-neck). The first point where the local slope exceeds 35° (up or down) is the neck side. Only a dip gives
  // a measured neck_bottom; with a raised collar the front neckline is inside the mask and cannot be read from
  // the silhouette, so neck_bottom is a DEFAULT (status 'uncertain', source 'default') the user must check.
  let neckL: Pt | null = null,
    neckR: Pt | null = null,
    neckBottom: Pt | null = null;
  let neckMeasured = false;
  let neckDefaulted = false;
  {
    const tan35 = Math.tan((35 * Math.PI) / 180);
    const win = 0.03 * W;
    const walk = (from: number, dir: 1 | -1, until: number): { pt: Pt; dip: boolean } | null => {
      let i = from;
      for (let k = 0; k < n; k++) {
        const p = contour[i]!;
        // compare with a point `win` further along the contour (arc length), so a vertical collar edge reads as steep
        const kk = Math.max(3, Math.round(win / step));
        const q = contour[(i + dir * kk + n) % n]!;
        const dx = Math.max(1, Math.abs(q.x - p.x));
        const slope = (q.y - p.y) / dx; // <0 rising (collar), >0 descending (dip)
        if (Math.abs(p.x - cx) < 0.05 * W) return null; // reached the centre without a collar edge
        if (slope < -tan35) return { pt: p, dip: false };
        if (slope > tan35) return { pt: p, dip: true };
        if (i === until) break;
        i = (i + dir + n) % n;
      }
      return null;
    };
    const l = walk(topLi, 1, topRi);
    const r = walk(topRi, -1, topLi);
    if (!(l && r)) {
      // No steep collar edge on the silhouette (smooth collar hump or collar flush with the shoulders): the neck
      // seam is a colour feature, not a silhouette feature. Use an explicit DEFAULT — neck width 0.42 of the
      // shoulder width, centred — and mark both sides as defaults for the user to drag.
      const sw = Math.hypot(topR.x - topL.x, topR.y - topL.y);
      const mx = (topL.x + topR.x) / 2;
      const nearest = (x: number): Pt => {
        let best: Pt | null = null;
        for (let k = 0, i = topLi; k < n; k++, i = (i + 1) % n) {
          const p = contour[i]!;
          if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
          if (i === topRi) break;
        }
        return best!;
      };
      neckL = nearest(mx - 0.21 * sw);
      neckR = nearest(mx + 0.21 * sw);
      neckDefaulted = true;
    }
    if (l && r) {
      neckL = l.pt;
      neckR = r.pt;
      if (l.dip || r.dip) {
        // dip: deepest contour point between the sides
        const iA = contour.indexOf(neckL),
          iB = contour.indexOf(neckR);
        const d = deepestBetween(contour, iA, iB, neckL, neckR);
        if (d.index >= 0) {
          neckBottom = contour[d.index]!;
          neckMeasured = true;
        }
      }
    }
    if (neckL && neckR && !neckBottom) {
      const nw = Math.hypot(neckR.x - neckL.x, neckR.y - neckL.y);
      neckBottom = { x: (neckL.x + neckR.x) / 2, y: (neckL.y + neckR.y) / 2 + 0.5 * nw };
    }
  }
  const shoulderL: Pt | null = shL;
  const shoulderR: Pt | null = shR;

  // --- cuffs: top/bottom-most contour points within 6 % of W of each sleeve tip
  const cuffPts = (tip: Pt) => {
    const near = contour.filter((p) => Math.abs(p.x - tip.x) < 0.06 * W);
    const top = near.reduce((a, b) => (b.y < a.y ? b : a));
    const bot = near.reduce((a, b) => (b.y > a.y ? b : a));
    return { top, bot };
  };
  const cL = cuffPts(tipL);
  const cR = cuffPts(tipR);

  // --- sanity checks
  const ok = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const neckW = neckL && neckR ? Math.hypot(neckR.x - neckL.x, neckR.y - neckL.y) : 0;
  ok('neck_sides_found', !!neckL && !!neckR && neckW > 0.08 * W && neckW < 0.6 * W, neckL && neckR ? `neckline width is ${(neckW / W).toFixed(2)} of garment width${neckDefaulted ? ' (DEFAULT VALUE: collar edges not visible in the silhouette), check the points' : ''}` : 'neckline sides not found');
  ok('neck_bottom_measured', neckMeasured, neckMeasured ? 'neckline bottom is visible in the silhouette' : 'neckline bottom is not visible in the silhouette (back collar is higher); a default was used, check the point');
  ok('armpits_found', !!armL && !!armR, armL && armR ? `armpits at y=${armL.y},${armR.y}` : 'not found');
  // checks[2..] indices used below
  ok('armpits_below_shoulders', !!armL && !!armR && !!shoulderL && !!shoulderR && armL.y > shoulderL.y && armR.y > shoulderR.y, 'armpits are below the shoulders');
  ok('armpits_above_hem', !!armL && !!armR && armL.y < hemL.y - 0.2 * H && armR.y < hemR.y - 0.2 * H, 'armpits are well above the hem');
  const symm = armL && armR ? Math.abs(armL.y - armR.y) / H : 1;
  ok('armpits_symmetric', symm < 0.08, `armpit height difference is ${(symm * 100).toFixed(1)}% of height`);
  const sleeveL = shoulderL ? Math.hypot(tipL.x - shoulderL.x, tipL.y - shoulderL.y) : 0;
  const sleeveR = shoulderR ? Math.hypot(tipR.x - shoulderR.x, tipR.y - shoulderR.y) : 0;
  ok('sleeves_similar', sleeveL > 0 && sleeveR > 0 && Math.abs(sleeveL - sleeveR) / Math.max(sleeveL, sleeveR) < 0.25, `sleeve lengths ${sleeveL.toFixed(0)} / ${sleeveR.toFixed(0)} px`);
  ok('cuffs_outside_body', !!armL && !!armR && tipL.x < armL.x - 0.05 * W && tipR.x > armR.x + 0.05 * W, 'cuffs are outside the armpits');

  const status: LandmarkEstimate['status'] = checks.every((c) => c.pass || c.name === 'neck_bottom_measured') ? 'ok' : 'uncertain';
  const st = (pass: boolean): Landmark['status'] => (pass ? 'ok' : 'uncertain');
  const points: Record<TShirtLandmarkName, Landmark> = {
    neck_left: { ...mk('neck_left', neckL, neckDefaulted ? 'uncertain' : st(checks[0]!.pass)), source: neckDefaulted ? 'default' : 'estimated' },
    neck_bottom: { ...mk('neck_bottom', neckBottom, neckMeasured ? st(checks[0]!.pass) : 'uncertain'), source: neckMeasured ? 'estimated' : 'default' },
    neck_right: { ...mk('neck_right', neckR, neckDefaulted ? 'uncertain' : st(checks[0]!.pass)), source: neckDefaulted ? 'default' : 'estimated' },
    shoulder_left: mk('shoulder_left', shoulderL),
    shoulder_right: mk('shoulder_right', shoulderR),
    armpit_left: mk('armpit_left', armL, st(checks[2]!.pass && checks[3]!.pass && checks[4]!.pass && checks[5]!.pass)),
    armpit_right: mk('armpit_right', armR, st(checks[2]!.pass && checks[3]!.pass && checks[4]!.pass && checks[5]!.pass)),
    cuff_left_top: mk('cuff_left_top', cL.top, st(checks[6]!.pass)),
    cuff_left_bottom: mk('cuff_left_bottom', cL.bot, st(checks[6]!.pass)),
    cuff_right_top: mk('cuff_right_top', cR.top, st(checks[6]!.pass)),
    cuff_right_bottom: mk('cuff_right_bottom', cR.bot, st(checks[6]!.pass)),
    hem_left: mk('hem_left', hemL),
    hem_right: mk('hem_right', hemR),
  };
  return { points, contour, hull, status, checks };
}

// ---------------------------------------------------------------------------
// relative ratios (no centimetres: everything is divided by the torso width)
// ---------------------------------------------------------------------------

export interface TShirtRatios {
  /** distance between armpits, px — the unit everything else is divided by */
  torsoWidthPx: number;
  length: number; // shoulder line -> hem centre / torsoWidth
  hemWidth: number; // hem corner distance / torsoWidth
  shoulderWidth: number; // shoulder-to-shoulder / torsoWidth
  armholeDepth: number; // armpit y - shoulder y / torsoWidth
  sleeveLength: number; // armhole centre -> cuff centre / torsoWidth
  cuffWidth: number; // cuff top-bottom / torsoWidth
  sleeveAngle: number; // radians below horizontal, averaged
  neckWidth: number; // neck_left-neck_right / torsoWidth
  neckDepth: number; // neck_bottom.y - neck sides y / torsoWidth
}

export function tshirtRatios(p: Record<TShirtLandmarkName, Landmark>): TShirtRatios {
  const d = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
  const torso = Math.max(1, d(p.armpit_left, p.armpit_right));
  const shoulderY = (p.shoulder_left.y + p.shoulder_right.y) / 2;
  const hemY = (p.hem_left.y + p.hem_right.y) / 2;
  const sleeve = (sh: Landmark, ap: Landmark, ct: Landmark, cb: Landmark) => {
    const ax = (sh.x + ap.x) / 2,
      ay = (sh.y + ap.y) / 2;
    const cxx = (ct.x + cb.x) / 2,
      cyy = (ct.y + cb.y) / 2;
    return { len: Math.hypot(cxx - ax, cyy - ay), angle: Math.atan2(cyy - ay, Math.abs(cxx - ax)) };
  };
  const sL = sleeve(p.shoulder_left, p.armpit_left, p.cuff_left_top, p.cuff_left_bottom);
  const sR = sleeve(p.shoulder_right, p.armpit_right, p.cuff_right_top, p.cuff_right_bottom);
  return {
    torsoWidthPx: torso,
    length: (hemY - shoulderY) / torso,
    hemWidth: d(p.hem_left, p.hem_right) / torso,
    shoulderWidth: d(p.shoulder_left, p.shoulder_right) / torso,
    armholeDepth: ((p.armpit_left.y + p.armpit_right.y) / 2 - shoulderY) / torso,
    sleeveLength: (sL.len + sR.len) / 2 / torso,
    cuffWidth: (d(p.cuff_left_top, p.cuff_left_bottom) + d(p.cuff_right_top, p.cuff_right_bottom)) / 2 / torso,
    sleeveAngle: Math.max(0, (sL.angle + sR.angle) / 2),
    neckWidth: d(p.neck_left, p.neck_right) / torso,
    neckDepth: (p.neck_bottom.y - (p.neck_left.y + p.neck_right.y) / 2) / torso,
  };
}
