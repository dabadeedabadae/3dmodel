import { describe, expect, it } from 'vitest';
import { estimateTShirtLandmarks, tshirtRatios } from '../src/shape/landmarks';
import { estimateParams, resolveParams, toGarmentParams } from '../src/shape/params';
import { buildTShirt } from '../src/templates/tshirt/buildTShirt';
import { bleedEdges, fillBase, imageCorrespondence, transferToUV } from '../src/image/uvTransfer';
import { pixelate } from '../src/image/pixelate';
import { estimateBaseColor } from '../src/image/color';

/** Synthetic flat-lay tee mask: body rectangle + two sleeves + raised collar bump. */
function syntheticTee(W = 320, H = 400) {
  const m = new Uint8Array(W * H);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1;
  };
  fill(90, 60, 230, 360); // body
  fill(30, 70, 95, 140); // left sleeve
  fill(225, 70, 290, 140); // right sleeve
  fill(130, 45, 190, 70); // collar back bump
  return { mask: m, W, H };
}

describe('stage 08-12 pure pipeline on a synthetic mask', () => {
  const { mask, W, H } = syntheticTee();
  const est = estimateTShirtLandmarks(mask, W, H);

  it('finds the main landmarks in the right places', () => {
    const p = est.points;
    expect(p.hem_left.y).toBeGreaterThan(350);
    expect(p.hem_right.x).toBeGreaterThan(p.hem_left.x + 100);
    expect(p.armpit_left.x).toBeLessThan(100);
    expect(p.armpit_left.y).toBeGreaterThan(130);
    expect(p.armpit_right.x).toBeGreaterThan(220);
    expect(p.shoulder_left.y).toBeLessThan(p.armpit_left.y);
    expect(p.cuff_left_top.x).toBeLessThan(40);
    expect(p.cuff_right_bottom.x).toBeGreaterThan(280);
    // the collar is a bump, not a dip: neck bottom is a DEFAULT, not measured
    expect(p.neck_bottom.source).toBe('default');
    expect(p.neck_bottom.status).toBe('uncertain');
    expect(est.checks.find((c) => c.name === 'neck_bottom_measured')!.pass).toBe(false);
  });

  it('ratios are relative to the torso width (no centimetres anywhere)', () => {
    const r = tshirtRatios(est.points);
    expect(r.torsoWidthPx).toBeGreaterThan(100);
    expect(r.length).toBeGreaterThan(1.5);
    expect(r.length).toBeLessThan(2.6);
    expect(Object.keys(r).some((k) => /cm|mm/i.test(k))).toBe(false);
  });

  it('params keep estimated / applied / user apart with provenance', () => {
    const { estimated, ratios } = estimateParams(est.points);
    const L = resolveParams(estimated, { sleeveLength: 0.3 }, { kind: 'none' }, ratios);
    expect(L.resolved.sleeveLength).toBe(0.3);
    expect(L.user.sleeveLength).toBe(0.3);
    expect(L.estimated.sleeveLength).not.toBe(0.3);
    const gp = toGarmentParams(L);
    expect(gp['sleeveLength']!.source).toBe('user_adjusted');
    expect(gp['length']!.source).toBe('estimated');
    expect(gp['depthRatio']!.source).toBe('default'); // not visible in a front photo
    expect(L.scale.kind).toBe('none');
    expect(L.note).toMatch(/не сантиметры/);
    // a value outside limits is clamped and recorded, the raw estimate stays
    const L2 = resolveParams({ ...estimated, length: 9 }, {}, { kind: 'none' }, ratios);
    expect(L2.clamped.find((c) => c.name === 'length')!.requested).toBe(9);
    expect(L2.estimated.length).toBe(9);
    expect(L2.resolved.length).toBeLessThan(9);
  });

  it('UV transfer is not mirrored: atlas u follows image x on the front, image letters keep their order', () => {
    const { estimated, ratios } = estimateParams(est.points);
    const L = resolveParams(estimated, {}, { kind: 'none' }, ratios);
    const mesh = buildTShirt(L.resolved);
    const corr = imageCorrespondence(mesh, est.points, mask, W, H);
    expect(corr.visibleIslands).toEqual(['front', 'sleeve_left', 'sleeve_right']);
    // image: left third of the body red, right third blue
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        img.data[o] = x < 160 ? 255 : 0;
        img.data[o + 2] = x < 160 ? 0 : 255;
        img.data[o + 3] = 255;
      }
    const tex = transferToUV(img, mask, mesh, corr, 256);
    expect(tex.coverage['front']).toBeGreaterThan(0.95);
    // front island rect u in [0.02,0.49]: left part must be red, right part blue
    const front = mesh.islands.find((i) => i.name === 'front')!;
    const uv = mesh.geometry.attributes.uv!.array as Float32Array;
    let uMin = 1, uMax = 0, vMid = 0;
    for (const v of front.vertices) {
      uMin = Math.min(uMin, uv[v * 2]!);
      uMax = Math.max(uMax, uv[v * 2]!);
      vMid += uv[v * 2 + 1]!;
    }
    vMid /= front.vertices.length;
    const px = (u: number, v: number) => {
      const x = Math.round(u * 256), y = Math.round((1 - v) * 256);
      const o = (y * 256 + x) * 4;
      return [tex.data[o]!, tex.data[o + 2]!, tex.data[o + 3]!];
    };
    const left = px(uMin + (uMax - uMin) * 0.2, vMid);
    const right = px(uMin + (uMax - uMin) * 0.8, vMid);
    expect(left[2]).toBe(255);
    expect(left[0]).toBeGreaterThan(200); // red on the left of the atlas island
    expect(right[1]).toBeGreaterThan(200); // blue on the right
    bleedEdges(tex, 2);
    const fb = fillBase(tex, [1, 2, 3]);
    expect(fb.filledTexels).toBeGreaterThan(0);
    // pixelation only changes the texture; mesh untouched
    const before = mesh.geometry.attributes.position!.array.slice();
    const p = pixelate(tex.data, 256, { size: 64, colors: 4, dither: false, strength: 1 });
    expect(p.size).toBe(64);
    expect(p.palette.length).toBeLessThanOrEqual(4);
    expect(mesh.geometry.attributes.position!.array).toEqual(before);
    mesh.geometry.dispose();
  });

  it('base colour is the median of the masked fabric', () => {
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let i = 0; i < W * H; i++) {
      img.data[i * 4] = mask[i] ? 200 : 10;
      img.data[i * 4 + 1] = mask[i] ? 40 : 10;
      img.data[i * 4 + 2] = mask[i] ? 60 : 10;
      img.data[i * 4 + 3] = 255;
    }
    const b = estimateBaseColor(img, mask);
    expect(b.rgb).toEqual([200, 40, 60]);
    expect(b.hex).toBe('#c8283c');
  });
});
