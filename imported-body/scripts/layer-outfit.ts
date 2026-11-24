/**
 * Stage I-61 — a layered figure: ONE visible base and garments laid over a hidden body.
 *
 * Composing (I-50) rebuilt every outfit around the reference's head and hands, and each outfit kept its own body
 * shape: the neck, the collar and the shoulders had to be patched per outfit and never quite matched (user's
 * close-ups). Here the reference figure is the body, verbatim:
 *   • visible  — its head with the neck, both arms with the hands, both shoes: copied unchanged, identical in
 *                every figure by construction;
 *   • hidden   — its T-shirt and trousers act only as the body under the clothes (a collision proxy) and are not
 *                part of the result.
 * The garment of another outfit is aligned to the base (heights by the same knots as I-50, sleeve end to the
 * base wrist, centred in depth), then pushed OUT of the base wherever it is inside it or closer than GAP. A
 * garment is therefore never smaller than the reference body and no body part can show through it. Top and
 * bottom may come from different outfits; the top is laid over the bottom.
 *
 *   node --import tsx imported-body/scripts/layer-outfit.ts <base id> <top source id> <bottom source id> <out file>
 *   e.g. outfit01 raw-outfit03 raw-outfit03 imported-body/out/layered-outfit03.json
 *
 * IB_INNER=1 — inner layer: the base's T-shirt is part of the result (its vertices are listed as `inner`), so an
 * open neckline (a V-neck sweater, an open cardigan) shows a T-shirt under it instead of the garment's own inside.
 * The upper garment must then not cross it either; it is checked like a visible part.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { bboxOf, closestPoint, countIntersections, windingNumber, type Soup } from '../src/layers';

interface Prepared {
  base: number[];
  index: number[];
  landmarks: Record<string, number>;
  partsIndex: { kind: string; vertices: number[]; cut?: boolean }[];
}
const [baseId, topId, bottomId, outFile] = process.argv.slice(2);
if (!baseId || !topId || !bottomId || !outFile) throw new Error('usage: layer-outfit <base id> <top id> <bottom id> <out file>');
const load = (id: string) => JSON.parse(readFileSync(`imported-body/out/outfit-${id}.json`, 'utf8')) as Prepared;
const B = load(baseId);
/** distance kept between a garment and the body under it */
const GAP = 0.006;
const VISIBLE = new Set(['head', 'arm_left', 'arm_right', 'shoe_left', 'shoe_right']);
const INNER = process.env.IB_INNER === '1';
const kindOf = (p: Prepared) => {
  const k = new Array<string>(p.base.length / 3).fill('other');
  for (const part of p.partsIndex) for (const v of part.vertices) k[v] = part.kind;
  return k;
};
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bKind = kindOf(B);
const bp = Float64Array.from(B.base);
const nB = bp.length / 3;
const H = B.landmarks.height!;
const ids = (n: number, f: (i: number) => boolean) => { const r: number[] = []; for (let i = 0; i < n; i++) if (f(i)) r.push(i); return r; };
const trisOf = (index: number[], keep: (v: number) => boolean) => {
  const r: number[] = [];
  for (let t = 0; t < index.length; t += 3) if (keep(index[t]!) && keep(index[t + 1]!) && keep(index[t + 2]!)) r.push(index[t]!, index[t + 1]!, index[t + 2]!);
  return r;
};

/** same knot as I-50: the front of the neckline, not the bottom of the head shell */
function necklineFront(p: Prepared, pos: ArrayLike<number>): number {
  const kind = kindOf(p), arm = p.landmarks.armpit!;
  const top = ids(pos.length / 3, (i) => kind[i] === 'top');
  const zs = top.filter((i) => Math.abs(pos[i * 3 + 1]! - arm) < 0.03).map((i) => pos[i * 3 + 2]!);
  const zmid = (Math.min(...zs) + Math.max(...zs)) / 2;
  const front = top.filter((i) => Math.abs(pos[i * 3]!) < 0.03 && pos[i * 3 + 2]! > zmid);
  if (!front.length) throw new Error('cannot find the front of the neckline');
  return Math.max(...front.map((i) => pos[i * 3 + 1]!));
}
const reach = (pos: ArrayLike<number>, n: number) => { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(pos[i * 3]!)); return m; };
/**
 * Depth centre of a garment: the middle of its front and back surface at the centre line, from triangle–plane
 * sections at five heights in the band (median). Vertex bounding boxes were useless here: the low-poly T-shirt has
 * no vertex near the centre line for 30 cm, and the shirt came out shifted 4 cm back.
 */
const zCentre = (pos: ArrayLike<number>, index: number[], keep: (v: number) => boolean, y0: number, y1: number) => {
  const mids: number[] = [];
  for (let s = 0; s < 5; s++) {
    const y = y0 + ((y1 - y0) * (s + 0.5)) / 5;
    const zs: number[] = [];
    for (let t = 0; t < index.length; t += 3) {
      const v = [index[t]!, index[t + 1]!, index[t + 2]!];
      if (!v.every(keep)) continue;
      for (let e = 0; e < 3; e++) {
        const a = v[e]!, b = v[(e + 1) % 3]!;
        const ya = pos[a * 3 + 1]!, yb = pos[b * 3 + 1]!;
        if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
        const f = (y - ya) / (yb - ya);
        const x = pos[a * 3]! + f * (pos[b * 3]! - pos[a * 3]!);
        if (Math.abs(x) < 0.06) zs.push(pos[a * 3 + 2]! + f * (pos[b * 3 + 2]! - pos[a * 3 + 2]!));
      }
    }
    if (zs.length >= 2) mids.push((Math.min(...zs) + Math.max(...zs)) / 2);
  }
  mids.sort((a, b) => a - b);
  return mids.length ? mids[mids.length >> 1]! : NaN;
};

/** narrowest section of the base's left arm between 25 and 8 cm from the fingertips */
function baseWrist(): number {
  const tip = reach(bp, nB);
  let best = Infinity, at = tip - 0.19;
  for (let x = tip - 0.25; x <= tip - 0.08; x += 0.005) {
    const ys: number[] = [], zs: number[] = [];
    for (let t = 0; t < B.index.length; t += 3) {
      const v = [B.index[t]!, B.index[t + 1]!, B.index[t + 2]!];
      if (!v.every((i) => bKind[i] === 'arm_left')) continue;
      for (let e = 0; e < 3; e++) {
        const a = v[e]! * 3, b = v[(e + 1) % 3]! * 3;
        if ((bp[a]! - x) * (bp[b]! - x) > 0 || bp[a] === bp[b]) continue;
        const f = (x - bp[a]!) / (bp[b]! - bp[a]!);
        ys.push(bp[a + 1]! + f * (bp[b + 1]! - bp[a + 1]!)); zs.push(bp[a + 2]! + f * (bp[b + 2]! - bp[a + 2]!));
      }
    }
    if (ys.length < 3) continue;
    const size = Math.max(...ys) - Math.min(...ys) + Math.max(...zs) - Math.min(...zs);
    if (size < best) { best = size; at = x; }
  }
  return at;
}

interface Layer { p: Float64Array; tris: number[]; n: number; report: Record<string, unknown>; small?: Uint8Array }
/** vertices of shells under 60 vertices (buttons): they are carried, not pushed */
function markSmall(g: Layer) {
  const parent = Array.from({ length: g.n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let t = 0; t < g.tris.length; t += 3) { parent[find(g.tris[t]!)] = find(g.tris[t + 1]!); parent[find(g.tris[t + 1]!)] = find(g.tris[t + 2]!); }
  const size = new Map<number, number>();
  for (let i = 0; i < g.n; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  g.small = new Uint8Array(g.n);
  for (let i = 0; i < g.n; i++) if (size.get(find(i))! < 60) g.small[i] = 1;
}
/** triangle normal (not normalised) */
const triN = (p: ArrayLike<number>, a: number, b: number, c: number) => {
  const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
};

/** one garment of a source outfit, aligned to the base; vertices renumbered from 0 */
function alignedGarment(srcId: string, layer: 'top' | 'bottom'): Layer {
  const S = load(srcId);
  const sKind = kindOf(S);
  const sp = Float64Array.from(S.base);
  const nS = sp.length / 3;
  const report: Record<string, unknown> = { source: srcId };
  if (srcId !== baseId) {
    // 1. heights
    const knots = (p: Prepared, pos: ArrayLike<number>) => { const L = p.landmarks; return [0, L.ankle!, L.crotch!, L.armpit!, necklineFront(p, pos), L.height!]; };
    const from = knots(S, sp), to = knots(B, bp);
    // a deep V (women's cardigan) drops the front neckline below the armhole: that knot then says nothing about the
    // shoulders, so it is placed where the base's neckline sits between the armhole and the top of the head
    if (!(from[4]! > from[3]!)) {
      report.necklineKnot = 'below the armhole, taken from the base proportions';
      from[4] = from[3]! + ((to[4]! - to[3]!) / (to[5]! - to[3]!)) * (from[5]! - from[3]!);
    }
    for (let i = 1; i < from.length; i++) if (!(from[i]! > from[i - 1]!) || !(to[i]! > to[i - 1]!)) throw new Error(`${srcId}: landmarks out of order at knot ${i}`);
    const mapY = (y: number) => {
      for (let i = 1; i < from.length; i++) if (y <= from[i]! || i === from.length - 1) {
        const f = (y - from[i - 1]!) / (from[i]! - from[i - 1]!);
        return to[i - 1]! + f * (to[i]! - to[i - 1]!);
      }
      return y;
    };
    /**
     * A garment-only source (garment-source.ts) is already placed on THIS base and carries its landmarks; mapping its
     * own neckline onto the base's squashed the sleeve above the armpit (forearm top 1.413 → 1.378 m) and the base
     * forearm pierced it in a ring (11 crossings, shirt01).
     */
    const prealigned = (S as { prealigned?: string }).prealigned === baseId;
    if (!prealigned) for (let i = 0; i < nS; i++) sp[i * 3 + 1] = mapY(sp[i * 3 + 1]!);
    report.prealigned = prealigned;
    // 2. arm span: a long sleeve ends at the base wrist, a short one keeps its share of the arm
    if (layer === 'top') {
      const armpitY = B.landmarks.armpit!;
      let s0 = 0;
      for (let i = 0; i < nS; i++) if (sKind[i] === 'top' && Math.abs(sp[i * 3 + 1]! - (armpitY - 0.04)) < 0.015) s0 = Math.max(s0, Math.abs(sp[i * 3]!));
      /**
       * A garment-only source is placed on this base, so its trunk is as wide as the base's at the armpit. Its own
       * section there is not: a sleeve that slopes down (blazer, coat) passes through that height, and the "trunk"
       * reached 47 cm (blazer) or the cuff itself (coat: 65.7 cm = sleeve end, the sleeve was never stretched and the
       * forearm showed bare). The base's T-shirt half-width is taken instead.
       */
      if (prealigned) {
        let b0 = 0;
        for (let i = 0; i < nB; i++) if (bKind[i] === 'top' && Math.abs(bp[i * 3 + 1]! - (armpitY - 0.04)) < 0.015) b0 = Math.max(b0, Math.abs(bp[i * 3]!));
        if (b0 > 0) s0 = b0;
      }
      const sleeveEnd = Math.max(...ids(nS, (i) => sKind[i] === 'top' && sp[i * 3 + 1]! > armpitY - 0.1).map((i) => Math.abs(sp[i * 3]!)));
      const sReach = reach(sp, nS), bReach = reach(bp, nB);
      /**
       * The base wrist is MEASURED: the narrowest section of the base arm 8–25 cm from the fingertips (68 cm from the
       * centre on the reference). The anthropometric 10.8 % of stature put it at 69.6 cm, inside the base of the
       * thumb, and the hoodie's cuff crossed the hand. The sleeve ends 1 cm short of it.
       */
      const bWrist = baseWrist() - Number(process.env.IB_CUFF_GAP ?? 0.01);
      /**
       * A garment-only source has no hands, so its reach IS its sleeve end and every sleeve looked long: the polo's
       * short sleeve was stretched to the wrist. IB_SLEEVE=short (`"sleeve": "short"` in outfits.json) keeps a short
       * sleeve; on a garment-only source it keeps its own length (it is already placed on this base, k = 1).
       */
      const sleeveMode = process.env.IB_SLEEVE;
      const long = sleeveMode === 'short' ? false : sleeveMode === 'long' ? true : sReach - sleeveEnd < 0.25;
      const k = long ? (bWrist - s0) / (sleeveEnd - s0) : prealigned && sleeveMode === 'short' ? 1 : (bReach - s0) / (sReach - s0);
      for (let i = 0; i < nS; i++) {
        const ax = Math.abs(sp[i * 3]!);
        if (ax <= s0) continue;
        const w = smooth(armpitY - 0.1, armpitY - 0.04, sp[i * 3 + 1]!);
        sp[i * 3] = Math.sign(sp[i * 3]!) * (ax + w * (ax - s0) * (k - 1));
      }
      Object.assign(report, { sleeve: long ? 'long' : 'short', armScale: Number(k.toFixed(3)) });
    }
    // 3. depth: the garment centred on the base's trunk at the same height
    const band = layer === 'top' ? [B.landmarks.armpit! - 0.12, B.landmarks.armpit! - 0.04] : [B.landmarks.hip! - 0.04, B.landmarks.hip! + 0.04];
    const sIds = ids(nS, (i) => sKind[i] === layer);
    const dz = zCentre(bp, B.index, (v) => bKind[v] === layer, band[0]!, band[1]!) - zCentre(sp, S.index, (v) => sKind[v] === layer, band[0]!, band[1]!);
    if (Number.isFinite(dz)) for (const i of sIds) sp[i * 3 + 2] += dz;
    report.depthShift_cm = Number((dz * 100).toFixed(1));
  }
  const remap = new Int32Array(nS).fill(-1);
  const p: number[] = [];
  for (let i = 0; i < nS; i++) if (sKind[i] === layer) { remap[i] = p.length / 3; p.push(sp[i * 3]!, sp[i * 3 + 1]!, sp[i * 3 + 2]!); }
  const tris = trisOf(S.index, (v) => remap[v]! >= 0).map((v) => remap[v]!);
  const g: Layer = { p: Float64Array.from(p), tris, n: p.length / 3, report };
  markSmall(g);
  return g;
}

/**
 * Sleeve ends hug the wrist: an opening more than 1.4× the base wrist narrows over its last 6 cm to 1.2× (rib cuff,
 * as in I-50). The base forearm continues inside, so a wide opening would show the dark inside of the sleeve.
 */
function tightenCuffs(g: Layer) {
  let moved = 0;
  for (const side of [1, -1]) {
    const sleeve = ids(g.n, (i) => g.p[i * 3]! * side > 0.25);
    if (!sleeve.length) continue;
    const end = Math.max(...sleeve.map((i) => g.p[i * 3]! * side));
    const ring = sleeve.filter((i) => g.p[i * 3]! * side > end - 0.025);
    const cy = ring.reduce((a, i) => a + g.p[i * 3 + 1]!, 0) / ring.length, cz = ring.reduce((a, i) => a + g.p[i * 3 + 2]!, 0) / ring.length;
    const opening = Math.max(...ring.map((i) => Math.hypot(g.p[i * 3 + 1]! - cy, g.p[i * 3 + 2]! - cz)));
    // the base wrist from a SECTION of the arm at the sleeve end (a vertex band caught 3 vertices of a long forearm
    // triangle and read 2.2 cm, so the hoodie's 6.5 cm cuff was never narrowed)
    const sec: number[][] = [];
    for (let t = 0; t < B.index.length; t += 3) {
      const v = [B.index[t]!, B.index[t + 1]!, B.index[t + 2]!];
      if (!v.every((q) => bKind[q] === (side > 0 ? 'arm_left' : 'arm_right'))) continue;
      for (let e = 0; e < 3; e++) {
        const a = v[e]! * 3, b = v[(e + 1) % 3]! * 3;
        const xa = bp[a]! * side, xb = bp[b]! * side;
        if ((xa - end) * (xb - end) > 0 || xa === xb) continue;
        const f = (end - xa) / (xb - xa);
        sec.push([bp[a + 1]! + f * (bp[b + 1]! - bp[a + 1]!), bp[a + 2]! + f * (bp[b + 2]! - bp[a + 2]!)]);
      }
    }
    if (sec.length < 3) continue;
    const ay = (Math.min(...sec.map((q) => q[0]!)) + Math.max(...sec.map((q) => q[0]!))) / 2;
    const az = (Math.min(...sec.map((q) => q[1]!)) + Math.max(...sec.map((q) => q[1]!))) / 2;
    const wrist = Math.max(...sec.map((q) => Math.hypot(q[0]! - ay, q[1]! - az)));
    if (process.env.IB_DEBUG) console.error('cuff', side, 'end', end.toFixed(3), 'opening', opening.toFixed(3), 'wrist', wrist.toFixed(3), 'ring', ring.length);
    if (opening <= wrist * 1.4) continue;
    /**
     * The target follows the wrist's own outline, not a circle: the base wrist is flat (4.7 × 7.4 cm), and a round
     * cuff at 1.2× its largest radius still left 3 cm above and below it — the dark inside of the sleeve showed
     * around the hand (close-up). In each direction from the arm axis the cuff goes to the wrist's extent in that
     * direction (±25°) × 1.1 + GAP + 3 mm.
     */
    const wristAt = (ang: number) => {
      let r = 0;
      for (const q of sec) {
        let da = Math.abs(Math.atan2(q[1]! - az, q[0]! - ay) - ang);
        if (da > Math.PI) da = 2 * Math.PI - da;
        if (da < 0.44) r = Math.max(r, Math.hypot(q[0]! - ay, q[1]! - az));
      }
      return r || wrist;
    };
    for (const i of sleeve) {
      const d = end - g.p[i * 3]! * side;
      if (d > 0.06) continue;
      const w = 1 - d / 0.06;
      // towards the base arm's axis, not the sleeve's own centre: the hand comes out of the middle of the cuff
      const ccy = cy + (ay - cy) * w, ccz = cz + (az - cz) * w;
      const dy = g.p[i * 3 + 1]! - ccy, dz2 = g.p[i * 3 + 2]! - ccz, r = Math.hypot(dy, dz2);
      const target = wristAt(Math.atan2(dz2, dy)) * 1.1 + GAP + 0.003;
      if (r <= target) { g.p[i * 3 + 1] = ccy + dy; g.p[i * 3 + 2] = ccz + dz2; continue; }
      const k = 1 - w * w * (3 - 2 * w) * (1 - target / r);
      g.p[i * 3 + 1] = ccy + dy * k; g.p[i * 3 + 2] = ccz + dz2 * k;
      moved++;
    }
  }
  return moved;
}

/**
 * Body axes of the base, for the push direction. Pushing along the garment's own normals sent collar vertices up
 * through the head and hems down through the shoes (first run: 115 crossings, pushes hitting the 10 cm limit):
 * the normals of a cut, low-poly garment point anywhere at its rims. Clothes are pushed AWAY FROM THE BODY AXIS
 * instead: horizontally from the trunk/neck centre line, horizontally from the leg centre line below the crotch,
 * and in the arm's cross-section plane from the arm centre line, blended across the shoulder.
 */
const AX = (() => {
  const L = B.landmarks;
  /**
   * Surface sections, not vertex bands: the low-poly base has long triangles with no vertex near the centre line,
   * and a vertex band put the trunk axis at the front of the chest (pushes went backwards, 128 vertices stuck).
   */
  const section = (axis: 0 | 1, at: number, keep: (v: number) => boolean) => {
    const pts: number[][] = [];
    for (let t = 0; t < B.index.length; t += 3) {
      const v = [B.index[t]!, B.index[t + 1]!, B.index[t + 2]!];
      if (!v.every(keep)) continue;
      for (let e = 0; e < 3; e++) {
        const p0 = v[e]! * 3, p1 = v[(e + 1) % 3]! * 3;
        const a0 = bp[p0 + axis]!, a1 = bp[p1 + axis]!;
        if ((a0 - at) * (a1 - at) > 0 || a0 === a1) continue;
        const f = (at - a0) / (a1 - a0);
        pts.push([0, 1, 2].map((k) => bp[p0 + k]! + f * (bp[p1 + k]! - bp[p0 + k]!)));
      }
    }
    return pts;
  };
  const mid = (pts: number[][], k: number) => pts.length ? (Math.min(...pts.map((q) => q[k]!)) + Math.max(...pts.map((q) => q[k]!))) / 2 : NaN;
  const trunkZ = new Map<number, number>();
  for (let cm = Math.round(L.crotch! * 100); cm <= Math.round(H * 100); cm++) {
    const y = cm / 100;
    const pts = section(1, y, (v) => (y > L.neck_base! + 0.03 ? bKind[v] === 'head' : ['top', 'bottom', 'head'].includes(bKind[v]!))).filter((q) => Math.abs(q[0]!) < 0.12);
    trunkZ.set(cm, mid(pts, 2));
  }
  // armhole: the half-width of the base top 4 cm under the armpit
  const s0 = Math.max(...section(1, L.armpit! - 0.04, (v) => bKind[v] === 'top').map((q) => Math.abs(q[0]!)));
  const armC = new Map<number, [number, number]>();
  for (let cm = Math.floor(s0 * 100); cm <= Math.round(reach(bp, nB) * 100); cm++) {
    const pts = section(0, cm / 100, (v) => bKind[v] === 'top' || bKind[v]!.startsWith('arm')).filter((q) => q[1]! > L.armpit! - 0.15);
    armC.set(cm, [mid(pts, 1), mid(pts, 2)]);
  }
  const legC = new Map<number, [number, number]>();
  for (let cm = 0; cm <= Math.round(L.crotch! * 100) + 3; cm++) {
    const pts = section(1, cm / 100, (v) => bKind[v] === 'bottom').filter((q) => q[0]! > 0);
    legC.set(cm, [mid(pts, 0), mid(pts, 2)]);
  }
  const near = <T,>(m: Map<number, T>, cm: number, ok: (v: T) => boolean): T | null => {
    for (let d = 0; d < 40; d++) for (const c of [cm - d, cm + d]) { const v = m.get(c); if (v !== undefined && ok(v)) return v; }
    return null;
  };
  return { s0, crotch: L.crotch!, armpit: L.armpit!, trunkZ, armC, legC, near };
})();

/** unit direction away from the body axis at point (x, y, z) */
function awayFromBody(x: number, y: number, z: number): [number, number, number] {
  const ax = Math.abs(x), sx = Math.sign(x) || 1;
  let d: [number, number, number];
  if (y < AX.crotch) {
    const c = AX.near(AX.legC, Math.round(y * 100), (v) => Number.isFinite(v[0])) ?? [0.1, 0];
    d = [x - sx * c[0], 0, z - c[1]];
  } else {
    const cz = AX.near(AX.trunkZ, Math.round(y * 100), (v) => Number.isFinite(v)) ?? 0;
    const trunk: [number, number, number] = [x, 0, z - cz];
    const w = y > AX.armpit - 0.12 ? smooth(AX.s0 - 0.02, AX.s0 + 0.06, ax) : 0;
    if (w > 0) {
      const c = AX.near(AX.armC, Math.round(ax * 100), (v) => Number.isFinite(v[0])) ?? [y, z];
      const arm: [number, number, number] = [0, y - c[0], z - c[1]];
      const lt = Math.hypot(...trunk) || 1, la = Math.hypot(...arm) || 1;
      d = [trunk[0] / lt * (1 - w) + arm[0] / la * w, trunk[1] / lt * (1 - w) + arm[1] / la * w, trunk[2] / lt * (1 - w) + arm[2] / la * w];
    } else d = trunk;
  }
  const l = Math.hypot(...d);
  return l > 1e-9 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 0, 1];
}

/**
 * Pushes a garment out of the proxy (the hidden body plus whatever is under this layer), then out of surface
 * crossings with the visible parts. A vertex that is inside the proxy, or has it closer than GAP behind it, moves
 * away from the body axis to the first position that is clear; the move spreads to its neighbours so the garment
 * bulges smoothly instead of growing spikes.
 */
function pushOut(g: Layer, proxy: Soup, visible: Soup) {
  const bb = bboxOf(proxy);
  const inside = (x: number, y: number, z: number) => windingNumber(proxy, x, y, z, bb) > 0.5;
  const nbr: Set<number>[] = Array.from({ length: g.n }, () => new Set());
  for (let t = 0; t < g.tris.length; t += 3) for (let k = 0; k < 3; k++) { nbr[g.tris[t + k]!]!.add(g.tris[t + (k + 1) % 3]!); nbr[g.tris[t + (k + 1) % 3]!]!.add(g.tris[t + k]!); }
  let pushedTotal = 0, rounds = 0, maxPush = 0, stuck = 0;
  const crossPushed = new Float64Array(g.n);
  for (let round = 0; round < 25; round++) {
    rounds = round + 1;
    const dir = new Float64Array(g.n * 3);
    for (let i = 0; i < g.n; i++) dir.set(awayFromBody(g.p[i * 3]!, g.p[i * 3 + 1]!, g.p[i * 3 + 2]!), i * 3);
    const need = new Float64Array(g.n);
    let count = 0;
    stuck = 0;
    for (let i = 0; i < g.n; i++) {
      if (g.small![i]) continue;
      const x = g.p[i * 3]!, y = g.p[i * 3 + 1]!, z = g.p[i * 3 + 2]!;
      const nx = dir[i * 3]!, ny = dir[i * 3 + 1]!, nz = dir[i * 3 + 2]!;
      const clear = (t: number) => !inside(x + nx * t, y + ny * t, z + nz * t) && !inside(x + nx * (t - GAP), y + ny * (t - GAP), z + nz * (t - GAP));
      if (clear(0)) continue;
      let t = 0.002;
      while (t < 0.06 && !clear(t)) t += 0.002;
      if (t >= 0.06) {
        /**
         * The body axis is not always the way out: where the garment lies under the base's shoulder line, the
         * nearest exit is UP, through the top of the shoulder, not sideways through 15 cm of trunk. Then the
         * vertex goes towards the nearest surface of the body instead (repeated per round across overlapping
         * shells), and GAP beyond it.
         */
        const c = closestPoint(proxy, x, y, z);
        const dx = c[0]! - x, dy = c[1]! - y, dz = c[2]! - z, l = Math.hypot(dx, dy, dz) || 1;
        const u = inside(x, y, z) ? [dx / l, dy / l, dz / l] : [-dx / l, -dy / l, -dz / l];
        let t2 = 0.002;
        const clear2 = (q: number) => !inside(x + u[0]! * q, y + u[1]! * q, z + u[2]! * q) && !inside(x + u[0]! * (q - GAP), y + u[1]! * (q - GAP), z + u[2]! * (q - GAP));
        while (t2 < 0.08 && !clear2(t2)) t2 += 0.002;
        if (t2 >= 0.08) { if (process.env.IB_DEBUG) console.error("stuck2", [x, y, z, ...u, ...c].map((q) => q.toFixed(3)).join(" "), [0, 0.01, 0.02, 0.04, 0.08].map((q) => windingNumber(proxy, x + u[0]! * q, y + u[1]! * q, z + u[2]! * q).toFixed(2)).join("/")); stuck++; continue; }
        dir[i * 3] = u[0]!; dir[i * 3 + 1] = u[1]!; dir[i * 3 + 2] = u[2]!;
        t = t2;
      }
      need[i] = t; count++;
    }
    // crossings with the visible base (and the lower garment) that the vertex test misses: low-poly triangles
    /**
     * A crossing that moving a vertex does not remove (a base triangle edge through the middle of a garment face)
     * used to push the same vertices 4 mm every round: four 15 cm spikes on the first garment-only shirt. The
     * crossing push of a vertex is capped at 2 cm in total; what is left is reported as a crossing.
     */
    const hits = countIntersections({ p: g.p, tris: g.tris }, visible);
    for (const v of hits.aVerts) if (!g.small![v] && need[v]! < 0.004 && crossPushed[v]! < 0.02) { need[v] = 0.004; crossPushed[v] += 0.004; count++; }
    if (!count) break;
    pushedTotal += count;
    /**
     * The moves are smoothed as VECTORS: neighbours pushed sideways (body axis) and upwards (nearest surface, the
     * shoulder line) met in folds that showed as dark creases on the shirt's shoulders. Each vertex blends with the
     * mean move of its ring; a vertex that must move keeps at least its required distance along its own direction.
     */
    const D = new Float64Array(g.n * 3);
    for (let i = 0; i < g.n; i++) for (let k = 0; k < 3; k++) D[i * 3 + k] = dir[i * 3 + k]! * need[i]!;
    for (let it = 0; it < 6; it++) {
      const prev = Float64Array.from(D);
      for (let i = 0; i < g.n; i++) {
        if (g.small![i] || !nbr[i]!.size) continue;
        const m = [0, 0, 0];
        for (const j of nbr[i]!) for (let k = 0; k < 3; k++) m[k]! += prev[j * 3 + k]! / nbr[i]!.size;
        const q = need[i]! > 0 ? [0, 1, 2].map((k) => 0.5 * prev[i * 3 + k]! + 0.5 * m[k]!) : m.map((v) => 0.7 * v);
        if (need[i]! > 0) {
          const along = q[0]! * dir[i * 3]! + q[1]! * dir[i * 3 + 1]! + q[2]! * dir[i * 3 + 2]!;
          if (along < need[i]!) for (let k = 0; k < 3; k++) q[k]! += (need[i]! - along) * dir[i * 3 + k]!;
        }
        for (let k = 0; k < 3; k++) D[i * 3 + k] = q[k]!;
      }
    }
    for (let i = 0; i < g.n; i++) {
      if (g.small![i]) continue;
      maxPush = Math.max(maxPush, Math.hypot(D[i * 3]!, D[i * 3 + 1]!, D[i * 3 + 2]!));
      for (let k = 0; k < 3; k++) g.p[i * 3 + k] += D[i * 3 + k]!;
    }
  }
  return { pushedVertexMoves: pushedTotal, rounds, maxPush_cm: Number((maxPush * 100).toFixed(1)), stuckVertices: stuck };
}

/**
 * Squeezed triangles. Narrowing a cuff and pushing it over the wrist can squash a triangle to a sliver (one of
 * 0.003 cm² on the hoodie cuff) that any slider then turns inside out — the chest slider of that figure measured
 * ±0. Triangles flipped against the aligned garment, or squashed below 0.02 cm² (and 30 % of what they were), are
 * relaxed, and so are needles thinner than 1.5 mm that were twice as thick before (relaxing every triangle that lost 70 % of its area fought the push and narrowed the shirt's sliders): their
 * vertices and one ring around move halfway to the mean of their neighbours, then the push runs again.
 */
function relaxSquashed(g: Layer, src: Float64Array, proxy: Soup, visible: Soup) {
  const nbr: Set<number>[] = Array.from({ length: g.n }, () => new Set());
  for (let t = 0; t < g.tris.length; t += 3) for (let k = 0; k < 3; k++) { nbr[g.tris[t + k]!]!.add(g.tris[t + (k + 1) % 3]!); nbr[g.tris[t + (k + 1) % 3]!]!.add(g.tris[t + k]!); }
  let relaxed = 0, left = 0;
  for (let pass = 0; pass < 4; pass++) {
    const bad = new Set<number>();
    for (let t = 0; t < g.tris.length; t += 3) {
      const [a, b, c] = [g.tris[t]!, g.tris[t + 1]!, g.tris[t + 2]!];
      if (g.small![a]) continue;
      const A = triN(src, a, b, c), Q = triN(g.p, a, b, c);
      const la = Math.hypot(...A), lq = Math.hypot(...Q);
      if (la < 1e-12) continue;
      // flipped, or a sliver under 0.02 cm² (|cross| = 2·area) that was not one before
      // height over the longest edge: a needle (under 1.5 mm, and half of what it was) flips under any slider
      const edge = (P: ArrayLike<number>) => Math.max(...[[a, b], [b, c], [c, a]].map(([u, w]) => Math.hypot(P[u! * 3]! - P[w! * 3]!, P[u! * 3 + 1]! - P[w! * 3 + 1]!, P[u! * 3 + 2]! - P[w! * 3 + 2]!)));
      const hq = lq / edge(g.p), ha = la / edge(src);
      if (A[0]! * Q[0]! + A[1]! * Q[1]! + A[2]! * Q[2]! < 0 || (lq < 4e-6 && lq < 0.3 * la) || (hq < 0.0015 && hq < 0.5 * ha)) { bad.add(a); bad.add(b); bad.add(c); }
    }
    left = bad.size;
    if (process.env.IB_DEBUG && pass === 0) { const h: Record<string, number> = {}; for (const v of bad) { const key = `y${Math.round(g.p[v * 3 + 1]! * 20) * 5} |x|${Math.round(Math.abs(g.p[v * 3]!) * 20) * 5} z${Math.round(g.p[v * 3 + 2]! * 20) * 5}`; h[key] = (h[key] ?? 0) + 1; } console.error('squashed', JSON.stringify(h)); }
    if (!bad.size) break;
    const ring = new Set(bad);
    for (const v of bad) for (const u of nbr[v]!) ring.add(u);
    for (let it = 0; it < 3; it++) {
      const prev = Float64Array.from(g.p);
      for (const v of ring) {
        if (!nbr[v]!.size) continue;
        for (let k = 0; k < 3; k++) {
          let m = 0; for (const u of nbr[v]!) m += prev[u * 3 + k]!;
          g.p[v * 3 + k] = 0.5 * prev[v * 3 + k]! + 0.5 * (m / nbr[v]!.size);
        }
      }
    }
    relaxed += ring.size;
    pushOut(g, proxy, visible);
  }
  return { relaxedVertices: relaxed, squashedVerticesLeft: left };
}

/**
 * Small shells (buttons: 16-vertex pieces on the shirt's placket) ride on the garment instead of being pushed on
 * their own: pushed separately they collapsed and flipped (front of the shirt, 70 vertices), and left alone they
 * would sink under a front that moved forward. Each takes the mean displacement of the three nearest vertices of the
 * garment's main surface.
 */
function carrySmallShells(g: Layer, src: Float64Array) {
  const small = (i: number) => g.small![i] === 1;
  const main = ids(g.n, (i) => !small(i));
  let carried = 0;
  for (let i = 0; i < g.n; i++) {
    if (!small(i)) continue;
    const near = main.map((j) => [Math.hypot(src[j * 3]! - src[i * 3]!, src[j * 3 + 1]! - src[i * 3 + 1]!, src[j * 3 + 2]! - src[i * 3 + 2]!), j] as const)
      .sort((a, b) => a[0] - b[0]).slice(0, 3);
    for (let k = 0; k < 3; k++) g.p[i * 3 + k] = src[i * 3 + k]! + near.reduce((acc, [, j]) => acc + g.p[j * 3 + k]! - src[j * 3 + k]!, 0) / near.length;
    carried++;
  }
  return carried;
}

/**
 * Sleeves are never narrower than the base arm. A generated cuff is narrower than the low-poly forearm it lands on
 * once the sleeve is shortened to the wrist; the push then fought long arm triangles crossing the cuff faces and
 * grew teeth (first garment-only shirt: 17 crossings, 6 cm teeth). Per 1 cm along the arm, every sleeve vertex is
 * moved out to at least the arm's own extent in its direction (±25°) + GAP + 3 mm, from the arm's section centre.
 */
function floorSleeves(g: Layer) {
  let moved = 0;
  /**
   * Sections as SEGMENTS (one per arm triangle cut), every 5 mm. The low-poly forearm cuts into 6–8 points only, and
   * a ±25° cone around a sleeve vertex often held none of them: that vertex was never moved and the forearm pierced
   * the sleeve in a ring (shirt01, 22 crossings). The arm extent in a direction is where a ray from the section centre
   * leaves the polygon.
   */
  const sec = new Map<number, { c: [number, number]; segs: number[][] }>();
  const sectionAt = (X: number, side: number) => {
    const key = Math.round(X * 200) * side;
    const hit = sec.get(key);
    if (hit) return hit;
    const segs: number[][] = [];
    const arm = side > 0 ? 'arm_left' : 'arm_right';
    for (let t = 0; t < B.index.length; t += 3) {
      const v = [B.index[t]!, B.index[t + 1]!, B.index[t + 2]!];
      if (!v.every((q) => bKind[q] === arm || (bKind[q] === 'top' && bp[q * 3]! * side > 0.15))) continue;
      const cut: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = v[e]! * 3, b = v[(e + 1) % 3]! * 3, xa = bp[a]! * side, xb = bp[b]! * side;
        if ((xa - X) * (xb - X) > 0 || xa === xb) continue;
        const f = (X - xa) / (xb - xa);
        const y = bp[a + 1]! + f * (bp[b + 1]! - bp[a + 1]!);
        if (y < AX.armpit - 0.1) continue;
        cut.push(y, bp[a + 2]! + f * (bp[b + 2]! - bp[a + 2]!));
      }
      if (cut.length >= 4) segs.push(cut.slice(0, 4));
    }
    const ys = segs.flatMap((q) => [q[0]!, q[2]!]), zs = segs.flatMap((q) => [q[1]!, q[3]!]);
    const c: [number, number] = segs.length ? [(Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] : [NaN, NaN];
    const r = { c, segs };
    sec.set(key, r);
    return r;
  };
  /** farthest exit of the ray c + t·(cos a, sin a) through the section's segments */
  const exitAt = (c: [number, number], segs: number[][], a: number) => {
    const dy = Math.cos(a), dz = Math.sin(a);
    let best = 0;
    for (const q of segs) {
      const ey = q[2]! - q[0]!, ez = q[3]! - q[1]!, wy = q[0]! - c[0], wz = q[1]! - c[1];
      const den = dy * ez - dz * ey;
      if (Math.abs(den) < 1e-12) continue;
      const t = (wy * ez - wz * ey) / den, u = (wy * dz - wz * dy) / den;
      if (t > best && u >= -1e-9 && u <= 1 + 1e-9) best = t;
    }
    return best;
  };
  for (let i = 0; i < g.n; i++) {
    if (g.small![i]) continue;
    const x = g.p[i * 3]!, ax = Math.abs(x), side = Math.sign(x) || 1;
    if (ax < AX.s0 + 0.08 || g.p[i * 3 + 1]! < AX.armpit - 0.1) continue;
    const { c, segs } = sectionAt(Math.round(ax * 200) / 200, side);
    if (segs.length < 3) continue;
    const dy = g.p[i * 3 + 1]! - c[0], dz = g.p[i * 3 + 2]! - c[1], r = Math.hypot(dy, dz);
    if (r < 1e-6) continue;
    const ang = Math.atan2(dz, dy);
    let ext = 0;
    // the arm extent around this direction, ±25°, and in the neighbouring sections ±5 mm (the forearm tapers)
    for (const dx of [-0.005, 0, 0.005]) {
      const S = sectionAt(Math.round((ax + dx) * 200) / 200, side);
      if (S.segs.length < 3) continue;
      for (const da of [-0.44, -0.22, 0, 0.22, 0.44]) {
        // distance from THIS vertex's centre c to the other section's boundary point in that direction
        const e = exitAt(S.c, S.segs, ang + da);
        const py = S.c[0] + e * Math.cos(ang + da) - c[0], pz = S.c[1] + e * Math.sin(ang + da) - c[1];
        ext = Math.max(ext, (py * dy + pz * dz) / r);
      }
    }
    const need = ext + GAP + 0.003;
    if (!(ext > 0) || r >= need) continue;
    g.p[i * 3 + 1] = c[0] + (dy * need) / r; g.p[i * 3 + 2] = c[1] + (dz * need) / r;
    moved++;
  }
  return moved;
}

/**
 * Sleeves smoothed after the floor. The floor moves single vertices out to the low-poly arm, so the forearm's
 * underside became a saw of 1–2 cm teeth with sliver faces (close-up from below, shirt01). IB_SLEEVE_SMOOTH rounds
 * (default 6; garment-only sources) of Laplacian smoothing (½ towards the ring mean) on the sleeve past the armhole, each followed by the
 * floor again, so a dip is filled from its neighbours and nothing sinks into the arm.
 */
function smoothSleeves(g: Layer) {
  const nb: number[][] = Array.from({ length: g.n }, () => []);
  for (let t = 0; t < g.tris.length; t += 3) for (let k = 0; k < 3; k++) { const a = g.tris[t + k]!, b = g.tris[t + (k + 1) % 3]!; nb[a]!.push(b); nb[b]!.push(a); }
  const on = (i: number) => !g.small![i] && Math.abs(g.p[i * 3]!) > AX.s0 + 0.06 && g.p[i * 3 + 1]! > AX.armpit - 0.1;
  const rounds = Number(process.env.IB_SLEEVE_SMOOTH ?? 6);
  // the cuff's open edge (edges of one face only): cut across slanted faces, it zigzags in x by 1–2 cm with a hook at
  // the bottom; its vertices are also smoothed along the arm, over their edge neighbours only
  const edgeUse = new Map<string, number>();
  for (let t = 0; t < g.tris.length; t += 3) for (let k = 0; k < 3; k++) { const a = g.tris[t + k]!, b = g.tris[t + (k + 1) % 3]!; const key = a < b ? `${a},${b}` : `${b},${a}`; edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1); }
  const rim: number[][] = Array.from({ length: g.n }, () => []);
  for (const [key, c] of edgeUse) if (c === 1) { const [a, b] = key.split(',').map(Number) as [number, number]; if (Math.abs(g.p[a * 3]!) > 0.5 && Math.abs(g.p[b * 3]!) > 0.5) { rim[a]!.push(b); rim[b]!.push(a); } }
  for (let r = 0; r < rounds; r++) {
    const q = Float64Array.from(g.p);
    for (let i = 0; i < g.n; i++) if (rim[i]!.length) for (const k of [0, 1, 2]) q[i * 3 + k] = 0.5 * g.p[i * 3 + k]! + 0.5 * rim[i]!.reduce((u, j) => u + g.p[j * 3 + k]!, 0) / rim[i]!.length;
    g.p.set(q);
    for (let i = 0; i < g.n; i++) {
      if (!on(i) || !nb[i]!.length || rim[i]!.length) continue;
      // y and z only: the sleeve keeps its length and the cuff stays at the wrist
      for (const k of [1, 2]) q[i * 3 + k] = 0.5 * g.p[i * 3 + k]! + 0.5 * nb[i]!.reduce((u, j) => u + g.p[j * 3 + k]!, 0) / nb[i]!.length;
    }
    g.p.set(q);
    floorSleeves(g);
  }
  return rounds;
}

/**
 * The collar hugs the base neck. A shirt that came fused to its own head (I-47) lost the top of its stand collar
 * with that head, and what is left flares away from the neck: looking down into it showed a dark ring between
 * collar and neck (close-up from above). Its top 3 cm are pulled towards the neck axis down to the base neck
 * radius + GAP + 4 mm, smoothly (full at the rim, nothing 3 cm lower). Hoods and collars that came with a
 * separate head are left as generated. The push that follows keeps the collar outside the neck.
 */
function hugCollar(g: Layer, srcId: string) {
  const S = load(srcId);
  if (!S.partsIndex.some((p) => p.kind === 'head' && p.cut)) return 0;
  let collarTop = -Infinity;
  for (let i = 0; i < g.n; i++) if (!g.small![i] && Math.abs(g.p[i * 3]!) < 0.09) collarTop = Math.max(collarTop, g.p[i * 3 + 1]!);
  const neckR = (y: number, cz: number) => {
    let r = 0;
    for (let t = 0; t < B.index.length; t += 3) {
      const v = [B.index[t]!, B.index[t + 1]!, B.index[t + 2]!];
      if (!v.every((i) => bKind[i] === 'head')) continue;
      for (let e = 0; e < 3; e++) {
        const a = v[e]! * 3, b = v[(e + 1) % 3]! * 3;
        if ((bp[a + 1]! - y) * (bp[b + 1]! - y) > 0 || bp[a + 1] === bp[b + 1]) continue;
        const f = (y - bp[a + 1]!) / (bp[b + 1]! - bp[a + 1]!);
        r = Math.max(r, Math.hypot(bp[a]! + f * (bp[b]! - bp[a]!), bp[a + 2]! + f * (bp[b + 2]! - bp[a + 2]!) - cz));
      }
    }
    return r;
  };
  let moved = 0;
  for (let i = 0; i < g.n; i++) {
    const x = g.p[i * 3]!, y = g.p[i * 3 + 1]!, z = g.p[i * 3 + 2]!;
    if (g.small![i] || Math.abs(x) > 0.14 || y < collarTop - 0.03) continue;
    const cz = AX.near(AX.trunkZ, Math.round(y * 100), (v) => Number.isFinite(v)) ?? 0;
    const nr = neckR(y, cz);
    if (!(nr > 0)) continue;
    const target = nr + GAP + 0.004, r = Math.hypot(x, z - cz);
    if (r <= target) continue;
    const w = smooth(collarTop - 0.03, collarTop, y);
    const k = 1 - w * (1 - target / r);
    g.p[i * 3] = x * k; g.p[i * 3 + 2] = cz + (z - cz) * k;
    moved++;
  }
  return moved;
}

/** what is left inside or crossing after the push (must be zero; also re-checked on the prepared figure) */
function residual(g: Layer, proxy: Soup, visible: Soup) {
  const bb = bboxOf(proxy);
  let inside = 0;
  for (let i = 0; i < g.n; i++) if (windingNumber(proxy, g.p[i * 3]!, g.p[i * 3 + 1]!, g.p[i * 3 + 2]!, bb) > 0.5) inside++;
  const ci = countIntersections({ p: g.p, tris: g.tris }, visible);
  if (process.env.IB_DEBUG) { const cv = countIntersections(visible, { p: g.p, tris: g.tris }); console.error('visible verts', [...cv.aVerts].map((v) => [0, 1, 2].map((k) => visible.p[v * 3 + k]!.toFixed(3)).join(',') + (v < bKind.length ? ':' + bKind[v] : ':bottom')).join(' | ')); }
  if (process.env.IB_DEBUG) console.error('crossing verts', [...ci.aVerts].map((v) => [0, 1, 2].map((k) => g.p[v * 3 + k]!.toFixed(3)).join(',')).join(' | '));
  return { verticesInsideBody: inside, crossingsWithVisible: ci.crossings };
}

// base soups (all in the base's own vertex numbering)
const baseTris = (keep: (k: string) => boolean) => trisOf(B.index, (v) => keep(bKind[v]!));
const visibleTris = baseTris((k) => VISIBLE.has(k));

/**
 * Lower garment: over the base's trousers. The shoes are NOT an obstacle for it: on every generated figure the
 * trouser leg goes into the shoe (hem 5.6 cm below the shoe top on the reference itself), and pushing the hem out
 * of the shoe blew it up around the foot (39 crossings left on the hoodie outfit). The trouser leg is only kept at
 * least as wide as the reference's, which already covers the top of the shoe.
 */
const bottom = alignedGarment(bottomId, 'bottom');
const bottomProxy: Soup = { p: bp, tris: baseTris((k) => k === 'bottom') };
const bottomVisible: Soup = { p: bp, tris: [] };
const bottomSrc = Float64Array.from(bottom.p);
const bottomPush = bottomId === baseId ? null : pushOut(bottom, bottomProxy, bottomVisible);
const bottomRelax = bottomId === baseId ? null : relaxSquashed(bottom, bottomSrc, bottomProxy, bottomVisible);
const bottomCarried = bottomId === baseId ? 0 : carrySmallShells(bottom, bottomSrc);
const bottomLeft = residual(bottom, bottomProxy, bottomVisible);

// upper garment: over the whole base and over the lower garment (merged into one soup)
const top = alignedGarment(topId, 'top');
const topSrc = Float64Array.from(top.p);
/** IB_DEBUG: the largest offset of a top vertex from the mean of its ring after each step (spike hunting) */
let spikeVis: Soup | null = { p: bp, tris: visibleTris };
const spike = (label: string) => {
  if (!process.env.IB_DEBUG) return;
  const s: number[][] = Array.from({ length: top.n }, () => [0, 0, 0, 0]);
  for (let t = 0; t < top.tris.length; t += 3) for (let k = 0; k < 3; k++) { const a = top.tris[t + k]!, b = top.tris[t + (k + 1) % 3]!; for (let q = 0; q < 3; q++) { s[a]![q]! += top.p[b * 3 + q]!; s[b]![q]! += top.p[a * 3 + q]!; } s[a]![3]!++; s[b]![3]!++; }
  let best = 0, at = 0;
  for (let i = 0; i < top.n; i++) { const c = s[i]!; if (!c[3]) continue; const d = Math.hypot(top.p[i * 3]! - c[0]! / c[3]!, top.p[i * 3 + 1]! - c[1]! / c[3]!, top.p[i * 3 + 2]! - c[2]! / c[3]!); if (d > best) { best = d; at = i; } }
  console.error('spike', label, (best * 100).toFixed(1), 'cm at', [0, 1, 2].map((q) => top.p[at * 3 + q]!.toFixed(3)).join(','));
  if (spikeVis) {
    const ci = countIntersections({ p: top.p, tris: top.tris }, spikeVis);
    const bins: Record<string, number> = {};
    for (const v of ci.aVerts) { const k = `|x|${Math.round(Math.abs(top.p[v * 3]!) * 20) * 5} y${Math.round(top.p[v * 3 + 1]! * 20) * 5}`; bins[k] = (bins[k] ?? 0) + 1; }
    console.error('  crossings', ci.crossings, JSON.stringify(bins));
  }
  for (const x0 of [0.58, 0.61, 0.64]) { const ys: number[] = []; for (let i = 0; i < top.n; i++) if (top.p[i * 3]! >= x0 && top.p[i * 3]! < x0 + 0.03) ys.push(top.p[i * 3 + 1]!); if (ys.length) console.error('  x', x0, 'y', Math.min(...ys).toFixed(3), Math.max(...ys).toFixed(3), ys.length); }
};
spike('aligned');
const cuffs = topId === baseId || process.env.IB_NO_CUFF ? 0 : tightenCuffs(top);
spike('cuffs');
const sleevesFloored = topId === baseId || process.env.IB_NO_FLOOR ? 0 : floorSleeves(top);
// only for a garment-only source (subdivided, dense): on a low-poly figure's own sleeve it pulled the cuff into the wrist (outfit03, 4 crossings)
if (topId !== baseId && top.report.prealigned) smoothSleeves(top);
spike('floor');
const collarHugged = topId === baseId ? 0 : hugCollar(top, topId);
/**
 * Collar clearance (I-70, jacket and blazer): their collar base is narrower than where the mannequin's neck widens
 * into the shoulders (the base head part reaches |x| 11.6 cm at 147 cm), and the long collar triangles cross it even
 * after the per-vertex push. With IB_COLLAR_CLEAR=1 (`"collarClear": true`) each top vertex above 145 cm near the neck
 * is moved out from the neck axis to the largest neck radius within ±2 cm of its height and ±1 of 24 directions,
 * plus 1 cm; faces whose centre is still inside the neck (chords across it) are dropped — they are inside the head.
 */
let collarCleared = 0, collarChords = 0;
const COLLAR_MARGIN = Number(process.env.IB_COLLAR_MARGIN ?? 0.01);
function clearCollar(smoothRounds: number) {
  const needAt = new Map<number, [number, number]>();
  const Y0 = 1.44, NY = 30, NA = 24;
  const rad = new Float64Array(NY * NA), cz = new Float64Array(NY);
  for (let h = 0; h < NY; h++) {
    // the head is low-poly: its section is a few long segments, so the radius per direction is where a ray from
    // the neck axis meets them, not the nearest section point (most of 24 directions had none)
    const y = Y0 + h * 0.01, segs: number[][] = [];
    for (let t = 0; t < B.index.length; t += 3) {
      const v = [B.index[t]!, B.index[t + 1]!, B.index[t + 2]!];
      if (!v.every((i) => bKind[i] === 'head')) continue;
      const pts: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = v[e]! * 3, b = v[(e + 1) % 3]! * 3;
        if ((bp[a + 1]! - y) * (bp[b + 1]! - y) > 0 || bp[a + 1] === bp[b + 1]) continue;
        const f = (y - bp[a + 1]!) / (bp[b + 1]! - bp[a + 1]!);
        pts.push(bp[a]! + f * (bp[b]! - bp[a]!), bp[a + 2]! + f * (bp[b + 2]! - bp[a + 2]!));
      }
      if (pts.length >= 4) segs.push(pts.slice(0, 4));
    }
    if (!segs.length) continue;
    const zs = segs.flatMap((q) => [q[1]!, q[3]!]);
    cz[h] = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (let k = 0; k < NA; k++) {
      for (const da of [0.25, 0.5, 0.75]) {
        const ang = ((k + da) / NA) * 2 * Math.PI - Math.PI, dx = Math.cos(ang), dz = Math.sin(ang);
        for (const [x1, z1, x2, z2] of segs) {
          // ray (0, cz) + s·(dx, dz) against segment (x1, z1)–(x2, z2)
          const ex = x2! - x1!, ez = z2! - z1!, den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-12) continue;
          const wx = x1!, wz = z1! - cz[h]!;
          const sRay = (wx * ez - wz * ex) / den, u = (wx * dz - wz * dx) / den;
          if (sRay > 0 && u >= 0 && u <= 1) rad[h * NA + k] = Math.max(rad[h * NA + k]!, sRay);
        }
      }
    }
  }
  for (let i = 0; i < top.n; i++) {
    const x = top.p[i * 3]!, y = top.p[i * 3 + 1]!, z = top.p[i * 3 + 2]!;
    if (y < 1.45 || Math.abs(x) > 0.16) continue;
    const h0 = Math.round((y - Y0) / 0.01);
    if (h0 < 0 || h0 >= NY) continue;
    const c = cz[h0]!, r = Math.hypot(x, z - c);
    if (r < 1e-6) continue;
    const k0 = Math.floor(((Math.atan2(z - c, x) + Math.PI) / (2 * Math.PI)) * NA) % NA;
    let need = 0;
    for (let h = Math.max(0, h0 - 2); h <= Math.min(NY - 1, h0 + 2); h++) for (const dk of [-1, 0, 1]) need = Math.max(need, rad[h * NA + ((k0 + dk + NA) % NA)]!);
    if (!(need > 0)) continue;
    needAt.set(i, [need + COLLAR_MARGIN, c]);
    if (r >= need + COLLAR_MARGIN) continue;
    const s = (need + COLLAR_MARGIN) / r;
    top.p[i * 3] = x * s; top.p[i * 3 + 2] = c + (z - c) * s;
    collarCleared++;
  }
  /**
   * Every vertex took the radius of its own direction and height, so the collar came out crumpled (jacket stand collar,
   * close-up). A few rounds of neighbour averaging over the collar smooth it; after each round a vertex that went back
   * inside its neck radius is put on it again.
   */
  const nb = new Map<number, Set<number>>();
  for (let t = 0; t < top.tris.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = top.tris[t + e]!, b = top.tris[t + (e + 1) % 3]!;
    if (!needAt.has(a) || !needAt.has(b)) continue;
    if (!nb.has(a)) nb.set(a, new Set()); if (!nb.has(b)) nb.set(b, new Set());
    nb.get(a)!.add(b); nb.get(b)!.add(a);
  }
  for (let round = 0; round < smoothRounds; round++) {
    const q = Float64Array.from(top.p);
    for (const [i, ns] of nb) {
      for (const k of [0, 1, 2]) q[i * 3 + k] = 0.5 * top.p[i * 3 + k]! + 0.5 * [...ns].reduce((u, j) => u + top.p[j * 3 + k]!, 0) / ns.size;
      const [need, c] = needAt.get(i)!, r = Math.hypot(q[i * 3]!, q[i * 3 + 2]! - c);
      if (r < need && r > 1e-6) { q[i * 3] = q[i * 3]! * need / r; q[i * 3 + 2] = c + (q[i * 3 + 2]! - c) * need / r; }
    }
    top.p.set(q);
  }
  // chords: faces that run across the neck from one side of the collar to the other (jacket: side of the collar to
  // the back centre) lie inside the head and cross it whatever the radius of their vertices; they cannot be seen
  const keep: number[] = [];
  for (let t = 0; t < top.tris.length; t += 3) {
    const v = [top.tris[t]!, top.tris[t + 1]!, top.tris[t + 2]!];
    const x = (top.p[v[0]! * 3]! + top.p[v[1]! * 3]! + top.p[v[2]! * 3]!) / 3;
    const y = (top.p[v[0]! * 3 + 1]! + top.p[v[1]! * 3 + 1]! + top.p[v[2]! * 3 + 1]!) / 3;
    const z = (top.p[v[0]! * 3 + 2]! + top.p[v[1]! * 3 + 2]! + top.p[v[2]! * 3 + 2]!) / 3;
    const h = Math.round((y - Y0) / 0.01);
    if (h >= 0 && h < NY && Math.abs(x) < 0.16 && cz[h] !== 0) {
      const k = Math.floor(((Math.atan2(z - cz[h]!, x) + Math.PI) / (2 * Math.PI)) * NA) % NA;
      if (Math.hypot(x, z - cz[h]!) < rad[h * NA + k]!) { collarChords++; continue; }
    }
    keep.push(...v);
  }
  top.tris.length = 0; top.tris.push(...keep);
}
if (topId !== baseId && process.env.IB_COLLAR_CLEAR === '1') clearCollar(Number(process.env.IB_COLLAR_SMOOTH ?? 20));
const merged = (a: Float64Array, aTris: number[], b: Layer): Soup => {
  const p = new Float64Array(a.length + b.p.length);
  p.set(a); p.set(b.p, a.length);
  const off = a.length / 3;
  return { p, tris: [...aTris, ...b.tris.map((v) => v + off)] };
};
const topProxy = merged(bp, baseTris((k) => k !== 'other'), bottom);
const innerTris = INNER ? baseTris((k) => k === 'top') : [];
/**
 * The inner T-shirt is written narrower than the base (SHRINK below, about its own centre); the upper garment is
 * pushed off and checked against it as it is written, not as it was before (jacket: 7 crossings with the unshrunk
 * T-shirt at 91–115 cm, 0 with the one in the figure).
 */
const SHRINK = Number(process.env.IB_INNER_SHRINK ?? 0.94);
const innerSet = new Set(innerTris);
const innerCz = innerSet.size ? [...innerSet].reduce((acc, v) => acc + bp[v * 3 + 2]!, 0) / innerSet.size : 0;
const bpInner = Float64Array.from(bp);
if (SHRINK !== 1) for (const v of innerSet) { bpInner[v * 3] = bp[v * 3]! * SHRINK; bpInner[v * 3 + 2] = innerCz + (bp[v * 3 + 2]! - innerCz) * SHRINK; }
const topVisible = merged(bpInner, INNER ? [...visibleTris, ...innerTris] : visibleTris, bottom);
const topPush = topId === baseId ? null : pushOut(top, topProxy, topVisible);
spikeVis = topVisible;
spike('push');
const topRelax = topId === baseId ? null : relaxSquashed(top, topSrc, topProxy, topVisible);
spike('relax');
const topCarried = topId === baseId ? 0 : carrySmallShells(top, topSrc);
// again after the push and relaxation: the relaxation smooths the collar back towards the neck
if (topId !== baseId && process.env.IB_COLLAR_CLEAR === '1') clearCollar(0);
const topLeft = residual(top, topProxy, topVisible);

// result: visible base verbatim (+ its T-shirt as the inner layer) + lower garment + upper garment
const out: number[] = [], outIndex: number[] = [], fixed: number[] = [], inner: number[] = [];
const remapB = new Int32Array(nB).fill(-1);
for (let i = 0; i < nB; i++) {
  const isInner = INNER && bKind[i] === 'top';
  if (!VISIBLE.has(bKind[i]!) && !isInner) continue;
  remapB[i] = out.length / 3; fixed.push(remapB[i]!); if (isInner) inner.push(remapB[i]!);
  out.push(bp[i * 3]!, bp[i * 3 + 1]!, bp[i * 3 + 2]!);
}
for (const v of visibleTris) outIndex.push(remapB[v]!);
/**
 * The inner T-shirt is subdivided (IB_INNER_SUBDIV rounds of 1 → 4, default 2; I-70). The sliders scale every
 * height by its own factor, so a surface bends, but a triangle stays flat: the base T-shirt's faces are up to 23 cm
 * tall, their middles lagged behind the bent garment 6 mm outside, and the T-shirt came through the zip hoodie
 * (check-outfit: 31 crossings at chest −1). The shape at rest is unchanged — new vertices lie on the old faces.
 * The T-shirt is its own shell, so splitting its edges leaves no crack against another part.
 */
let innerIdx = innerTris.map((v) => remapB[v]!);
for (let round = 0; round < Number(process.env.IB_INNER_SUBDIV ?? 2); round++) {
  const mid = new Map<string, number>(), next: number[] = [];
  const m = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let v = mid.get(key);
    if (v === undefined) {
      v = out.length / 3; for (let k = 0; k < 3; k++) out.push((out[a * 3 + k]! + out[b * 3 + k]!) / 2);
      mid.set(key, v); fixed.push(v); inner.push(v);
    }
    return v;
  };
  for (let t = 0; t < innerIdx.length; t += 3) {
    const a = innerIdx[t]!, b = innerIdx[t + 1]!, c = innerIdx[t + 2]!, ab = m(a, b), bc = m(b, c), ca = m(c, a);
    next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  innerIdx = next;
}
/**
 * …and shrunk horizontally about the trunk axis by IB_INNER_SHRINK (default 0.94: about 1 cm at the waist). Only its
 * opening (the V of a sweater, the open front of a cardigan or a zip hoodie) is ever seen, and there a centimetre is
 * invisible; but it is the slack the sliders need: at a 6 mm gap the sweater's back already touched it at rest
 * (12 crossings) and every slider made it worse. An offset along the normals was tried first and creased the
 * low-poly T-shirt at its side edges (25–56 flipped triangles at the waist slider); a scaling cannot fold anything.
 * Its sleeves get shorter by the same share, under the garment's sleeves.
 */
if (SHRINK !== 1 && inner.length) {
  for (const v of inner) { out[v * 3] = out[v * 3]! * SHRINK; out[v * 3 + 2] = innerCz + (out[v * 3 + 2]! - innerCz) * SHRINK; }
}
outIndex.push(...innerIdx);
// the upper garment's vertices (I-70): prepare-outfit labels its shells 'top' by this, not by height — the coat
// reaches below the crotch and was labelled as trousers
const upper: number[] = [];
for (const g of [bottom, top]) {
  const off = out.length / 3;
  for (let i = 0; i < g.p.length; i++) out.push(g.p[i]!);
  for (const v of g.tris) outIndex.push(v + off);
  if (g === top && topId !== baseId) for (let i = 0; i < g.n; i++) upper.push(off + i);
}
writeFileSync(outFile, JSON.stringify({ base: out.map((v) => Number(v.toFixed(6))), index: outIndex, fixed, ...(INNER ? { inner } : {}), ...(upper.length ? { upper } : {}) }));
const result = {
  base: baseId, innerLayer: INNER, top: top.report, bottom: bottom.report, vertices: out.length / 3, triangles: outIndex.length / 3,
  cuffVerticesTightened: cuffs, sleeveVerticesFloored: sleevesFloored, collarVerticesHugged: collarHugged, collarVerticesCleared: collarCleared, collarChordFacesDropped: collarChords, bottomPush, topPush, bottomRelax, topRelax, smallShellVerticesCarried: bottomCarried + topCarried, bottomResidual: bottomLeft, topResidual: topLeft,
};
console.log(JSON.stringify(result));
/**
 * Blocking: no surface of a garment may cross a VISIBLE part (head, arms, shoes) or the lower garment — that is
 * what would show as skin or trousers through the cloth. Garment vertices left inside the HIDDEN body (the base's
 * own T-shirt and trousers, never drawn) cannot show; they are the garment's internal pieces (the stump of a fused
 * neck inside the base neck, the crotch seam) and are only limited to 2 % of the garment.
 */
const crossings = bottomLeft.crossingsWithVisible + topLeft.crossingsWithVisible;
const insideShare = (bottomLeft.verticesInsideBody + topLeft.verticesInsideBody) / (bottom.n + top.n);
if (crossings || insideShare > 0.02) {
  console.error(`FAIL: crossings with visible parts ${crossings}, vertices inside the hidden body ${(insideShare * 100).toFixed(1)} %`);
  process.exit(1);
}
