import { describe, expect, it } from 'vitest';
import { createEmptyGarmentRecord, sourced } from '../src/domain/types';
import { AVATAR_CONTRACT_VERSION, GARMENT_RECORD_SCHEMA_VERSION, PROCESSING_VERSION } from '../src/domain/versions';

describe('GarmentRecord', () => {
  it('starts with nothing confirmed, nothing estimated and no scale', () => {
    const r = createEmptyGarmentRecord('g1', new Date('2026-10-29T00:00:00Z'));
    expect(r.schemaVersion).toBe(GARMENT_RECORD_SCHEMA_VERSION);
    expect(r.category.confirmed).toBeNull();
    expect(r.category.suggestions).toEqual([]);
    expect(r.category.manual).toBe(false);
    expect(r.template).toBeNull();
    expect(r.scale).toEqual({ kind: 'none' });
    expect(r.processingVersion).toBe(PROCESSING_VERSION);
    expect(r.avatar).toBeNull();
    expect(AVATAR_CONTRACT_VERSION).toBe(1);
  });

  it('keeps provenance on values', () => {
    const v = sourced(0.7, 'estimated', { score: 0.4, note: 'landmark-ratio' });
    expect(v).toEqual({ value: 0.7, source: 'estimated', score: 0.4, note: 'landmark-ratio' });
    const u = sourced(72, 'user_measured');
    expect('score' in u).toBe(false);
  });
});
