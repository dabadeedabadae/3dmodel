// The outline of the mask re-weights the classifier's garment types (I-80): drawn silhouettes, no model.
import { describe, expect, it } from 'vitest';
import { shapeFacts } from '../fitcast/frontend/lib/garment/shape';
import { IMAGENET_TO_TYPE, suggestGarmentType } from '../fitcast/frontend/lib/garment/garmentType';

const W = 200, H = 200;
function draw(inside: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) m[y * W + x] = 1;
  return m;
}
const pants = draw((x, y) => y >= 20 && y < 180 && (y < 60 ? x >= 60 && x < 140 : (x >= 55 && x < 95) || (x >= 105 && x < 145)));
const tshirt = draw((x, y) => (y >= 30 && y < 70 && x >= 20 && x < 180) || (y >= 30 && y < 170 && x >= 60 && x < 140));
const skirt = draw((x, y) => y >= 60 && y < 160 && Math.abs(x - 100) < 30 + (y - 60) * 0.4);

/** softmax with all the mass on the ImageNet classes of one type */
function probsFor(type: string, p = 0.9): Float32Array {
  const probs = new Float32Array(1000);
  const ids = Object.entries(IMAGENET_TO_TYPE).filter(([, t]) => t === type).map(([i]) => Number(i));
  for (const i of ids) probs[i] = p / ids.length;
  return probs;
}

describe('garment outline', () => {
  it('reads legs, sleeves and a widening hem', () => {
    const p = shapeFacts(pants, W, H)!, t = shapeFacts(tshirt, W, H)!, s = shapeFacts(skirt, W, H)!;
    expect(p.split).toBeGreaterThan(0.8);
    expect(t.split).toBeLessThan(0.15);
    expect(t.shoulder).toBeGreaterThan(1.5);
    expect(s.split).toBeLessThan(0.15);
    expect(s.taper).toBeLessThan(0.9);
    expect(shapeFacts(new Uint8Array(W * H), W, H)).toBeNull();
  });

  it('"jeans" without legs becomes a skirt or a top', () => {
    const jeans = probsFor('JEANS');
    expect(suggestGarmentType(jeans, []).type).toBe('JEANS');
    expect(suggestGarmentType(jeans, [], shapeFacts(pants, W, H)).type).toBe('JEANS');
    expect(suggestGarmentType(jeans, [], shapeFacts(skirt, W, H)).type).toBe('SKIRT');
    const top = suggestGarmentType(jeans, [], shapeFacts(tshirt, W, H));
    expect(top.type).not.toBe('SKIRT');
    expect([top.type, ...top.alternatives]).toContain('SWEATER');
  });

  it('a top with two legs in the outline is not kept as a top', () => {
    const mixed = probsFor('TSHIRT', 0.5);
    for (const [i, t] of Object.entries(IMAGENET_TO_TYPE)) if (t === 'JEANS') mixed[Number(i)] = 0.3;
    expect(suggestGarmentType(mixed, []).type).toBe('TSHIRT');
    expect(suggestGarmentType(mixed, [], shapeFacts(pants, W, H)).type).toBe('JEANS');
  });

  it('a clear classifier answer is not changed by a matching outline', () => {
    expect(suggestGarmentType(probsFor('TSHIRT'), [], shapeFacts(tshirt, W, H)).type).toBe('TSHIRT');
    expect(suggestGarmentType(probsFor('SKIRT'), [], shapeFacts(skirt, W, H)).type).toBe('SKIRT');
  });
});
