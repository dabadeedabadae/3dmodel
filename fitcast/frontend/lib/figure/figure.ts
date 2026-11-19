import type { BodyAsset, Weights } from './deform';

export interface FigureFile {
  id: string;
  version: string;
  topologyVersion: string;
  partNames: string[];
  landmarks: BodyAsset['landmarks'];
  armBand: BodyAsset['armBand'];
  axis: BodyAsset['axis'];
  legAxis?: BodyAsset['legAxis'];
  usableSliderRange: Record<keyof Weights, number>;
  base: number[];
  index: number[];
  part: number[];
}

export interface Figure extends BodyAsset {
  id: string;
  version: string;
  part: Uint8Array;
  range: Record<keyof Weights, number>;
}

export const PART = { head: 0, arms: 1, top: 2, bottom: 3, shoes: 4 } as const;

/** garment types worn by the figure (GarmentType of the API); a wardrobe item goes only onto the same type */
export interface FigureEntry { id: string; url: string; vertices: number; triangles: number; label: string; garments: { top: string; bottom: string } }

/** Figures available to the client (written by `npm run figure:sync`). */
export async function listFigures(): Promise<FigureEntry[]> {
  const r = await fetch('/models/figures.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Модели не найдены. Выполните npm run figure:sync в корне FitCast.');
  return r.json();
}

const cache = new Map<string, Promise<Figure>>();

/** Loads each figure once per page session. */
export function loadFigure(url = '/models/figure-01.json'): Promise<Figure> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`Модель не найдена (${r.status}). Выполните npm run figure:sync в корне FitCast.`);
    const f = (await r.json()) as FigureFile;
    return {
      id: f.id, version: f.version, landmarks: f.landmarks, armBand: f.armBand, axis: f.axis, legAxis: f.legAxis,
      base: new Float32Array(f.base), index: new Uint32Array(f.index), part: new Uint8Array(f.part),
      range: f.usableSliderRange,
    };
  }).catch((e) => { cache.delete(url); throw e; });
  cache.set(url, p);
  return p;
}
