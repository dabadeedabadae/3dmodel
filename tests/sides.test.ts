import { describe, expect, it } from 'vitest';
import { imageSideToWearerSide, wearerSideFromX, wearerSideToImageSide, WEARER_SIDE_X_SIGN } from '../src/domain/sides';
import { buildTShirt } from '../src/templates/tshirt/buildTShirt';
import { TestMannequinAdapter } from '../src/fitting/TestMannequinAdapter';

describe('sides: wearer vs image', () => {
  it('front view, not mirrored: image_right is the wearer\'s left', () => {
    expect(imageSideToWearerSide('image_right', 'front')).toBe('left');
    expect(imageSideToWearerSide('image_left', 'front')).toBe('right');
  });
  it('back view, not mirrored: image_right is the wearer\'s right', () => {
    expect(imageSideToWearerSide('image_right', 'back')).toBe('right');
    expect(imageSideToWearerSide('image_left', 'back')).toBe('left');
  });
  it('mirrored image flips the mapping', () => {
    expect(imageSideToWearerSide('image_right', 'front', true)).toBe('right');
    expect(imageSideToWearerSide('image_right', 'back', true)).toBe('left');
  });
  it('round-trips', () => {
    for (const view of ['front', 'back'] as const)
      for (const mirrored of [false, true])
        for (const side of ['left', 'right'] as const)
          expect(imageSideToWearerSide(wearerSideToImageSide(side, view, mirrored), view, mirrored)).toBe(side);
  });
  it('template islands/rings follow the wearer convention (+X = left)', () => {
    const m = buildTShirt();
    const pos = m.geometry.attributes.position!.array as Float32Array;
    const meanX = (verts: number[]) => verts.reduce((a, v) => a + pos[v * 3]!, 0) / verts.length;
    const left = m.islands.find((i) => i.name === 'sleeve_left')!;
    const right = m.islands.find((i) => i.name === 'sleeve_right')!;
    expect(wearerSideFromX(meanX(left.vertices))).toBe('left');
    expect(wearerSideFromX(meanX(right.vertices))).toBe('right');
    expect(Math.sign(meanX(left.vertices))).toBe(WEARER_SIDE_X_SIGN.left);
    m.geometry.dispose();
  });
  it('test mannequin landmarks follow the same convention', () => {
    const a = new TestMannequinAdapter();
    expect(wearerSideFromX(a.getLandmark('shoulder_left').position[0])).toBe('left');
    expect(wearerSideFromX(a.getLandmark('wrist_right').position[0])).toBe('right');
    const surf = a.getSurface();
    const armLeft = surf.regions.find((r) => r.name === 'arm_left')!;
    let x = 0;
    for (let t = armLeft.triangleStart; t < armLeft.triangleStart + armLeft.triangleCount; t++) x += surf.positions[surf.indices[t * 3]! * 3]!;
    expect(x).toBeGreaterThan(0);
    a.dispose();
  });
});
