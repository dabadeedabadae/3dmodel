/**
 * Stage I-50 — one body for every outfit.
 *
 * Every generated figure comes with its own head, hands and proportions, so two outfits never look like the
 * same person and a top from one cannot meet a bottom from another. This step keeps a figure's CLOTHES and
 * replaces its BODY with the reference figure's:
 *   1. heights are remapped piecewise-linearly so ankle, crotch, armhole, neck and crown match the reference;
 *   2. the arm span is rescaled outward from the armhole so the fingertips reach where the reference's do;
 *   3. the head and the hands are removed and the reference's head and hands are inserted, centred on the
 *      collar and on each cuff.
 * The garments keep their own widths: a hoodie is wider than a T-shirt, and that is the garment, not the body.
 * The result is a plain mesh that goes through prepare-outfit like any FBX, so every check applies to it.
 *
 *   node --import tsx imported-body/scripts/compose-outfit.ts <target raw id> <reference id> <out file>
 *   e.g. raw-outfit02 outfit01 imported-body/out/composed-outfit02.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Prepared {
  base: number[];
  index: number[];
  landmarks: Record<string, number>;
  partsIndex: { kind: string; vertices: number[]; cut?: boolean }[];
}
const [targetId, refId, outFile] = process.argv.slice(2);
if (!targetId || !refId || !outFile) throw new Error('usage: compose-outfit <target id> <reference id> <out file>');
const load = (id: string) => JSON.parse(readFileSync(`imported-body/out/outfit-${id}.json`, 'utf8')) as Prepared;
const T = load(targetId), R = load(refId);

const kindOf = (p: Prepared) => {
  const k = new Array<string>(p.base.length / 3).fill('other');
  for (const part of p.partsIndex) for (const v of part.vertices) k[v] = part.kind;
  return k;
};
const tKind = kindOf(T), rKind = kindOf(R);
const isBody = (k: string) => k === 'head' || k === 'arm_left' || k === 'arm_right';
const tp = Float64Array.from(T.base), rp = Float64Array.from(R.base);
const nT = tp.length / 3, nR = rp.length / 3;

// 1. heights
/**
 * The upper knot is the FRONT OF THE NECKLINE, not the neck landmark. On the reference the neck landmark (the
 * bottom of its head shell, 141.7 cm) is hidden under the T-shirt, whose neckline front is at 144.8 cm; on the shirt
 * the two coincide (150.1 / 150.3). Mapping neck → neck put the shirt's collar 3 cm lower than the reference
 * neckline and a long bare neck showed (user's side views). Necklines are matched instead.
 */
function necklineFront(p: Prepared): number {
  const b = p.base, kind = kindOf(p), arm = p.landmarks.armpit!;
  const top = [...Array(b.length / 3).keys()].filter((i) => kind[i] === 'top');
  const zs = top.filter((i) => Math.abs(b[i * 3 + 1]! - arm) < 0.03).map((i) => b[i * 3 + 2]!);
  const zmid = (Math.min(...zs) + Math.max(...zs)) / 2;
  const front = top.filter((i) => Math.abs(b[i * 3]!) < 0.03 && b[i * 3 + 2]! > zmid);
  if (!front.length) throw new Error('cannot find the front of the neckline');
  return Math.max(...front.map((i) => b[i * 3 + 1]!));
}
const knots = (p: Prepared) => { const L = p.landmarks; return [0, L.ankle!, L.crotch!, L.armpit!, necklineFront(p), L.height!]; };
const from = knots(T), to = knots(R);
for (let i = 1; i < from.length; i++) if (!(from[i]! > from[i - 1]!) || !(to[i]! > to[i - 1]!)) throw new Error(`landmarks out of order at knot ${i}`);
const mapY = (y: number) => {
  for (let i = 1; i < from.length; i++) if (y <= from[i]! || i === from.length - 1) {
    const f = (y - from[i - 1]!) / (from[i]! - from[i - 1]!);
    return to[i - 1]! + f * (to[i]! - to[i - 1]!);
  }
  return y;
};
for (let i = 0; i < nT; i++) tp[i * 3 + 1] = mapY(tp[i * 3 + 1]!);

// 2. arm span, measured to the fingertips, scaled outward from the trunk at armhole height
const reach = (p: Float64Array, n: number) => { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(p[i * 3]!)); return m; };
const armpitY = R.landmarks.armpit!;
let s0 = 0;
for (let i = 0; i < nT; i++) if (tKind[i] === 'top' && Math.abs(tp[i * 3 + 1]! - (armpitY - 0.04)) < 0.015) s0 = Math.max(s0, Math.abs(tp[i * 3]!));
/**
 * The sleeve end (the cuff, where the outfit's own hand began) goes to the reference WRIST: reference fingertips
 * minus a hand length of 10.8 % of stature (adult anthropometric average, ≈ 19 cm at 175 cm). Scaling to the
 * fingertips stretched long sleeves past the wrist and the inserted hands showed as stubs (visual check of the
 * hoodie and the shirt).
 */
const tArms = [...Array(nT).keys()].filter((i) => tKind[i] === 'arm_left' || tKind[i] === 'arm_right');
const tCuffRaw = Math.min(...tArms.map((i) => Math.abs(tp[i * 3]!)));
const refWrist = reach(rp, nR) - 0.108 * R.landmarks.height!;
const kArm = (refWrist - s0) / (tCuffRaw - s0);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < nT; i++) {
  const ax = Math.abs(tp[i * 3]!);
  if (ax <= s0) continue;
  // only at arm height: wide trouser legs further down must not be stretched sideways
  const w = smooth(armpitY - 0.1, armpitY - 0.04, tp[i * 3 + 1]!);
  tp[i * 3] = Math.sign(tp[i * 3]!) * (ax + w * (ax - s0) * (kArm - 1));
}

/**
 * 2b. Shoulder line. The shirt's shoulders came 4–5 cm lower than the reference's (142.3–143.6 vs 146.5–148.6 cm at
 * 10–20 cm from the centre) while its widths match (17–19 cm half-width at every height): the upper body looked
 * smaller and the head sat high on a long neck (user: "enlarge the body, lower the head"). The head stays where the
 * reference has it (stature is fixed); the garment's shoulders are lifted to the reference shoulder line instead —
 * fully on top of the shoulders, nothing at the armhole or at the collar, fading out along the sleeve.
 */
const shoulderTop = (p: Float64Array, ids: number[], x: number) => {
  let m = -Infinity;
  for (const i of ids) if (Math.abs(Math.abs(p[i * 3]!) - x) < 0.015) m = Math.max(m, p[i * 3 + 1]!);
  return m;
};
const tTopIds = [...Array(nT).keys()].filter((i) => tKind[i] === 'top');
const rTopIds = [...Array(nR).keys()].filter((i) => rKind[i] === 'top');
const shoulderLift = Math.max(0, shoulderTop(rp, rTopIds, 0.15) - shoulderTop(tp, tTopIds, 0.15));
if (shoulderLift > 0.005) {
  const yTop = shoulderTop(tp, tTopIds, 0.15);
  for (const i of tTopIds) {
    const ax = Math.abs(tp[i * 3]!), y = tp[i * 3 + 1]!;
    const wy = smooth(armpitY, yTop, y);
    const wx = smooth(0.05, 0.11, ax) * (1 - smooth(s0 + 0.01, s0 + 0.11, ax));
    tp[i * 3 + 1] = y + shoulderLift * wy * wx;
  }
}

// 3. reference head and hands
const out: number[] = [];
const outIndex: number[] = [];
const remapT = new Int32Array(nT).fill(-1);
for (let i = 0; i < nT; i++) if (!isBody(tKind[i]!)) { remapT[i] = out.length / 3; out.push(tp[i * 3]!, tp[i * 3 + 1]!, tp[i * 3 + 2]!); }
for (let t = 0; t < T.index.length; t += 3) {
  const a = remapT[T.index[t]!]!, b = remapT[T.index[t + 1]!]!, c = remapT[T.index[t + 2]!]!;
  if (a >= 0 && b >= 0 && c >= 0) outIndex.push(a, b, c);
}

const centroid = (p: Float64Array, ids: number[]) => {
  const c = [0, 0, 0];
  for (const i of ids) for (let k = 0; k < 3; k++) c[k]! += p[i * 3 + k]!;
  return c.map((v) => v / Math.max(ids.length, 1));
};
// head: the reference neck ring onto the centre of the target collar
const neckY = R.landmarks.neck_base!;
const collar = [...Array(nT).keys()].filter((i) => !isBody(tKind[i]!) && Math.abs(tp[i * 3 + 1]! - neckY) < 0.03 && Math.abs(tp[i * 3]!) < 0.1);
const rNeck = [...Array(nR).keys()].filter((i) => rKind[i] === 'head' && Math.abs(rp[i * 3 + 1]! - neckY) < 0.03);
if (!collar.length || !rNeck.length) throw new Error('cannot find the collar or the reference neck');
/**
 * Depth placement: the reference throat goes where the outfit's OWN head had its throat. The generator placed
 * that head correctly against its own clothes. Two cheaper anchors failed: the average of the collar (a shirt's
 * stand collar and a hoodie's hood put most fabric at the back — the head slid 6–7 cm back and stuck out of the
 * collar with a hole at the throat), and the front of the neckline at neck height (a hoodie has no fabric there in
 * front, so the "front" was the hood, 25 cm back).
 */
const frontOf = (p: Float64Array, ids: number[]) => Math.max(...ids.filter((i) => Math.abs(p[i * 3]!) < 0.04).map((i) => p[i * 3 + 2]!));
const tHead = [...Array(nT).keys()].filter((i) => tKind[i] === 'head');
const tHeadBottom = Math.min(...tHead.map((i) => tp[i * 3 + 1]!));
const tThroat = tHead.filter((i) => tp[i * 3 + 1]! < tHeadBottom + 0.015); // 1.5 cm: a short neck reaches the chin within 4 cm
const refBottom0 = Math.min(...[...Array(nR).keys()].filter((i) => rKind[i] === 'head').map((i) => rp[i * 3 + 1]!));
const rThroat = [...Array(nR).keys()].filter((i) => rKind[i] === 'head' && rp[i * 3 + 1]! < refBottom0 + 0.015);
if (!tThroat.length || !rThroat.length) throw new Error('cannot find the throat of the outfit head or of the reference');
/**
 * That anchor needs a whole head. When the outfit's head was CUT out of its clothes (I-47, the shirt), the strip
 * above the cut holds only the back of the neck, and its "front" is the nape. Then the throat goes 1 cm behind the
 * front of the neckline, as on the reference figure (neckline front +6 cm, throat +5 cm).
 */
const headWasCut = T.partsIndex.some((p) => p.kind === 'head' && p.cut);
const collarFront = [...Array(nT).keys()].filter((i) => !isBody(tKind[i]!) && tKind[i] !== 'bottom' && tp[i * 3 + 1]! > neckY - 0.04 && tp[i * 3 + 1]! < neckY + 0.01);
const headShift = [0, 0, headWasCut ? frontOf(tp, collarFront) - 0.01 - frontOf(rp, rThroat) : frontOf(tp, tThroat) - frontOf(rp, rThroat)];
void centroid(tp, collar); void rNeck;
/**
 * The reference neck must reach INTO the collar. With the T-shirt and the hoodie it does (their collars rise 7–10
 * cm above the bottom of the neck), but the shirt came fused to its own head, and cutting that head off took the
 * top of its collar with it: the collar ended exactly where the neck began and a gap showed from the side. When the
 * collar does not cover the neck by 3 cm, only the bottom ring of the reference neck is lowered into it; the
 * head itself is unchanged.
 */
const refHeadIds = [...Array(nR).keys()].filter((i) => rKind[i] === 'head');
const refHeadBottom = Math.min(...refHeadIds.map((i) => rp[i * 3 + 1]!));
let collarTop = -Infinity;
for (let i = 0; i < nT; i++) if (!isBody(tKind[i]!) && tKind[i] !== 'bottom' && Math.abs(tp[i * 3]!) < 0.09) collarTop = Math.max(collarTop, tp[i * 3 + 1]!);
const neckBottomTarget = Math.min(refHeadBottom, collarTop - 0.03);
/**
 * The base of the reference neck flares back and sideways to ±12 cm at 146–147 cm (the muscles running to the
 * shoulders). The T-shirt and the hoodie cover it (fabric up to 149–150 cm at the back); the shirt ends at 145 cm
 * and the flare stuck out above its collar like a skin-coloured flap (user's back view). When the garment does not
 * cover it, the base of the neck is pulled in to the plain neck cylinder, which sits inside the collar.
 */
const flareTop = refHeadBottom + 0.06;
const rNeckRing = refHeadIds.filter((i) => rp[i * 3 + 1]! >= refHeadBottom + 0.06 && rp[i * 3 + 1]! < refHeadBottom + 0.09);
const neckCz = (Math.max(...rNeckRing.map((i) => rp[i * 3 + 2]!)) + Math.min(...rNeckRing.map((i) => rp[i * 3 + 2]!))) / 2;
/**
 * The tuck radius follows the collar: the opening of the outfit's neckline (median radius of its top rim around
 * the neck axis) minus 5 mm, within 6–9 cm. A fixed 6 cm neck left a 3 cm ring between the shirt's collar
 * (9.3 cm) and the neck, and the shaded inside of the collar showed through it (close-up check); on the reference
 * the T-shirt neckline and the neck are both 8.8 cm.
 */
const collarRim = [...Array(nT).keys()].filter((i) => !isBody(tKind[i]!) && tKind[i] === 'top' && Math.abs(tp[i * 3]!) < 0.12 && tp[i * 3 + 1]! > collarTop - 0.025);
const rimR = collarRim.map((i) => Math.hypot(tp[i * 3]!, tp[i * 3 + 2]! - (neckCz + headShift[2]!))).sort((p, q) => p - q);
const collarFitR = Math.min(0.09, Math.max(0.06, (rimR[rimR.length >> 1] ?? 0.065) - 0.005));
// the reference's own neck radius just above the flare, and the collar line in reference coordinates
const naturalNeckR = Math.max(0.04, Math.min(collarFitR, Math.max(...rNeckRing.map((i) => Math.hypot(rp[i * 3]!, rp[i * 3 + 2]! - neckCz)))));
/**
 * The exposed neck keeps the reference's NATURAL thickness, and the collar is pulled in to it (below). Sizing the
 * neck to the collar (8.9 cm) instead showed the base of the reference neck — made to sit under a T-shirt — as a
 * wide pale bib inside the shirt's open collar (side-by-side check with the T-shirt). collarFitR is kept in the
 * report for comparison.
 */
const NECK_R = naturalNeckR;
const collarTopRef = Math.min(flareTop - 0.01, collarTop);
let backCover = -Infinity;
for (let i = 0; i < nT; i++) if (!isBody(tKind[i]!) && tKind[i] === 'top' && Math.abs(tp[i * 3]!) < 0.12 && tp[i * 3 + 2]! < neckCz) backCover = Math.max(backCover, tp[i * 3 + 1]!);
const tuckFlare = backCover < flareTop;
let tucked = 0;
const tuckedZ = new Map<number, number>();
const neckLowered = refHeadBottom - neckBottomTarget;

// hands: for each side, the target cuff is the innermost x of its own removed hand/arm shell
const cuffX: Record<string, number> = {};
for (const side of ['arm_left', 'arm_right']) {
  const ids = [...Array(nT).keys()].filter((i) => tKind[i] === side);
  if (!ids.length) throw new Error(`target has no ${side}`);
  cuffX[side] = Math.min(...ids.map((i) => Math.abs(tp[i * 3]!)));
}
const handShift: Record<string, number[]> = {};
for (const side of ['arm_left', 'arm_right']) {
  const x0 = cuffX[side]!;
  const sgn = side === 'arm_left' ? 1 : -1;
  // centre of the sleeve opening (target) vs centre of the reference arm at the same distance from the body
  const sleeve = [...Array(nT).keys()].filter((i) => !isBody(tKind[i]!) && tp[i * 3]! * sgn > x0 - 0.03 && tp[i * 3]! * sgn <= x0 + 0.005);
  const rArm = [...Array(nR).keys()].filter((i) => rKind[i] === side && Math.abs(Math.abs(rp[i * 3]!) - x0) < 0.02);
  handShift[side] = sleeve.length && rArm.length
    ? [0, centroid(tp, sleeve)[1]! - centroid(rp, rArm)[1]!, centroid(tp, sleeve)[2]! - centroid(rp, rArm)[2]!]
    : [0, 0, 0];
}

/**
 * Hands are placed as a mirrored pair: one cuff line and one shift for both sides. Placing each side on its own
 * sleeve made them differ by up to 27 mm, and the composed figure stopped being symmetric (check-outfit caught it).
 */
{
  const c = (cuffX.arm_left! + cuffX.arm_right!) / 2;
  cuffX.arm_left = c; cuffX.arm_right = c;
  const L = handShift.arm_left!, Rt = handShift.arm_right!;
  const avg = [0, (L[1]! + Rt[1]!) / 2, (L[2]! + Rt[2]!) / 2];
  handShift.arm_left = avg; handShift.arm_right = avg;
}
/**
 * Which reference vertices go in. The low-poly forearm is a single long segment between the elbow ring and the
 * wrist ring, so keeping only the vertices beyond the cuff and dropping the triangles that cross it removed
 * the whole forearm surface and left a visible gap between cuff and hand. Every triangle that reaches past the
 * cut is kept; its vertices on the near side are pulled towards a plane 1.5 cm inside the sleeve, where the
 * squashed strip stays hidden (compressed 7× towards the cut, not flattened).
 */
const cutOf = (k: string) => cuffX[k]! - 0.015;
/**
 * The right hand is the MIRROR of the reference's left hand, not the reference's own right hand: the reference
 * mesh is not mirror-topological (138 vs 141 arm vertices), so its two forearm strips hidden in the cuffs sat at
 * 63.4 and 61.2 cm from the centre, and a slider amplified that past the symmetry check. Built as a mirrored
 * pair, the hands are symmetric by construction; the head stays exactly the reference's.
 */
const beyond = (i: number) => {
  const k = rKind[i]!;
  return k === 'head' || (k === 'arm_left' && Math.abs(rp[i * 3]!) > cutOf(k));
};
const keep = new Uint8Array(nR);
for (let t = 0; t < R.index.length; t += 3) {
  const tri = [R.index[t]!, R.index[t + 1]!, R.index[t + 2]!];
  if (tri.some(beyond) && tri.every((v) => rKind[v] === rKind[tri[0]!])) for (const v of tri) keep[v] = 1;
}
const remapR = new Int32Array(nR).fill(-1);
const remapMirror = new Int32Array(nR).fill(-1);
let pulled = 0;
for (let i = 0; i < nR; i++) {
  if (!keep[i]) continue;
  const k = rKind[i]!;
  const shift = k === 'head' ? headShift : handShift.arm_left!;
  let x = rp[i * 3]!;
  if (k !== 'head' && Math.abs(x) < cutOf(k)) { x = Math.sign(x) * (cutOf(k) - (cutOf(k) - Math.abs(x)) * 0.15); pulled++; }
  let y = rp[i * 3 + 1]! + shift[1]!;
  const z = rp[i * 3 + 2]! + shift[2]!;
  if (k === 'head' && neckLowered > 0 && rp[i * 3 + 1]! < refHeadBottom + 0.015) y -= neckLowered;
  if (k === 'head' && tuckFlare && rp[i * 3 + 1]! < flareTop) {
    // a funnel, not a column: the collar-sized radius at the collar line narrows smoothly to the reference's own
    // neck at the top of the flare. A straight 8.9 cm cylinder up to the flare top met the 6 cm neck above it in a
    // step, and the shirt showed a thick white pillar under the head (user: "the head looks different").
    const yRef = rp[i * 3 + 1]!;
    const tt = Math.min(1, Math.max(0, (yRef - collarTopRef) / (flareTop - collarTopRef)));
    const allowed = NECK_R + (naturalNeckR - NECK_R) * tt * tt * (3 - 2 * tt);
    const dx = x, dz = rp[i * 3 + 2]! - neckCz, r = Math.hypot(dx, dz);
    if (r > allowed) { x = (dx / r) * allowed; tuckedZ.set(i, neckCz + (dz / r) * allowed); tucked++; }
  }
  remapR[i] = out.length / 3;
  out.push(x + shift[0]!, y, tuckedZ.has(i) ? tuckedZ.get(i)! + shift[2]! : z);
  if (k === 'arm_left') { remapMirror[i] = out.length / 3; out.push(-(x + shift[0]!), y, z); }
}
for (let t = 0; t < R.index.length; t += 3) {
  const tri = [R.index[t]!, R.index[t + 1]!, R.index[t + 2]!];
  const a = remapR[tri[0]!]!, b = remapR[tri[1]!]!, c = remapR[tri[2]!]!;
  if (a < 0 || b < 0 || c < 0) continue;
  outIndex.push(a, b, c);
  // mirrored copy of the left hand: reflection flips the winding, so two corners swap
  if (rKind[tri[0]!] === 'arm_left') outIndex.push(remapMirror[tri[0]!]!, remapMirror[tri[2]!]!, remapMirror[tri[1]!]!);
}
/**
 * Cuffs hug the wrist. The hoodie's sleeve ends in an opening of ~9.5 cm radius around a 4.5 cm wrist: the 5 cm gap
 * showed the shaded inside of the sleeve as a black band around each wrist (close-up check). When the opening is
 * more than 1.4× the wrist, the last 6 cm of the sleeve narrow smoothly to 1.2× the wrist — like the rib cuff of a
 * real hoodie. Narrower sleeves (the shirt) are left as they are.
 */
let cuffsTightened = 0;
for (const side of [1, -1]) {
  const sleeve = [...Array(nT).keys()].filter((i) => remapT[i]! >= 0 && tKind[i] === 'top' && tp[i * 3]! * side > 0);
  const P = (i: number) => remapT[i]! * 3;
  const end = Math.max(...sleeve.map((i) => out[P(i)]! * side));
  const ringIds = sleeve.filter((i) => out[P(i)]! * side > end - 0.025);
  if (!ringIds.length) continue;
  const cy = ringIds.reduce((a, i) => a + out[P(i) + 1]!, 0) / ringIds.length, cz = ringIds.reduce((a, i) => a + out[P(i) + 2]!, 0) / ringIds.length;
  const opening = Math.max(...ringIds.map((i) => Math.hypot(out[P(i) + 1]! - cy, out[P(i) + 2]! - cz)));
  // wrist radius of the inserted reference hand just outside the sleeve end
  const handVerts: number[] = [];
  for (let i = 0; i < nR; i++) {
    const m = side > 0 ? remapR[i]! : remapMirror[i]!;
    if (m >= 0 && rKind[i] === 'arm_left' && out[m * 3]! * side > end - 0.01 && out[m * 3]! * side < end + 0.015) handVerts.push(m);
  }
  if (!handVerts.length) continue;
  const wrist = Math.max(...handVerts.map((m) => Math.hypot(out[m * 3 + 1]! - cy, out[m * 3 + 2]! - cz)));
  if (opening <= wrist * 1.4) continue;
  const target = wrist * 1.2;
  for (const i of sleeve) {
    const q = P(i), d = end - out[q]! * side;
    if (d > 0.06) continue;
    const w = 1 - d / 0.06; // 0 at 6 cm in, 1 at the end
    const dy = out[q + 1]! - cy, dz = out[q + 2]! - cz, r = Math.hypot(dy, dz);
    if (r <= target) continue;
    const k = 1 - w * w * (3 - 2 * w) * (1 - target / r);
    out[q + 1] = cy + dy * k; out[q + 2] = cz + dz * k;
    cuffsTightened++;
  }
}

/**
 * The collar hugs the neck. The shirt's stand collar flares away from the neck at the back (rim 3.6–12 cm from the
 * neck axis around an 8.7 cm neck), and looking down into it showed a dark ring (close-up check). When the rim
 * stands more than 1.15× the neck radius away, its top 3 cm are pulled in smoothly to the neck + 8 mm — only where
 * it is further out than that. Hoods (the hoodie) are not collars: an outfit whose head came as its own shell keeps
 * its neckline as generated.
 */
let collarTightened = 0;
if (tuckFlare) {
  const czOut = neckCz + headShift[2]!;
  const hugR = NECK_R + 0.008;
  const rimIds = [...Array(nT).keys()].filter((i) => remapT[i]! >= 0 && tKind[i] === 'top' && Math.abs(tp[i * 3]!) < 0.14 && tp[i * 3 + 1]! > collarTop - 0.03);
  const rr = (i: number) => { const q = remapT[i]! * 3; return Math.hypot(out[q]!, out[q + 2]! - czOut); };
  if (rimIds.length && Math.max(...rimIds.map(rr)) > NECK_R * 1.15) {
    for (const i of rimIds) {
      const q = remapT[i]! * 3;
      const r = rr(i);
      if (r <= hugR) continue;
      const w = Math.min(1, Math.max(0, 1 - (collarTop - tp[i * 3 + 1]!) / 0.03)); // 1 at the rim, 0 3 cm down
      const k = 1 - w * w * (3 - 2 * w) * (1 - hugR / r);
      out[q] = out[q]! * k; out[q + 2] = czOut + (out[q + 2]! - czOut) * k;
      collarTightened++;
    }
  }
}

// reference vertices (head, hands) are marked: preparation must not symmetrise them against the clothes
const fixed: number[] = [];
for (let i = 0; i < nR; i++) { if (remapR[i]! >= 0) fixed.push(remapR[i]!); if (remapMirror[i]! >= 0) fixed.push(remapMirror[i]!); }
writeFileSync(outFile, JSON.stringify({ base: out.map((v) => Number(v.toFixed(6))), index: outIndex, fixed }));
console.log(JSON.stringify({
  target: targetId, reference: refId, vertices: out.length / 3, triangles: outIndex.length / 3,
  armSpanScale: Number(kArm.toFixed(3)), shoulderLift_cm: Number((shoulderLift * 100).toFixed(1)), collarVerticesTightened: collarTightened, neckTuckRadius_cm: Number((NECK_R * 100).toFixed(1)), collarFitRadius_cm: Number((collarFitR * 100).toFixed(1)), cuffVerticesTightened: cuffsTightened, backCover_cm: Number((backCover * 100).toFixed(1)), neckFlareTucked: tucked, necklineFront_cm: [Number((from[4]! * 100).toFixed(1)), Number((to[4]! * 100).toFixed(1))], headAnchor: headWasCut ? 'neckline' : 'own-throat', headShiftZ_cm: Number((headShift[2]! * 100).toFixed(1)), collarTop_cm: Number((collarTop * 100).toFixed(1)), neckLowered_cm: Number((neckLowered * 100).toFixed(1)), headShift_cm: headShift.map((v) => Number((v * 100).toFixed(1))),
  cuffX_cm: Object.fromEntries(Object.entries(cuffX).map(([k, v]) => [k, Number((v * 100).toFixed(1))])),
  verticesPulledInsideCuff: pulled,
}));
