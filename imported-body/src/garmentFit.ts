/**
 * Stage I-13 — grading an imported garment onto a body.
 *
 * One uniform scale cannot fit a garment: length and girth are independent measurements of a real garment and
 * are graded separately. Scaling this shirt by its chest alone made it a tunic to mid-thigh (its own cut is
 * long), and scaling it by its length would have made it skin-tight. So the transform here is:
 *   • horizontal (x, z) from the garment's chest girth → the body's chest girth + the garment's EASE
 *   • vertical   (y)    from the garment's shoulder→hem length → the body's acromion→hem-target length
 * Both are measured on the two meshes, not assumed, and both are reported.
 *
 * The garment's own landmarks are found from its width profile: the torso is a plateau, the sleeves are a
 * bulge above it, and above the sleeves the width falls to the shoulder and then the collar.
 */
import { sliceContours } from './geom/measure';

export interface GarmentLandmarks {
  hemY: number;
  armpitY: number;
  sleeveTipY: number;
  shoulderY: number;
  collarY: number;
  /** girth of the torso at the chest, outer wall */
  chestGirth: number;
  chestY: number;
  torsoHalfWidth: number;
}

/** outer-wall perimeter of the garment at this height (a garment with thickness cuts as nested contours) */
function outerGirth(p: Float32Array, idx: Uint32Array, y: number): number {
  try {
    const cs = sliceContours(p, idx, y);
    if (!cs.length) return NaN;
    return Math.max(...cs.map((c) => c.perimeter));
  } catch {
    return NaN;
  }
}

export function garmentLandmarks(p: Float32Array, idx: Uint32Array): GarmentLandmarks {
  const n = p.length / 3;
  let top = -Infinity, bot = Infinity;
  for (let i = 0; i < n; i++) { top = Math.max(top, p[i * 3 + 1]!); bot = Math.min(bot, p[i * 3 + 1]!); }
  const H = top - bot;
  const B = 60;
  const w = new Array<number>(B).fill(0);
  for (let i = 0; i < n; i++) {
    const b = Math.min(B - 1, Math.max(0, Math.floor(((p[i * 3 + 1]! - bot) / H) * B)));
    w[b] = Math.max(w[b]!, Math.abs(p[i * 3]!));
  }
  const yOf = (b: number) => bot + ((b + 0.5) / B) * H;
  // torso plateau: the median width over the lower half
  const lower = w.slice(0, Math.floor(B * 0.45)).sort((a, b) => a - b);
  const torsoHalf = lower[Math.floor(lower.length / 2)]!;
  // sleeve tips: the widest band anywhere
  let tip = 0;
  for (let b = 0; b < B; b++) if (w[b]! > w[tip]!) tip = b;
  // armpit: walking down from the tips, the first band back at the torso plateau
  let armpit = tip;
  for (let b = tip; b >= 0; b--) if (w[b]! <= torsoHalf * 1.06) { armpit = b; break; }
  // shoulder: walking up from the tips, the first band back at the plateau — that is where the sleeve ends and
  // the shoulder seam sits
  let shoulder = B - 1;
  for (let b = tip; b < B; b++) if (w[b]! <= torsoHalf * 1.2) { shoulder = b; break; }
  const chestB = Math.max(0, armpit - 2);
  return {
    hemY: bot,
    armpitY: yOf(armpit),
    sleeveTipY: yOf(tip),
    shoulderY: yOf(shoulder),
    collarY: top,
    chestY: yOf(chestB),
    chestGirth: outerGirth(p, idx, yOf(chestB)),
    torsoHalfWidth: torsoHalf,
  };
}

export interface Grade {
  scaleXZ: number;
  scaleY: number;
  offsetY: number;
  /** what the numbers were derived from, for the report */
  garment: GarmentLandmarks;
  bodyChestGirth: number;
  easeChest_cm: number;
  hemTargetY: number;
  shoulderTargetY: number;
  /** collar height after grading, for the neckline step */
  collarY: number;
}

/**
 * @param easeChest metres of circumference added over the body's chest (a jersey tee is ~0.08–0.12 m)
 * @param hemTargetY where the hem should end on the body (metres)
 * @param shoulderTargetY the body's acromion level
 */
export function gradeGarment(
  gp: Float32Array,
  gi: Uint32Array,
  bodyChestGirth: number,
  easeChest: number,
  hemTargetY: number,
  shoulderTargetY: number,
): Grade {
  const L = garmentLandmarks(gp, gi);
  const scaleXZ = (bodyChestGirth + easeChest) / L.chestGirth;
  const scaleY = (shoulderTargetY - hemTargetY) / (L.shoulderY - L.hemY);
  const offsetY = shoulderTargetY - L.shoulderY * scaleY;
  return { scaleXZ, scaleY, offsetY, garment: L, bodyChestGirth, easeChest_cm: easeChest * 100, hemTargetY, shoulderTargetY, collarY: L.collarY * scaleY + offsetY };
}

/**
 * Vertical grading in TWO segments instead of one scale: the shoulder goes to the acromion, the garment's own
 * armhole goes to the body's armpit, and the hem goes to the hem target. With a single scale this shirt's
 * armhole landed 19 cm below the wearer's armpit — a drop shoulder the source model has and the wearer does
 * not. Below the hem and above the shoulder the map continues with the nearest segment's slope, so nothing is
 * clipped. This is what grading a pattern does; it is recorded in the report, not hidden.
 */
export function piecewiseY(gy: number, L: GarmentLandmarks, shoulderTarget: number, armholeTarget: number, hemTarget: number): number {
  const k1 = (shoulderTarget - armholeTarget) / (L.shoulderY - L.armpitY || 1e-9);
  const k2 = (armholeTarget - hemTarget) / (L.armpitY - L.hemY || 1e-9);
  if (gy >= L.armpitY) return armholeTarget + (gy - L.armpitY) * k1;
  return armholeTarget + (gy - L.armpitY) * k2;
}

/** applies the grade in place; z is centred on the body's own torso centre line */
export function applyGrade(gp: Float32Array, g: Grade, zMid: number, bodyCz: number, armholeTarget?: number): void {
  for (let i = 0; i < gp.length / 3; i++) {
    gp[i * 3] = gp[i * 3]! * g.scaleXZ;
    gp[i * 3 + 1] =
      armholeTarget === undefined
        ? gp[i * 3 + 1]! * g.scaleY + g.offsetY
        : piecewiseY(gp[i * 3 + 1]!, g.garment, g.shoulderTargetY, armholeTarget, g.hemTargetY);
    gp[i * 3 + 2] = (gp[i * 3 + 2]! - zMid) * g.scaleXZ + bodyCz;
  }
}

/**
 * Necklines are graded separately from the body of a garment, and this one has to be: the shirt's opening is
 * 21 cm across after grading, against a 12 cm neck, so it slides off the shoulders and reads as a boat neck.
 * Vertices are drawn toward the collar's centre by a factor that fades to 1 by the chest, so only the neckline
 * moves and the rest of the garment keeps the size it was graded to.
 */
export function tightenCollar(gp: Float32Array, collarY: number, chestY: number, centre: [number, number], factor: number): number {
  let touched = 0;
  const span = collarY - chestY || 1e-9;
  for (let i = 0; i < gp.length / 3; i++) {
    const y = gp[i * 3 + 1]!;
    const t = (y - chestY) / span;
    if (t <= 0) continue;
    const u = Math.min(1, t);
    const w = u * u * (3 - 2 * u); // 0 at the chest, 1 at the collar
    const f = 1 + (factor - 1) * w;
    gp[i * 3] = centre[0] + (gp[i * 3]! - centre[0]) * f;
    gp[i * 3 + 2] = centre[1] + (gp[i * 3 + 2]! - centre[1]) * f;
    touched++;
  }
  return touched;
}

/** widest half-width of the garment within a band around a height (used to size the neckline) */
export function halfWidthAt(gp: Float32Array, y: number, band: number): number {
  let w = 0;
  for (let i = 0; i < gp.length / 3; i++) if (Math.abs(gp[i * 3 + 1]! - y) < band) w = Math.max(w, Math.abs(gp[i * 3]!));
  return w;
}

/**
 * Shaping the garment to the body at a fixed ease, instead of leaving it a straight tube.
 *
 * A single horizontal scale from the chest leaves this shirt 44 cm larger than the waist and 28 cm larger than
 * the hips: that is the source garment's own cut, and it reads as a loose tunic however well it is simulated.
 * Here every torso vertex is pulled toward an OFFSET SURFACE of the body — the body's own radial profile plus
 * the ease a tee is supposed to have — so the garment follows the figure and the simulation then puts the
 * folds back in. Sleeves and the area around the armhole are left alone (weight fades to 0), because pulling
 * them in would squeeze them onto the arms.
 *
 * @param easeCirc_m ease in CIRCUMFERENCE, metres; the radial offset is that over 2π
 */
export function shapeToBody(
  gp: Float32Array,
  ringAt: (y: number, ang: number) => { r: number; cx: number; cz: number } | null,
  easeCirc: number,
  torsoTopY: number,
  fade: number,
): number {
  const easeR = easeCirc / (2 * Math.PI);
  const n = gp.length / 3;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, gp[i * 3 + 1]!); hi = Math.max(hi, gp[i * 3 + 1]!); }
  const BANDS = 40;
  const h = (hi - lo) / BANDS || 1;
  // per band: the garment's outer radius (95th percentile, so a stray fold does not set it) and the target
  const gR: number[][] = Array.from({ length: BANDS }, () => []);
  const tR: number[][] = Array.from({ length: BANDS }, () => []);
  for (let i = 0; i < n; i++) {
    const y = gp[i * 3 + 1]!;
    const b = Math.max(0, Math.min(BANDS - 1, Math.floor((y - lo) / h)));
    const ring = ringAt(y, Math.atan2(gp[i * 3 + 2]!, gp[i * 3]!));
    if (!ring) continue;
    const d = Math.hypot(gp[i * 3]! - ring.cx, gp[i * 3 + 2]! - ring.cz);
    if (Math.abs(gp[i * 3]!) > ring.r * 1.9) continue; // a sleeve, not the body of the shirt
    gR[b]!.push(d);
    tR[b]!.push(ring.r + easeR);
  }
  const pct = (a: number[], q: number) => (a.length ? a.slice().sort((x, y2) => x - y2)[Math.min(a.length - 1, Math.floor(a.length * q))]! : NaN);
  /**
   * The target is NOT the body at that height. A tee hangs from the chest and shoulders and skims whatever is
   * below; it does not follow the waist. Taking the body's own girth per band gave a cinched waist and a
   * flared skirt below it (renders/sheet-shape.png). So the target at a height is the widest the body gets at
   * that height OR ANYWHERE BELOW it, plus the ease — a straight silhouette that clears the hips.
   */
  const want = new Array<number>(BANDS).fill(NaN);
  for (let b = 0; b < BANDS; b++) want[b] = pct(tR[b]!, 0.5);
  let running = 0;
  for (let b = 0; b < BANDS; b++) {
    if (Number.isFinite(want[b]!)) running = Math.max(running, want[b]!);
    want[b] = running || NaN;
  }
  const factor = new Array<number>(BANDS).fill(1);
  for (let b = 0; b < BANDS; b++) {
    const g = pct(gR[b]!, 0.95), t = want[b]!;
    // ONE factor per band, applied to every vertex there: pulling each vertex to the target radius instead
    // collapsed the shell — both of its walls landed on the same radius and the fabric lost its thickness
    if (Number.isFinite(g) && Number.isFinite(t) && g > 1e-6) factor[b] = Math.min(1, t / g);
  }
  // smooth the factors so no band edge shows as a crease
  const sm = factor.map((_, b) => {
    let s2 = 0, w2 = 0;
    for (let k = -2; k <= 2; k++) {
      const j = b + k;
      if (j < 0 || j >= BANDS) continue;
      const wk = 1 / (1 + Math.abs(k));
      s2 += factor[j]! * wk; w2 += wk;
    }
    return s2 / w2;
  });
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const y = gp[i * 3 + 1]!;
    const w = y >= torsoTopY ? 0 : Math.min(1, (torsoTopY - y) / fade);
    if (w <= 0) continue;
    const ring = ringAt(y, Math.atan2(gp[i * 3 + 2]!, gp[i * 3]!));
    if (!ring) continue;
    const b = Math.max(0, Math.min(BANDS - 1, Math.floor((y - lo) / h)));
    const f = 1 + (sm[b]! - 1) * w;
    if (f >= 0.999) continue;
    gp[i * 3] = ring.cx + (gp[i * 3]! - ring.cx) * f;
    gp[i * 3 + 2] = ring.cz + (gp[i * 3 + 2]! - ring.cz) * f;
    moved++;
  }
  return moved;
}
