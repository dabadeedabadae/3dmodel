/**
 * Stage 12 — pixelation of the UV texture (texture only; the mesh is untouched).
 *
 *  - box-filter downsample of the 1024 atlas to N×N (64 / 128 / 256)
 *  - optional palette quantisation (median cut, K colours) with optional
 *    Floyd–Steinberg dithering
 *  - strength: 0 = plain downsample, 1 = fully quantised; in between the
 *    quantised colour is blended with the averaged colour
 *
 * Island gutters were already filled with the base colour, so averaging never
 * mixes transparency and there is no dark fringe. The result is opaque.
 */

export interface PixelateOptions {
  size: 64 | 128 | 256;
  colors: number; // 0 = no quantisation
  dither: boolean;
  strength: number; // 0..1
}

export interface PixelateResult {
  size: number;
  data: Uint8ClampedArray; // RGBA, opaque
  palette: [number, number, number][];
  options: PixelateOptions;
}

export function downsampleBox(src: Uint8ClampedArray, srcSize: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const f = srcSize / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * f),
      y1 = Math.max(y0 + 1, Math.floor((y + 1) * f));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * f),
        x1 = Math.max(x0 + 1, Math.floor((x + 1) * f));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * srcSize + xx) * 4;
          if (src[o + 3] === 0) continue;
          r += src[o]!;
          g += src[o + 1]!;
          b += src[o + 2]!;
          n++;
        }
      const o = (y * size + x) * 4;
      if (n) {
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Median-cut palette over opaque pixels. */
export function medianCut(data: Uint8ClampedArray, k: number): [number, number, number][] {
  const px: number[][] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0) px.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  if (px.length === 0) return [[128, 128, 128]];
  let boxes: number[][][] = [px];
  while (boxes.length < k) {
    // split the box with the largest channel range
    let bi = -1,
      bc = 0,
      br = -1;
    boxes.forEach((bx, i) => {
      if (bx.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let mn = 255,
          mx = 0;
        for (const p of bx) {
          if (p[c]! < mn) mn = p[c]!;
          if (p[c]! > mx) mx = p[c]!;
        }
        if (mx - mn > br) {
          br = mx - mn;
          bi = i;
          bc = c;
        }
      }
    });
    if (bi < 0) break;
    const bx = boxes[bi]!.sort((a, b) => a[bc]! - b[bc]!);
    const mid = Math.floor(bx.length / 2);
    boxes.splice(bi, 1, bx.slice(0, mid), bx.slice(mid));
  }
  return boxes.map((bx) => {
    const s = [0, 0, 0];
    for (const p of bx) for (let c = 0; c < 3; c++) s[c]! += p[c]!;
    return [Math.round(s[0]! / bx.length), Math.round(s[1]! / bx.length), Math.round(s[2]! / bx.length)] as [number, number, number];
  });
}

function nearest(palette: [number, number, number][], r: number, g: number, b: number): [number, number, number] {
  let best = palette[0]!,
    bd = Infinity;
  for (const p of palette) {
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

export function pixelate(src: Uint8ClampedArray, srcSize: number, opts: PixelateOptions): PixelateResult {
  const size = opts.size;
  const small = downsampleBox(src, srcSize, size);
  const out = new Uint8ClampedArray(small);
  let palette: [number, number, number][] = [];
  if (opts.colors > 0 && opts.strength > 0) {
    palette = medianCut(small, opts.colors);
    const work = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      work[i * 3] = small[i * 4]!;
      work[i * 3 + 1] = small[i * 4 + 1]!;
      work[i * 3 + 2] = small[i * 4 + 2]!;
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const r = work[i * 3]!,
          g = work[i * 3 + 1]!,
          b = work[i * 3 + 2]!;
        const q = nearest(palette, r, g, b);
        const o = i * 4;
        out[o] = small[o]! + (q[0] - small[o]!) * opts.strength;
        out[o + 1] = small[o + 1]! + (q[1] - small[o + 1]!) * opts.strength;
        out[o + 2] = small[o + 2]! + (q[2] - small[o + 2]!) * opts.strength;
        if (opts.dither) {
          const er = r - q[0],
            eg = g - q[1],
            eb = b - q[2];
          const spread = (dx: number, dy: number, w: number) => {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || xx >= size || yy >= size) return;
            const j = (yy * size + xx) * 3;
            work[j] = work[j]! + er * w;
            work[j + 1] = work[j + 1]! + eg * w;
            work[j + 2] = work[j + 2]! + eb * w;
          };
          spread(1, 0, 7 / 16);
          spread(-1, 1, 3 / 16);
          spread(0, 1, 5 / 16);
          spread(1, 1, 1 / 16);
        }
      }
    }
  }
  return { size, data: out, palette, options: opts };
}
