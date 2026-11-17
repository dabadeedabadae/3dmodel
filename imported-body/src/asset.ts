/**
 * The imported mannequin as a FitCast asset: fixed vertices and fixed topology, loaded once, never rebuilt.
 * Deformations are a POSITION MAPPING of the canonical vertices (base → target), so the index buffer, the
 * vertex count and the UVs of anything bound to it are invariant, and errors cannot accumulate: every slider
 * change re-derives positions from the base, never from the previous result.
 */
export const ASSET_ID = 'imported-male-lowpoly';
export const ASSET_VERSION = 'imported-1';
export const TOPOLOGY_VERSION = 'imported-topo-1';

export interface Landmarks {
  height: number;
  crotch: number;
  hip: number;
  waist: number;
  chest: number;
  armpit: number;
  shoulder_level: number;
  neck_base: number;
}
export interface BodyAsset {
  id: string;
  version: string;
  topologyVersion: string;
  /** base positions in metres, feet on the floor, +X = wearer's left, +Z = front */
  base: Float32Array;
  index: Uint32Array;
  landmarks: Landmarks;
  /** per-height torso centre in z and half-extents, sampled from the base mesh (used as the deformation axis) */
  axis: { y: number; cz: number; halfX: number }[];
  armBand: { low: number; high: number };
  /** measured centre line of one leg per height (mirrored for the other side). Present for dressed figures;
   *  without it the leg axis is estimated from the pelvis width, which inverted triangles near the shin. */
  legAxis?: { y: number; cx: number; cz: number }[];
}
