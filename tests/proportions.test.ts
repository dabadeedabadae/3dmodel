import { describe, expect, it } from 'vitest';
import { BODY_TYPES, describeZ, pinFromSlider, solveShape, type ShapeState } from '../imported-body/src/proportions';

const base: ShapeState = { heightCm: 175, weightZ: 0, pins: {} };

describe('linked proportions (I-68, ANSUR II)', () => {
  it('the base figure is the typical man: every slider at zero', () => {
    const s = solveShape(base);
    for (const v of Object.values(s.weights)) expect(Math.abs(v)).toBeLessThan(1e-9);
    expect(Math.abs(s.weightRatio)).toBeLessThan(1e-9);
  });
  it('a taller figure gets heavier and every girth grows', () => {
    const s = solveShape({ ...base, heightCm: 190 });
    expect(s.weightRatio).toBeGreaterThan(0.1);
    for (const v of Object.values(s.weights)) expect(v).toBeGreaterThan(0);
    for (const z of Object.values(s.z)) expect(Math.abs(z)).toBeLessThan(1e-9);
  });
  it('at the same weight a bigger chest brings a slightly bigger waist and slimmer thighs', () => {
    const s = solveShape({ ...base, pins: { chest: 1 } });
    expect(s.weights.chest).toBeGreaterThan(0);
    expect(s.weights.waist).toBeGreaterThan(0);
    expect(s.weights.waist).toBeLessThan(s.weights.chest);
    expect(s.weights.thighs).toBeLessThan(0);
  });
  it('a pin reproduces the slider value it came from', () => {
    const st = { ...base, heightCm: 182, weightZ: 0.7 };
    const z = pinFromSlider(st, 'hip', 0.4);
    expect(solveShape({ ...st, pins: { hip: z } }).weights.hip).toBeCloseTo(0.4, 6);
  });
  it('words and body types', () => {
    expect(describeZ(0.2)).toBe('как обычно');
    expect(describeZ(1)).toBe('чуть больше обычного');
    expect(describeZ(-2)).toBe('меньше обычного');
    expect(BODY_TYPES[0]!.id).toBe('base');
  });
});
