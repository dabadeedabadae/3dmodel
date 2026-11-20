import { describe, expect, it } from 'vitest';
import { assessMask, carveBackground, fillHoles, keepComponents, maskComponents, maskHoles, postprocessSoftMask } from '../src/image/maskOps';

function grid(rows: string[]): { mask: Uint8Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]!.length;
  const mask = new Uint8Array(width * height);
  rows.forEach((r, y) => [...r].forEach((c, x) => (mask[y * width + x] = c === '#' ? 1 : 0)));
  return { mask, width, height };
}

describe('maskOps', () => {
  it('finds components and holes; border-touching background is not a hole', () => {
    const g = grid(['..........', '.######...', '.#....#...', '.#.##.#...', '.######...', '........##', '........##']);
    const comps = maskComponents(g.mask, g.width, g.height);
    expect(comps.regions.length).toBe(2);
    const holes = maskHoles(g.mask, g.width, g.height);
    expect(holes.regions.length).toBe(1); // the ring's inside (with an island) is one enclosed background region
    expect(holes.regions[0]!.area).toBe(6); // 2x4 interior minus the 2-px island
  });

  it('fillHoles / keepComponents are non-destructive copies', () => {
    const g = grid(['#####', '#...#', '#.#.#', '#...#', '#####']);
    const holes = maskHoles(g.mask, g.width, g.height);
    const filled = fillHoles(g.mask, holes, holes.regions.map((h) => h.id));
    expect(Array.from(filled).every((v) => v === 1)).toBe(true);
    expect(g.mask[6]).toBe(0); // original untouched
    const comps = maskComponents(g.mask, g.width, g.height);
    expect(comps.regions.length).toBe(2); // ring + centre pixel
    const ringOnly = keepComponents(g.mask, comps, [0]);
    expect(ringOnly[12]).toBe(0);
  });

  it('postprocess keeps the largest component, fills only tiny holes, reports the rest', () => {
    const w = 60,
      h = 60;
    const soft = new Uint8ClampedArray(w * h);
    // big square 40x40 with a 1-px hole and a 6x6 hole; a separate 5x5 blob
    for (let y = 5; y < 45; y++) for (let x = 5; x < 45; x++) soft[y * w + x] = 255;
    soft[20 * w + 20] = 0;
    for (let y = 30; y < 36; y++) for (let x = 30; x < 36; x++) soft[y * w + x] = 0;
    for (let y = 50; y < 55; y++) for (let x = 50; x < 55; x++) soft[y * w + x] = 255;
    const r = postprocessSoftMask({ width: w, height: h, data: soft }, 128);
    expect(r.removedComponents.length).toBe(1);
    expect(r.removedComponents[0]!.area).toBe(25);
    expect(r.mask[20 * w + 20]).toBe(1); // tiny hole filled (1 px <= 0.5 % of 1600)
    expect(r.mask[32 * w + 32]).toBe(0); // 36-px hole (2.25 %) kept open
    expect(r.openHoles.length).toBe(1);
    expect(r.openHoles[0]!.area).toBe(36);
    expect(r.smallHolesFilled).toBe(1);
    // raw thresholded mask is untouched (still has both holes and the blob)
    expect(r.thresholded[20 * w + 20]).toBe(0);
    expect(r.thresholded[52 * w + 52]).toBe(1);
    const q = assessMask(r.mask, w, h);
    expect(q.status).toBe('suspicious');
    expect(q.openHoles).toBe(1);
    expect(q.warnings.some((x) => x.includes('разрыв'))).toBe(true);
  });

  it('re-thresholding changes the mask without touching the soft map', () => {
    const w = 10,
      h = 10;
    const soft = new Uint8ClampedArray(w * h);
    for (let i = 0; i < soft.length; i++) soft[i] = i < 50 ? 200 : 100;
    const a = postprocessSoftMask({ width: w, height: h, data: soft }, 128);
    const b = postprocessSoftMask({ width: w, height: h, data: soft }, 90);
    expect(a.keptArea).toBe(50);
    expect(b.keptArea).toBe(100);
    expect(soft[0]).toBe(200);
  });
});

describe('carveBackground (post-v3, I-66)', () => {
  // 60×60: light background; a dark "trousers" block 10..50 × 5..55 that the model filled across the leg gap
  // (x 25..35, y 30..55, background-coloured, open to the bottom edge); a light print 15..20 × 10..15 inside the fabric
  const W = 60, H = 60;
  const make = (gapSoft: number) => {
    const rgba = new Uint8ClampedArray(W * H * 4), soft = new Uint8ClampedArray(W * H), mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const inBlock = x >= 10 && x < 50 && y >= 5 && y < 60;
      const gap = x >= 25 && x < 35 && y >= 30;
      const print = x >= 15 && x < 20 && y >= 10 && y < 15;
      const light = !inBlock || gap || print;
      rgba.set(light ? [220, 220, 215, 255] : [40, 40, 50, 255], i * 4);
      mask[i] = inBlock ? 1 : 0;
      soft[i] = !inBlock ? 0 : gap ? gapSoft : 250;
    }
    return { rgba, soft, mask };
  };
  it('gives the swallowed gap back to the background, keeps the print', () => {
    const { rgba, soft, mask } = make(180);
    const r = carveBackground(rgba, soft, mask, W, H);
    expect(r.carved).toBe(10 * 30);
    expect(r.mask[45 * W + 30]).toBe(0); // gap
    expect(r.mask[12 * W + 17]).toBe(1); // print, surrounded by fabric
    expect(r.mask[40 * W + 15]).toBe(1); // leg
  });
  it('keeps pixels the model was sure about', () => {
    const { rgba, soft, mask } = make(250);
    expect(carveBackground(rgba, soft, mask, W, H).carved).toBe(0);
  });
});
