import { readFileSync } from 'node:fs';
import type { BodyAsset } from './asset';

export function loadAsset(file = process.env.IB_ASSET ?? 'imported-body/out/asset.json'): BodyAsset {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return { ...j, base: new Float32Array(j.base), index: new Uint32Array(j.index) };
}
