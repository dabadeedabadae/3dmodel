/**
 * Hand-built low-poly T-shirt (short sleeves, round neck).
 *
 * One connected surface with exactly four openings: neck, two cuffs, hem.
 * No solid torso, no intersecting cylinders: the sleeves are attached to
 * armholes cut into the side of the torso tube and share those boundary
 * vertices.
 *
 * Topology (fixed, `TSHIRT_TOPOLOGY_VERSION`):
 *   torso tube     : rows 0..5 (hem, waist, chest, armpit, mid-armhole, shoulder) x 16 columns
 *   shoulder yoke  : row 5 (shoulder ring) -> row 6 (neck ring), 16 columns
 *   collar band    : row 6 (neck ring) -> row 7 (collar inner ring = neck opening)
 *   armholes       : torso quads removed at rows 3-5 around columns 3..5 (+X) and 11..13 (-X)
 *   sleeves        : 8-vertex ring at the armhole -> 2 more rings -> cuff opening
 *
 * Column 0 is the front centre (+Z); columns increase counter-clockwise seen
 * from above (towards +X first). Column 4 = +X side seam (wearer's left),
 * 8 = back centre, 12 = -X side seam (wearer's right).
 *
 * SIDES are the WEARER's (see domain/sides.ts): the wearer's LEFT is +X (a viewer
 * facing the front sees it on screen-right). UV islands (each its own group /
 * material index): front, back, sleeve_left (+X), sleeve_right (-X), collar.
 * UVs are computed from the CANONICAL parameters so that a texture baked once
 * keeps its mapping when parameters change.
 *
 * Geometry vertices are duplicated along UV seams. `logicalIndex` maps every
 * geometry vertex back to its logical (welded) vertex so that topology checks
 * do not depend on floating-point welding.
 */

import * as THREE from 'three';
import type { WearerSide } from '../../domain/sides';
import { armholeLoop, armholeRingElevation, gridPosition } from './rows';
import {
  clampTShirtParams,
  defaultTShirtParams,
  TSHIRT_TEMPLATE_ID,
  TSHIRT_TEMPLATE_VERSION,
  TSHIRT_TOPOLOGY_VERSION,
  type TShirtParams,
} from './params';

export { M, NECK_ROW, COLLAR_ROW } from './rows';
import { M, NECK_ROW, COLLAR_ROW, ARMHOLE_LEFT, ARMHOLE_RIGHT } from './rows';
export const TORSO_ROWS = 6; // rows 0..5

export type IslandName = 'front' | 'back' | 'sleeve_left' | 'sleeve_right' | 'collar';
export const ISLAND_NAMES: readonly IslandName[] = ['front', 'back', 'sleeve_left', 'sleeve_right', 'collar'];

export type RingName =
  | 'hem'
  | 'waist'
  | 'chest'
  | 'armpit'
  | 'shoulder'
  | 'neck'
  | 'collar_inner'
  | 'armhole_left'
  | 'armhole_right'
  | 'cuff_left'
  | 'cuff_right';

export interface IslandMeta {
  name: IslandName;
  materialIndex: number;
  /** Range in the index buffer. */
  indexStart: number;
  indexCount: number;
  /** Geometry vertex indices belonging to this island. */
  vertices: number[];
  /** UV rectangle reserved for this island in the atlas. */
  uvRect: { u0: number; v0: number; u1: number; v1: number };
}

export interface RingMeta {
  name: RingName;
  /** Logical vertex ids, in loop order. */
  logical: number[];
  /** True when the ring is an open boundary of the garment (expected: hem, collar_inner, cuffs). */
  isOpening: boolean;
}

export interface SeamMeta {
  name: string;
  logical: number[];
}

export interface TShirtMesh {
  templateId: string;
  templateVersion: string;
  topologyVersion: string;
  params: TShirtParams;
  geometry: THREE.BufferGeometry;
  /** Geometry vertex -> logical vertex id. Same length as geometry vertex count. */
  logicalIndex: Int32Array;
  logicalCount: number;
  islands: IslandMeta[];
  rings: RingMeta[];
  seams: SeamMeta[];
  /** UV units per metre used for all islands (uniform texel density). */
  uvScale: number;
  stats: { vertices: number; logicalVertices: number; triangles: number };
}

// ---------------------------------------------------------------------------
// Logical vertex ids
// ---------------------------------------------------------------------------

const FRONT_COLS = [12, 13, 14, 15, 0, 1, 2, 3, 4];
const BACK_COLS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const COLLAR_COLS = [8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8];
/** Torso quads removed for the armholes: [row, columnSpanStart]. Span j covers columns j..j+1. */
const REMOVED_SPANS = new Set(['3:3', '3:4', '4:3', '4:4', '3:11', '3:12', '4:11', '4:12']);
export const SLEEVE_RINGS = 3; // ring 0 = armhole, ring 2 = cuff
export const SLEEVE_N = 8;

/** logical id for a torso/yoke/collar grid vertex */
export const gridId = (row: number, col: number) => row * M + ((col % M) + M) % M;
/** logical id for a sleeve ring vertex (rings 1..2 only; ring 0 reuses grid ids) */
export const sleeveId = (side: WearerSide, ring: number, m: number) =>
  (COLLAR_ROW + 1) * M + (side === 'left' ? 0 : (SLEEVE_RINGS - 1) * SLEEVE_N) + (ring - 1) * SLEEVE_N + m;
const LOGICAL_COUNT = (COLLAR_ROW + 1) * M + 2 * (SLEEVE_RINGS - 1) * SLEEVE_N;

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

interface SleeveFrame {
  center: THREE.Vector3;
  d: THREE.Vector3;
  u: THREE.Vector3;
  w: THREE.Vector3;
  phi: number[]; // angle of each armhole vertex in the (u,w) plane, loop order
  /** mean of (cos phi, sin phi): subtracted so every generated ring is centred on the axis */
  phiMean: [number, number];
  rootRadius: number;
  /** how far ahead of the ring centre (along d) the farthest armhole vertex sits */
  maxAhead: number;
}

function sleeveFrame(p: TShirtParams, side: WearerSide, positions: THREE.Vector3[]): SleeveFrame {
  const s = side === 'left' ? 1 : -1; // wearer's left = +X
  const loop = armholeLoop(side);
  const pts = loop.map(([r, c]) => positions[gridId(r, c)]!);
  const center = new THREE.Vector3();
  for (const q of pts) center.add(q);
  center.multiplyScalar(1 / pts.length);
  // Sleeve axis: outward normal of the armhole chord (underarm -> shoulder vertex, see
  // rows.armholeRingElevation) tilted down by sleeveAngle. Shared with the parameter
  // clamp, which guarantees elevation(chord) <= sleeveAngle, i.e. sleeves never rise.
  const elev = armholeRingElevation(p) - p.sleeveAngle;
  const d = new THREE.Vector3(s * Math.cos(elev), Math.sin(elev), 0);
  const w = new THREE.Vector3(0, 0, 1);
  const u = new THREE.Vector3().crossVectors(w, d).normalize();
  const off = new THREE.Vector3();
  let rootRadius = 0;
  let maxAhead = 0;
  const phi = pts.map((q) => {
    off.copy(q).sub(center);
    rootRadius += Math.hypot(off.dot(u), off.dot(w));
    maxAhead = Math.max(maxAhead, off.dot(d));
    return Math.atan2(off.dot(w), off.dot(u));
  });
  rootRadius /= pts.length;
  const phiMean: [number, number] = [phi.reduce((a, f) => a + Math.cos(f), 0) / phi.length, phi.reduce((a, f) => a + Math.sin(f), 0) / phi.length];
  return { center, d, u, w, phi, phiMean, rootRadius, maxAhead };
}

function sleeveRingPosition(p: TShirtParams, f: SleeveFrame, ring: number, m: number, out: THREE.Vector3): THREE.Vector3 {
  // ring 1 must sit ahead of every armhole vertex (the armhole is not planar), ring 2 ahead of ring 1
  const t1 = Math.max(p.sleeveLength * 0.5, f.maxAhead + 0.03);
  const t = ring === 1 ? t1 : Math.max(p.sleeveLength, t1 + 0.04);
  const r = ring === 1 ? (f.rootRadius + p.cuffRadius) / 2 : p.cuffRadius;
  const phi = f.phi[m]!;
  // armhole vertices are not evenly spaced in angle; re-centre so the ring's mean lies on the axis
  return out
    .copy(f.center)
    .addScaledVector(f.d, t)
    .addScaledVector(f.u, r * (Math.cos(phi) - f.phiMean[0]))
    .addScaledVector(f.w, r * (Math.sin(phi) - f.phiMean[1]));
}

/** All logical vertex positions for a parameter set. */
export function logicalPositions(p: TShirtParams): THREE.Vector3[] {
  const pos: THREE.Vector3[] = new Array(LOGICAL_COUNT);
  for (let row = 0; row <= COLLAR_ROW; row++) {
    for (let col = 0; col < M; col++) pos[gridId(row, col)] = gridPosition(p, row, col, new THREE.Vector3());
  }
  for (const side of ['left', 'right'] as const) {
    const f = sleeveFrame(p, side, pos);
    for (let ring = 1; ring < SLEEVE_RINGS; ring++) {
      for (let m = 0; m < SLEEVE_N; m++) pos[sleeveId(side, ring, m)] = sleeveRingPosition(p, f, ring, m, new THREE.Vector3());
    }
    // ring 0 is the armhole itself
  }
  return pos;
}

// ---------------------------------------------------------------------------
// UV layout (from canonical params — stable across parameter changes)
// ---------------------------------------------------------------------------

const UV_RECTS: Record<IslandName, IslandMeta['uvRect']> = {
  front: { u0: 0.02, v0: 0.45, u1: 0.49, v1: 0.98 },
  back: { u0: 0.51, v0: 0.45, u1: 0.98, v1: 0.98 },
  sleeve_left: { u0: 0.02, v0: 0.22, u1: 0.49, v1: 0.42 },
  sleeve_right: { u0: 0.51, v0: 0.22, u1: 0.98, v1: 0.42 },
  collar: { u0: 0.02, v0: 0.04, u1: 0.98, v1: 0.18 },
};

interface IslandUV {
  /** local (metres) coordinates per island vertex key */
  local: Map<string, [number, number]>;
  width: number;
  height: number;
}

/** Prefix sums: [0, v0, v0+v1, ..., total] (length = vals.length + 1). */
function cumulative(vals: number[]): number[] {
  const out = [0];
  for (let i = 0; i < vals.length; i++) out.push(out[i]! + vals[i]!);
  return out;
}

function panelUV(canon: THREE.Vector3[], cols: number[]): IslandUV {
  // u: arc length along each row's ring, scaled about the panel centre so the
  // flat pattern tapers with the real circumference (yoke -> neck is an annulus,
  // not a rectangle); v: nominal heights per row.
  const rowArc = (row: number) => {
    const segs: number[] = [];
    for (let c = 0; c < cols.length - 1; c++) segs.push(canon[gridId(row, cols[c]!)]!.distanceTo(canon[gridId(row, cols[c + 1]!)]!));
    return cumulative(segs);
  };
  const rowH: number[] = [];
  for (let r = 0; r < 5; r++) rowH.push(canon[gridId(r + 1, 0)]!.y - canon[gridId(r, 0)]!.y);
  // yoke: average of side (horizontal) and centre (front) distances from shoulder ring to neck ring
  const side = canon[gridId(5, 4)]!.distanceTo(canon[gridId(6, 4)]!);
  const centre = canon[gridId(5, 0)]!.distanceTo(canon[gridId(6, 0)]!);
  rowH.push((side + centre) / 2);
  const vs = cumulative(rowH);
  const arcs: number[][] = [];
  let width = 0;
  for (let r = 0; r <= NECK_ROW; r++) {
    const us = rowArc(r);
    arcs.push(us);
    width = Math.max(width, us[us.length - 1]!);
  }
  const local = new Map<string, [number, number]>();
  for (let r = 0; r <= NECK_ROW; r++) {
    const us = arcs[r]!;
    const rowW = us[us.length - 1]!;
    const offset = (width - rowW) / 2; // centre each row inside the island
    for (let c = 0; c < cols.length; c++) local.set(`${r}:${c}`, [offset + us[c]!, vs[r]!]);
  }
  return { local, width, height: vs[vs.length - 1]! };
}

function sleeveUV(canon: THREE.Vector3[], side: WearerSide): IslandUV {
  const loop = side === 'left' ? ARMHOLE_LEFT : ARMHOLE_RIGHT;
  const ringPos = (ring: number, m: number) =>
    ring === 0 ? canon[gridId(loop[m]![0], loop[m]![1])]! : canon[sleeveId(side, ring, m)]!;
  // u: mean of root-ring and cuff-ring segment lengths; v: distance along rings
  const segs: number[] = [];
  for (let m = 0; m < SLEEVE_N; m++) {
    const n = (m + 1) % SLEEVE_N;
    segs.push((ringPos(0, m).distanceTo(ringPos(0, n)) + ringPos(2, m).distanceTo(ringPos(2, n))) / 2);
  }
  const us = cumulative(segs);
  const ringV: number[] = [];
  for (let ring = 0; ring < SLEEVE_RINGS - 1; ring++) {
    let d = 0;
    for (let m = 0; m < SLEEVE_N; m++) d += ringPos(ring, m).distanceTo(ringPos(ring + 1, m));
    ringV.push(d / SLEEVE_N);
  }
  const vs = cumulative(ringV);
  const local = new Map<string, [number, number]>();
  for (let ring = 0; ring < SLEEVE_RINGS; ring++) for (let m = 0; m <= SLEEVE_N; m++) local.set(`${ring}:${m}`, [us[m]!, vs[ring]!]);
  return { local, width: us[SLEEVE_N]!, height: vs[vs.length - 1]! };
}

function collarUV(canon: THREE.Vector3[]): IslandUV {
  const segs: number[] = [];
  for (let c = 0; c < COLLAR_COLS.length - 1; c++) {
    const a = canon[gridId(NECK_ROW, COLLAR_COLS[c]!)]!.distanceTo(canon[gridId(NECK_ROW, COLLAR_COLS[c + 1]!)]!);
    const b = canon[gridId(COLLAR_ROW, COLLAR_COLS[c]!)]!.distanceTo(canon[gridId(COLLAR_ROW, COLLAR_COLS[c + 1]!)]!);
    segs.push((a + b) / 2);
  }
  const us = cumulative(segs);
  let h = 0;
  for (let c = 0; c < M; c++) h += canon[gridId(NECK_ROW, c)]!.distanceTo(canon[gridId(COLLAR_ROW, c)]!);
  h /= M;
  const local = new Map<string, [number, number]>();
  for (let c = 0; c < COLLAR_COLS.length; c++) {
    local.set(`0:${c}`, [us[c]!, 0]);
    local.set(`1:${c}`, [us[c]!, h]);
  }
  return { local, width: us[us.length - 1]!, height: h };
}

export interface UVLayout {
  uvScale: number;
  islands: Record<IslandName, { uv: IslandUV; rect: IslandMeta['uvRect']; origin: [number, number] }>;
}

export function computeUVLayout(): UVLayout {
  const canon = logicalPositions(defaultTShirtParams());
  const raw: Record<IslandName, IslandUV> = {
    front: panelUV(canon, FRONT_COLS),
    back: panelUV(canon, BACK_COLS),
    sleeve_left: sleeveUV(canon, 'left'),
    sleeve_right: sleeveUV(canon, 'right'),
    collar: collarUV(canon),
  };
  let uvScale = Infinity;
  for (const name of ISLAND_NAMES) {
    const r = UV_RECTS[name];
    const isl = raw[name];
    uvScale = Math.min(uvScale, (r.u1 - r.u0) / isl.width, (r.v1 - r.v0) / isl.height);
  }
  const islands = {} as UVLayout['islands'];
  for (const name of ISLAND_NAMES) {
    const r = UV_RECTS[name];
    const isl = raw[name];
    const w = isl.width * uvScale;
    const h = isl.height * uvScale;
    const origin: [number, number] = [r.u0 + ((r.u1 - r.u0) - w) / 2, r.v0 + ((r.v1 - r.v0) - h) / 2];
    islands[name] = { uv: isl, rect: r, origin };
  }
  return { uvScale, islands };
}

let cachedLayout: UVLayout | null = null;
function layout(): UVLayout {
  if (!cachedLayout) cachedLayout = computeUVLayout();
  return cachedLayout;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildTShirt(partial: Partial<Record<keyof TShirtParams, number>> = {}): TShirtMesh {
  const { params } = clampTShirtParams(partial);
  const lpos = logicalPositions(params);
  const lay = layout();

  const positions: number[] = [];
  const uvs: number[] = [];
  const logicalIndex: number[] = [];
  const indices: number[] = [];
  const islands: IslandMeta[] = [];

  const pushVertex = (logical: number, uv: [number, number]): number => {
    const q = lpos[logical]!;
    positions.push(q.x, q.y, q.z);
    uvs.push(uv[0], uv[1]);
    logicalIndex.push(logical);
    return positions.length / 3 - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };
  const toUV = (name: IslandName, key: string): [number, number] => {
    const isl = lay.islands[name];
    const loc = isl.uv.local.get(key);
    if (!loc) throw new Error(`no uv for ${name} ${key}`);
    return [isl.origin[0] + loc[0] * lay.uvScale, isl.origin[1] + loc[1] * lay.uvScale];
  };

  // --- panels -------------------------------------------------------------
  const panel = (name: IslandName, cols: number[], materialIndex: number) => {
    const indexStart = indices.length;
    const verts: number[] = [];
    const grid = new Map<string, number>();
    for (let r = 0; r <= NECK_ROW; r++) {
      for (let c = 0; c < cols.length; c++) {
        // row 4 side vertices in the middle of the armhole are not part of the surface
        if (r === 4 && (cols[c] === 4 || cols[c] === 12)) continue;
        const id = pushVertex(gridId(r, cols[c]!), toUV(name, `${r}:${c}`));
        grid.set(`${r}:${c}`, id);
        verts.push(id);
      }
    }
    for (let r = 0; r < NECK_ROW; r++) {
      for (let c = 0; c < cols.length - 1; c++) {
        if (REMOVED_SPANS.has(`${r}:${cols[c]}`)) continue;
        quad(grid.get(`${r}:${c}`)!, grid.get(`${r}:${c + 1}`)!, grid.get(`${r + 1}:${c + 1}`)!, grid.get(`${r + 1}:${c}`)!);
      }
    }
    islands.push({ name, materialIndex, indexStart, indexCount: indices.length - indexStart, vertices: verts, uvRect: UV_RECTS[name] });
  };
  panel('front', FRONT_COLS, 0);
  panel('back', BACK_COLS, 1);

  // --- sleeves ------------------------------------------------------------
  const sleeve = (name: 'sleeve_left' | 'sleeve_right', materialIndex: number) => {
    const side: WearerSide = name === 'sleeve_left' ? 'left' : 'right';
    const loop = side === 'left' ? ARMHOLE_LEFT : ARMHOLE_RIGHT;
    const indexStart = indices.length;
    const verts: number[] = [];
    const grid: number[][] = [];
    for (let ring = 0; ring < SLEEVE_RINGS; ring++) {
      const row: number[] = [];
      for (let m = 0; m <= SLEEVE_N; m++) {
        const mm = m % SLEEVE_N;
        const logical = ring === 0 ? gridId(loop[mm]![0], loop[mm]![1]) : sleeveId(side, ring, mm);
        const id = pushVertex(logical, toUV(name, `${ring}:${m}`));
        row.push(id);
        verts.push(id);
      }
      grid.push(row);
    }
    for (let ring = 0; ring < SLEEVE_RINGS - 1; ring++) {
      for (let m = 0; m < SLEEVE_N; m++) {
        quad(grid[ring]![m]!, grid[ring]![m + 1]!, grid[ring + 1]![m + 1]!, grid[ring + 1]![m]!);
      }
    }
    islands.push({ name, materialIndex, indexStart, indexCount: indices.length - indexStart, vertices: verts, uvRect: UV_RECTS[name] });
  };
  sleeve('sleeve_left', 2);
  sleeve('sleeve_right', 3);

  // --- collar -------------------------------------------------------------
  {
    const indexStart = indices.length;
    const verts: number[] = [];
    const outer: number[] = [];
    const inner: number[] = [];
    for (let c = 0; c < COLLAR_COLS.length; c++) {
      const o = pushVertex(gridId(NECK_ROW, COLLAR_COLS[c]!), toUV('collar', `0:${c}`));
      const i = pushVertex(gridId(COLLAR_ROW, COLLAR_COLS[c]!), toUV('collar', `1:${c}`));
      outer.push(o);
      inner.push(i);
      verts.push(o, i);
    }
    for (let c = 0; c < COLLAR_COLS.length - 1; c++) quad(outer[c]!, outer[c + 1]!, inner[c + 1]!, inner[c]!);
    islands.push({ name: 'collar', materialIndex: 4, indexStart, indexCount: indices.length - indexStart, vertices: verts, uvRect: UV_RECTS.collar });
  }

  // --- geometry -----------------------------------------------------------
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  for (const isl of islands) geometry.addGroup(isl.indexStart, isl.indexCount, isl.materialIndex);
  const lidx = Int32Array.from(logicalIndex);
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(smoothNormals(positions, indices, lidx, LOGICAL_COUNT), 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `${TSHIRT_TEMPLATE_ID}@${TSHIRT_TEMPLATE_VERSION}`;

  // --- metadata -----------------------------------------------------------
  const ringCols = (row: number) => Array.from({ length: M }, (_, c) => gridId(row, c));
  const rings: RingMeta[] = [
    { name: 'hem', logical: ringCols(0), isOpening: true },
    { name: 'waist', logical: ringCols(1), isOpening: false },
    { name: 'chest', logical: ringCols(2), isOpening: false },
    { name: 'armpit', logical: ringCols(3), isOpening: false },
    { name: 'shoulder', logical: ringCols(5), isOpening: false },
    { name: 'neck', logical: ringCols(NECK_ROW), isOpening: false },
    { name: 'collar_inner', logical: ringCols(COLLAR_ROW), isOpening: true },
    { name: 'armhole_left', logical: ARMHOLE_LEFT.map(([r, c]) => gridId(r, c)), isOpening: false },
    { name: 'armhole_right', logical: ARMHOLE_RIGHT.map(([r, c]) => gridId(r, c)), isOpening: false },
    { name: 'cuff_left', logical: Array.from({ length: SLEEVE_N }, (_, m) => sleeveId('left', 2, m)), isOpening: true },
    { name: 'cuff_right', logical: Array.from({ length: SLEEVE_N }, (_, m) => sleeveId('right', 2, m)), isOpening: true },
  ];
  // seam names are wearer sides too: col 4 is +X = wearer's left
  const seams: SeamMeta[] = [
    { name: 'side_left', logical: [0, 1, 2, 3].map((r) => gridId(r, 4)) },
    { name: 'side_right', logical: [0, 1, 2, 3].map((r) => gridId(r, 12)) },
    { name: 'shoulder_left', logical: [5, 6].map((r) => gridId(r, 4)) },
    { name: 'shoulder_right', logical: [5, 6].map((r) => gridId(r, 12)) },
    { name: 'sleeve_left_underarm', logical: [gridId(3, 4), sleeveId('left', 1, 0), sleeveId('left', 2, 0)] },
    { name: 'sleeve_right_underarm', logical: [gridId(3, 12), sleeveId('right', 1, 0), sleeveId('right', 2, 0)] },
    { name: 'collar_back', logical: [gridId(NECK_ROW, 8), gridId(COLLAR_ROW, 8)] },
  ];

  return {
    templateId: TSHIRT_TEMPLATE_ID,
    templateVersion: TSHIRT_TEMPLATE_VERSION,
    topologyVersion: TSHIRT_TOPOLOGY_VERSION,
    params,
    geometry,
    logicalIndex: lidx,
    logicalCount: LOGICAL_COUNT,
    islands,
    rings,
    seams,
    uvScale: lay.uvScale,
    stats: { vertices: positions.length / 3, logicalVertices: new Set(logicalIndex).size, triangles: indices.length / 3 },
  };
}

/**
 * Update positions of an existing mesh in place for new params (same topology).
 * Keeps UVs and index buffer; recomputes normals. This is the "deform from the
 * canonical base" path — nothing accumulates between calls.
 */
export function updateTShirt(mesh: TShirtMesh, partial: Partial<Record<keyof TShirtParams, number>>): TShirtMesh {
  const { params } = clampTShirtParams(partial);
  const lpos = logicalPositions(params);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < mesh.logicalIndex.length; i++) {
    const q = lpos[mesh.logicalIndex[i]!]!;
    arr[i * 3] = q.x;
    arr[i * 3 + 1] = q.y;
    arr[i * 3 + 2] = q.z;
  }
  pos.needsUpdate = true;
  const idx = Array.from(mesh.geometry.index!.array);
  const normals = smoothNormals(Array.from(arr), idx, mesh.logicalIndex, mesh.logicalCount);
  const nAttr = mesh.geometry.attributes.normal as THREE.BufferAttribute;
  (nAttr.array as Float32Array).set(normals);
  nAttr.needsUpdate = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.params = params;
  return mesh;
}

/** Area-weighted normals accumulated per LOGICAL vertex, so UV seams shade smoothly. */
function smoothNormals(positions: number[], indices: number[], logicalIndex: Int32Array, logicalCount: number): Float32Array {
  const acc = new Float64Array(logicalCount * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!;
    const i1 = indices[t + 1]!;
    const i2 = indices[t + 2]!;
    a.fromArray(positions, i0 * 3);
    b.fromArray(positions, i1 * 3);
    c.fromArray(positions, i2 * 3);
    n.subVectors(b, a).cross(c.clone().sub(a)); // length = 2 * area
    for (const i of [i0, i1, i2]) {
      const l = logicalIndex[i]!;
      acc[l * 3] = acc[l * 3]! + n.x;
      acc[l * 3 + 1] = acc[l * 3 + 1]! + n.y;
      acc[l * 3 + 2] = acc[l * 3 + 2]! + n.z;
    }
  }
  const out = new Float32Array(logicalIndex.length * 3);
  for (let i = 0; i < logicalIndex.length; i++) {
    const l = logicalIndex[i]!;
    n.set(acc[l * 3]!, acc[l * 3 + 1]!, acc[l * 3 + 2]!);
    if (n.lengthSq() > 0) n.normalize();
    else n.set(0, 1, 0);
    out[i * 3] = n.x;
    out[i * 3 + 1] = n.y;
    out[i * 3 + 2] = n.z;
  }
  return out;
}
