// Subset of 3dmodel/src/domain/types.ts used by the ported landmark estimator.
export type Provenance = 'default' | 'estimated' | 'user_measured' | 'user_adjusted';
export interface Landmark {
  name: string;
  /** image pixel coordinates */
  x: number;
  y: number;
  source: Provenance;
  score?: number;
  /** `unknown` when the point could not be determined and no user input exists. */
  status: 'ok' | 'uncertain' | 'unknown';
}
