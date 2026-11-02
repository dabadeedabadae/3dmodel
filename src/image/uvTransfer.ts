/**
 * Stage 10 — photo -> UV texture, piecewise affine over the template's own
 * triangles.
 *
 * 1. `imageCorrespondence` gives every geometry vertex of the VISIBLE islands
 *    (front panel incl. yoke, front half of each sleeve) an image position
 *    built from the confirmed landmarks and the mask edges. Back-facing
 *    vertices (back panel, back half of sleeves, collar) get NaN.
 * 2. `transferToUV` rasterises each fully-visible triangle into the atlas:
 *    for every texel, barycentric -> image point -> bilinear sample, masked
 *    by the confirmed mask. Texels outside the mask or in non-visible islands
 *    are left transparent; `fillBase` paints them with the base colour and
 *    reports which islands are conditional (not reconstructed from the photo).
 *
 * No homography "for the whole shirt": the warp is per template triangle, so
 * the front panel's taper and the sleeves are handled separately. Folds are
 * not removed. Sides: the photo is a FRONT view, so image-right is the
 * wearer's LEFT (+X), which is exactly how the template columns increase.
 */
import type { Landmark } from '../domain/types';
import type { RasterImage } from './raster';
import type { IslandName, TShirtMesh } from '../templates/tshirt/buildTShirt';
import { M } from '../templates/tshirt/rows';
import type { TShirtLandmarkName } from '../shape/landmarks';

type Pts = Record<TShirtLandmarkName, Landmark>;
interface P {
  x: number;
  y: number;
}
const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** quadratic bezier through control point c (passes near, not through, c) */
function bez(a: P, c: P, b: P, t: number): P {
  const u = 1 - t;
  // control point raised so the curve passes through c at t=0.5
  const cc = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
  return { x: u * u * a.x + 2 * u * t * cc.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cc.y + t * t * b.y };
}

/** leftmost / rightmost mask pixel on row y scanning outward from the centre x */
function maskEdges(mask: Uint8Array, width: number, height: number, y: number, cx: number): { left: number; right: number } | null {
  const yy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const row = yy * width;
  let c = Math.max(0, Math.min(width - 1, Math.round(cx)));
  if (!mask[row + c]) {
    // find nearest mask pixel on this row
    let best = -1;
    for (let d = 1; d < width; d++) {
      if (c - d >= 0 && mask[row + c - d]) {
        best = c - d;
        break;
      }
      if (c + d < width && mask[row + c + d]) {
        best = c + d;
        break;
      }
    }
    if (best < 0) return null;
    c = best;
  }
  let l = c,
    r = c;
  while (l > 0 && mask[row + l - 1]) l--;
  while (r < width - 1 && mask[row + r + 1]) r++;
  return { left: l, right: r };
}

export interface Correspondence {
  /** image x,y per geometry vertex; NaN when not visible in the photo */
  xy: Float32Array;
  visibleIslands: IslandName[];
  conditionalIslands: IslandName[];
  /** triangles (index triples) drawn, for the diagnostic overlay */
  triangles: number[];
}

/**
 * Build image positions for the mesh vertices. The mesh must be `tshirt-basic` (its column/row
 * conventions are used). Rows: 0 hem, 1 waist, 2 chest, 3 armpit, 4 mid-armhole, 5 shoulder, 6 neck.
 */
export function imageCorrespondence(mesh: TShirtMesh, pts: Pts, mask: Uint8Array, width: number, height: number): Correspondence {
  const vCount = mesh.geometry.attributes.position!.count;
  const xy = new Float32Array(vCount * 2).fill(NaN);
  const L = mesh.logicalIndex;
  const NECK_ROW = 6,
    COLLAR_ROW = 7;
  // image-space anchors (front view: template +X = image right)
  const hemL = pts.hem_left,
    hemR = pts.hem_right;
  const apL = pts.armpit_left,
    apR = pts.armpit_right;
  const shL = pts.shoulder_left,
    shR = pts.shoulder_right;
  const nkL = pts.neck_left,
    nkR = pts.neck_right,
    nkB = pts.neck_bottom;
  const hemY = (hemL.y + hemR.y) / 2;
  const apY = (apL.y + apR.y) / 2;
  const shY = (shL.y + shR.y) / 2;
  const R = hemY - apY; // length below the armpit in the photo
  const cx = (hemL.x + hemR.x + apL.x + apR.x) / 4;
  // row y at the centre line (mirrors rows.ts fractions: row1 = 0.38 R above hem, row2 = 0.78 R above hem)
  const rowCentreY = [hemY, hemY - 0.38 * R, hemY - 0.78 * R, apY, (apY + shY) / 2, shY];
  // row edges: below the armpit from the mask, above it along the armhole seam (armpit -> shoulder)
  const edgesAt = (row: number): { left: P; right: P } => {
    if (row <= 3) {
      const y = rowCentreY[row]!;
      const fallbackL = lerp(hemL, apL, row === 0 ? 0 : row === 1 ? 0.38 : row === 2 ? 0.78 : 1);
      const fallbackR = lerp(hemR, apR, row === 0 ? 0 : row === 1 ? 0.38 : row === 2 ? 0.78 : 1);
      if (row === 0) return { left: hemL, right: hemR };
      if (row === 3) return { left: apL, right: apR };
      const e = maskEdges(mask, width, height, y, cx);
      if (!e) return { left: fallbackL, right: fallbackR };
      // guard against the sleeve cuff hanging below the armpit: keep the edge within 12 % of the straight side line
      const tol = 0.12 * (hemR.x - hemL.x);
      const left = Math.abs(e.left - fallbackL.x) < tol ? { x: e.left, y } : { x: fallbackL.x, y };
      const right = Math.abs(e.right - fallbackR.x) < tol ? { x: e.right, y } : { x: fallbackR.x, y };
      return { left, right };
    }
    if (row === 4) return { left: lerp(apL, shL, 0.5), right: lerp(apR, shR, 0.5) };
    return { left: shL, right: shR };
  };
  const gridPoint = (row: number, col: number): P => {
    const theta = (2 * Math.PI * col) / M;
    const t = (Math.sin(theta) + 1) / 2; // 0 at col 12 (image left), 1 at col 4 (image right)
    if (row === NECK_ROW) {
      // neck ring front half: col 12 -> neck_left(image), col 0 -> neck_bottom, col 4 -> neck_right(image)
      return bez(nkL, nkB, nkR, t);
    }
    const e = edgesAt(row);
    return lerp(e.left, e.right, t);
  };
  const frontCols = new Set([12, 13, 14, 15, 0, 1, 2, 3, 4]);
  // front island: use island vertex list to know which geometry vertices belong to it
  const islands = new Map(mesh.islands.map((i) => [i.name, i]));
  const front = islands.get('front')!;
  for (const v of front.vertices) {
    const l = L[v]!;
    const row = Math.floor(l / M);
    const col = l % M;
    if (row > NECK_ROW || !frontCols.has(col)) continue;
    const p = gridPoint(row, col);
    xy[v * 2] = p.x;
    xy[v * 2 + 1] = p.y;
  }
  // sleeves: ring 0 = armhole loop (logical grid ids), rings 1..2 = sleeve ids; m order from the loop:
  // m=0 underarm, 1..3 back, 4 top, 5..7 front. Visible front half: m = 4..8 (8 = seam duplicate of 0).
  const sleeveLogicalBase = (COLLAR_ROW + 1) * M;
  for (const side of ['left', 'right'] as const) {
    const isl = islands.get(side === 'left' ? 'sleeve_left' : 'sleeve_right')!;
    // wearer left = +X = image RIGHT
    const sh = side === 'left' ? shR : shL;
    const ap = side === 'left' ? apR : apL;
    const ct = side === 'left' ? pts.cuff_right_top : pts.cuff_left_top;
    const cb = side === 'left' ? pts.cuff_right_bottom : pts.cuff_left_bottom;
    const verts = isl.vertices; // pushed ring by ring, m = 0..8 each (9 per ring)
    for (let k = 0; k < 3; k++) {
      for (let m = 0; m <= 8; m++) {
        const v = verts[k * 9 + m]!;
        if (m >= 1 && m <= 3) continue; // back half: not visible
        const phi = ((m - 4) / 4) * Math.PI; // m=4 -> 0 (top), m=8 -> pi (bottom)
        const t = (1 - Math.cos(phi)) / 2;
        const top = k === 0 ? sh : k === 1 ? lerp(sh, ct, 0.5) : ct;
        const bot = k === 0 ? ap : k === 1 ? lerp(ap, cb, 0.5) : cb;
        const p = lerp(top, bot, t);
        xy[v * 2] = p.x;
        xy[v * 2 + 1] = p.y;
      }
    }
  }
  void sleeveLogicalBase;
  // triangles with all three vertices visible
  const idx = mesh.geometry.index!.array;
  const triangles: number[] = [];
  const visibleIslands = new Set<IslandName>();
  for (const isl of mesh.islands) {
    let any = false;
    for (let t = isl.indexStart; t < isl.indexStart + isl.indexCount; t += 3) {
      const a = idx[t]!,
        b = idx[t + 1]!,
        c = idx[t + 2]!;
      if (Number.isNaN(xy[a * 2]) || Number.isNaN(xy[b * 2]) || Number.isNaN(xy[c * 2])) continue;
      triangles.push(a, b, c);
      any = true;
    }
    if (any) visibleIslands.add(isl.name);
  }
  const conditionalIslands = mesh.islands.map((i) => i.name).filter((n) => n === 'back' || n === 'collar');
  return { xy, visibleIslands: [...visibleIslands], conditionalIslands, triangles };
}

export interface TransferResult {
  size: number;
  /** RGBA atlas; alpha 0 where nothing was transferred (filled later by fillBase) */
  data: Uint8ClampedArray;
  /** per island: fraction of texels that received photo pixels inside the mask */
  coverage: Record<string, number>;
  /** texels sampled outside the mask (kept transparent) */
  outsideMaskTexels: number;
}

export function transferToUV(image: RasterImage, mask: Uint8Array, mesh: TShirtMesh, corr: Correspondence, size = 1024): TransferResult {
  const data = new Uint8ClampedArray(size * size * 4);
  const uv = mesh.geometry.attributes.uv!.array as ArrayLike<number>;
  const idx = corr.triangles;
  const islandOfVertex = new Map<number, string>();
  for (const isl of mesh.islands) for (const v of isl.vertices) islandOfVertex.set(v, isl.name);
  const filled: Record<string, number> = {};
  const total: Record<string, number> = {};
  let outside = 0;
  const W = image.width,
    H = image.height;
  const src = image.data;
  const sample = (x: number, y: number, out: number[]) => {
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, x - x0));
    const fy = Math.max(0, Math.min(1, y - y0));
    const i00 = (y0 * W + x0) * 4,
      i01 = (y0 * W + x1) * 4,
      i10 = (y1 * W + x0) * 4,
      i11 = (y1 * W + x1) * 4;
    for (let c = 0; c < 3; c++) {
      const top = src[i00 + c]! * (1 - fx) + src[i01 + c]! * fx;
      const bot = src[i10 + c]! * (1 - fx) + src[i11 + c]! * fx;
      out[c] = top * (1 - fy) + bot * fy;
    }
  };
  const px = new Array<number>(3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!,
      b = idx[t + 1]!,
      c = idx[t + 2]!;
    const name = islandOfVertex.get(a) ?? '?';
    // uv -> atlas pixel (v up -> row from bottom; three.js CanvasTexture/DataTexture with flipY=true expects row 0 at bottom? we store row 0 = v=1 (top) and use flipY=false)
    const ax = uv[a * 2]! * size,
      ay = (1 - uv[a * 2 + 1]!) * size;
    const bx = uv[b * 2]! * size,
      by = (1 - uv[b * 2 + 1]!) * size;
    const cxx = uv[c * 2]! * size,
      cy = (1 - uv[c * 2 + 1]!) * size;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cxx)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cxx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const det = (bx - ax) * (cy - ay) - (cxx - ax) * (by - ay);
    if (Math.abs(det) < 1e-9) continue;
    const ia = { x: corr.xy[a * 2]!, y: corr.xy[a * 2 + 1]! };
    const ib = { x: corr.xy[b * 2]!, y: corr.xy[b * 2 + 1]! };
    const ic = { x: corr.xy[c * 2]!, y: corr.xy[c * 2 + 1]! };
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const pxc = x + 0.5,
          pyc = y + 0.5;
        const l1 = ((bx - pxc) * (cy - pyc) - (cxx - pxc) * (by - pyc)) / det;
        const l2 = ((cxx - pxc) * (ay - pyc) - (ax - pxc) * (cy - pyc)) / det;
        const l3 = 1 - l1 - l2;
        const eps = -0.002;
        if (l1 < eps || l2 < eps || l3 < eps) continue;
        total[name] = (total[name] ?? 0) + 1;
        const ix = l1 * ia.x + l2 * ib.x + l3 * ic.x;
        const iy = l1 * ia.y + l2 * ib.y + l3 * ic.y;
        const mx = Math.max(0, Math.min(W - 1, Math.round(ix)));
        const my = Math.max(0, Math.min(H - 1, Math.round(iy)));
        if (!mask[my * W + mx]) {
          outside++;
          continue;
        }
        sample(ix, iy, px);
        const o = (y * size + x) * 4;
        data[o] = px[0]!;
        data[o + 1] = px[1]!;
        data[o + 2] = px[2]!;
        data[o + 3] = 255;
        filled[name] = (filled[name] ?? 0) + 1;
      }
    }
  }
  const coverage: Record<string, number> = {};
  for (const k of Object.keys(total)) coverage[k] = (filled[k] ?? 0) / total[k]!;
  return { size, data, coverage, outsideMaskTexels: outside };
}

/** Paint every transparent texel with the base colour (conditional areas: back, collar, back of sleeves, mask gaps). */
export function fillBase(tex: TransferResult, base: [number, number, number]): { filledTexels: number } {
  let n = 0;
  const d = tex.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) {
      d[i] = base[0];
      d[i + 1] = base[1];
      d[i + 2] = base[2];
      d[i + 3] = 255;
      n++;
    }
  }
  return { filledTexels: n };
}

/** Dilate transferred texels outward by `px` into still-transparent texels (gutter bleed so filtering never mixes base colour into the islands' edges). */
export function bleedEdges(tex: TransferResult, px = 4): void {
  const s = tex.size;
  const d = tex.data;
  for (let pass = 0; pass < px; pass++) {
    const src = d.slice();
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const o = (y * s + x) * 4;
        if (src[o + 3] !== 0) continue;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= s || yy >= s) continue;
          const q = (yy * s + xx) * 4;
          if (src[q + 3] === 0) continue;
          r += src[q]!;
          g += src[q + 1]!;
          b += src[q + 2]!;
          n++;
        }
        if (n) {
          d[o] = r / n;
          d[o + 1] = g / n;
          d[o + 2] = b / n;
          d[o + 3] = 254; // bled texel (still counts as transferred for later passes)
        }
      }
    }
  }
  for (let i = 3; i < d.length; i += 4) if (d[i] === 254) d[i] = 255;
}
