/**
 * Silhouette of the garment mask → coarse shape facts (pure, no DOM: the browser and the node evaluation share it).
 *
 * The ImageNet classifier looks at texture and often calls a denim skirt or a blue knitted top "jeans". The
 * outline does not have that problem: trousers have two legs with a gap, a top is widest at the sleeves, a skirt
 * widens downwards and has neither. These facts re-weight the classifier's types in garmentType.ts (I-80).
 */
export interface ShapeFacts {
  /** height / width of the mask's bounding box */
  aspect: number;
  /** share of the lower 45 % of rows where the mask is two runs with a gap between them: trouser legs */
  split: number;
  /** widest span in the upper 40 % divided by the median span of the lower 40 %: > 1 means sleeves stick out */
  shoulder: number;
  /** median span at 15–30 % of the height divided by the median span at 70–90 %: < 1 means it widens downwards */
  taper: number;
  /** mask area / bounding-box area */
  fill: number;
}

const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]! : 0);

export function shapeFacts(mask: Uint8Array, width: number, height: number): ShapeFacts | null {
  let x0 = width, x1 = -1, y0 = height, y1 = -1, area = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
    area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (x1 < 0 || bw < 16 || bh < 16) return null;
  const minGap = Math.max(2, Math.round(bw * 0.04)), minRun = Math.max(2, Math.round(bw * 0.06));
  const span: number[] = [];
  const two: boolean[] = [];
  for (let y = y0; y <= y1; y++) {
    let first = -1, last = -1, runs = 0, run = 0, gap = 0, seenRun = false;
    for (let x = x0; x <= x1; x++) {
      if (mask[y * width + x]) {
        if (first < 0) first = x;
        last = x;
        if (run === 0 && seenRun && gap < minGap) runs = Math.max(0, runs); // a hairline gap does not split a run
        run++;
        if (run === minRun) { if (!seenRun || gap >= minGap) runs++; seenRun = true; }
        if (run >= minRun) gap = 0;
      } else { run = 0; if (seenRun) gap++; }
    }
    span.push(first < 0 ? 0 : (last - first + 1) / bw);
    two.push(runs >= 2);
  }
  const rows = (a: number, b: number) => span.slice(Math.floor(a * bh), Math.max(Math.floor(a * bh) + 1, Math.floor(b * bh)));
  const lower = two.slice(Math.floor(0.55 * bh));
  const low = median(rows(0.6, 1)) || 1e-6;
  return {
    aspect: bh / bw,
    split: lower.filter(Boolean).length / lower.length,
    shoulder: Math.max(...rows(0, 0.4)) / low,
    taper: median(rows(0.15, 0.3)) / (median(rows(0.7, 0.9)) || 1e-6),
    fill: area / (bw * bh),
  };
}
