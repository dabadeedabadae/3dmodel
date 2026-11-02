/**
 * Minimal raster utilities that work in the browser and in node (no DOM).
 * Images are RGBA, 8-bit, row-major, top-left origin.
 */

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, length = width*height*4 */
  data: Uint8ClampedArray;
}

export interface GrayImage {
  width: number;
  height: number;
  /** 0..255 */
  data: Uint8ClampedArray;
}

export function createRaster(width: number, height: number): RasterImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Bilinear resize (RGBA). */
export function resizeRaster(src: RasterImage, width: number, height: number): RasterImage {
  const out = createRaster(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  const s = src.data;
  const d = out.data;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(src.height - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(src.width - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const i00 = (y0 * src.width + x0) * 4;
      const i01 = (y0 * src.width + x1) * 4;
      const i10 = (y1 * src.width + x0) * 4;
      const i11 = (y1 * src.width + x1) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = s[i00 + c]! * (1 - wx) + s[i01 + c]! * wx;
        const bot = s[i10 + c]! * (1 - wx) + s[i11 + c]! * wx;
        d[o + c] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return out;
}

/** Bilinear resize of a single-channel image. */
export function resizeGray(src: GrayImage, width: number, height: number): GrayImage {
  const out = { width, height, data: new Uint8ClampedArray(width * height) };
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(src.height - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(src.width - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const top = src.data[y0 * src.width + x0]! * (1 - wx) + src.data[y0 * src.width + x1]! * wx;
      const bot = src.data[y1 * src.width + x0]! * (1 - wx) + src.data[y1 * src.width + x1]! * wx;
      out.data[y * width + x] = top * (1 - wy) + bot * wy;
    }
  }
  return out;
}

/** Centre crop to a square of side min(w,h). Returns the crop and its offset. */
export function centerCropSquare(src: RasterImage): { image: RasterImage; offsetX: number; offsetY: number } {
  const side = Math.min(src.width, src.height);
  const offsetX = Math.floor((src.width - side) / 2);
  const offsetY = Math.floor((src.height - side) / 2);
  const out = createRaster(side, side);
  for (let y = 0; y < side; y++) {
    const srcStart = ((y + offsetY) * src.width + offsetX) * 4;
    out.data.set(src.data.subarray(srcStart, srcStart + side * 4), y * side * 4);
  }
  return { image: out, offsetX, offsetY };
}

/**
 * RGBA -> planar float CHW tensor data with per-channel (x/255 - mean)/std.
 * `scaleByMax` divides by the image's max channel value instead of 255 (U²-Net recipe).
 */
export function toCHWFloat(img: RasterImage, mean: [number, number, number], std: [number, number, number], scaleByMax = false): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(3 * n);
  let denom = 255;
  if (scaleByMax) {
    let mx = 1;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      mx = Math.max(mx, img.data[o]!, img.data[o + 1]!, img.data[o + 2]!);
    }
    denom = mx;
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = (img.data[o]! / denom - mean[0]) / std[0];
    out[n + i] = (img.data[o + 1]! / denom - mean[1]) / std[1];
    out[2 * n + i] = (img.data[o + 2]! / denom - mean[2]) / std[2];
  }
  return out;
}

export function softmax(logits: ArrayLike<number>): Float32Array {
  let mx = -Infinity;
  for (let i = 0; i < logits.length; i++) mx = Math.max(mx, logits[i]!);
  const out = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    out[i] = Math.exp(logits[i]! - mx);
    sum += out[i]!;
  }
  for (let i = 0; i < logits.length; i++) out[i] = out[i]! / sum;
  return out;
}

// ---------------------------------------------------------------------------
// Binary mask morphology / components (used by segmentation post-processing and the mask editor)
// ---------------------------------------------------------------------------

export function thresholdGray(src: GrayImage, t: number): Uint8Array {
  const out = new Uint8Array(src.width * src.height);
  for (let i = 0; i < out.length; i++) out[i] = src.data[i]! >= t ? 1 : 0;
  return out;
}

export function maskBounds(mask: Uint8Array, width: number, height: number): { x0: number; y0: number; x1: number; y1: number; area: number } | null {
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1,
    area = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        area++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return area ? { x0, y0, x1, y1, area } : null;
}
