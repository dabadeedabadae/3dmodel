/**
 * Domain types for FitCast Photo Garments.
 *
 * Design rules (from the plan):
 *  - AI suggestions, user-confirmed values and measured values are kept apart.
 *  - Unknown areas stay `unknown` / `default`, never "reconstructed".
 *  - No centimetres are derived from pixels without an explicit scale source.
 *  - Every stored artefact carries the versions it was produced with.
 */

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Garment categories understood by the module. Only `tshirt` has a 3D template in the first vertical. */
export type GarmentCategory = 'tshirt' | 'pants' | 'skirt' | 'other';

export const GARMENT_CATEGORIES: readonly GarmentCategory[] = ['tshirt', 'pants', 'skirt', 'other'];

// ---------------------------------------------------------------------------
// Provenance — where a value came from
// ---------------------------------------------------------------------------

/**
 * Who produced a value.
 *  - `default`       — template default, nothing was measured or estimated
 *  - `estimated`     — produced automatically (AI / image analysis); uncalibrated
 *  - `user_measured` — typed in by the user (e.g. garment length in cm)
 *  - `user_adjusted` — a slider / manual edit by the user on top of something else
 */
export type Provenance = 'default' | 'estimated' | 'user_measured' | 'user_adjusted';

export interface Sourced<T> {
  value: T;
  source: Provenance;
  /**
   * Uncalibrated score in [0,1] for `estimated` values. It is NOT a probability
   * and must never be shown as "accuracy %". Absent for non-estimated values.
   */
  score?: number;
  /** Free-form note, e.g. the provider id that produced the estimate. */
  note?: string;
}

export function sourced<T>(value: T, source: Provenance, extra: { score?: number; note?: string } = {}): Sourced<T> {
  const out: Sourced<T> = { value, source };
  if (extra.score !== undefined) out.score = extra.score;
  if (extra.note !== undefined) out.note = extra.note;
  return out;
}

// ---------------------------------------------------------------------------
// Category: AI suggestion vs user confirmation are separate fields
// ---------------------------------------------------------------------------

export interface CategorySuggestion {
  category: GarmentCategory;
  /** Uncalibrated score, see Sourced.score. */
  score: number;
  providerId: string;
  providerVersion: string;
}

export interface CategoryState {
  /** Top-k suggestions from a CategoryProvider; empty when no provider ran. */
  suggestions: CategorySuggestion[];
  /** What the user confirmed. `null` until the user confirms — suggestions alone never count. */
  confirmed: GarmentCategory | null;
  /** True when the user picked a category by hand with no provider result (manual mode). */
  manual: boolean;
}

// ---------------------------------------------------------------------------
// Photo input
// ---------------------------------------------------------------------------

export interface PhotoRef {
  /** Stable id for the photo blob inside the local wardrobe store. */
  id: string;
  /** Which side of the garment this photo shows. Only `front` is used by the MVP. */
  side: 'front' | 'back' | 'unknown';
  /** Original file metadata. The original bytes are stored untouched. */
  original: { width: number; height: number; mimeType: string; byteLength: number; fileName?: string };
  /** Working copy limits (orientation-normalised, downscaled). Null until stage 05 produces it. */
  normalized: null | {
    width: number;
    height: number;
    /** 3x3 affine (row-major) mapping normalized-pixel -> original-pixel coordinates. */
    toOriginal: [number, number, number, number, number, number, number, number, number];
  };
}

// ---------------------------------------------------------------------------
// Mask, landmarks, scale
// ---------------------------------------------------------------------------

export interface MaskRef {
  id: string;
  photoId: string;
  /** Mask is stored in normalized-photo pixel coordinates. */
  width: number;
  height: number;
  source: Provenance; // estimated (auto) or user_adjusted (edited)
  /** Set when the user explicitly confirmed the mask. A mask is never confirmed implicitly. */
  confirmed: boolean;
  providerId?: string;
  providerVersion?: string;
}

export type TShirtLandmarkName =
  | 'shoulder_left'
  | 'shoulder_right'
  | 'armpit_left'
  | 'armpit_right'
  | 'cuff_left_top'
  | 'cuff_left_bottom'
  | 'cuff_right_top'
  | 'cuff_right_bottom'
  | 'neck_left'
  | 'neck_right'
  | 'neck_front_bottom'
  | 'hem_left'
  | 'hem_right';

export interface Landmark {
  name: string;
  /** Normalized-photo pixel coordinates. */
  x: number;
  y: number;
  source: Provenance;
  score?: number;
  /** `unknown` when the point could not be determined and no user input exists. */
  status: 'ok' | 'uncertain' | 'unknown';
}

/**
 * Where real-world size comes from. `none` = normalized visualisation only
 * (no centimetres anywhere). Pixels never become centimetres without this.
 */
export type ScaleSource =
  | { kind: 'none' }
  | { kind: 'user_measured'; lengthCm?: number; flatWidthCm?: number }
  | { kind: 'reference_object'; note: string; pxPerCm: number };

// ---------------------------------------------------------------------------
// Template parameters
// ---------------------------------------------------------------------------

/** A template parameter value with provenance. Numbers are in template units (see template docs). */
export type GarmentParams = Record<string, Sourced<number>>;

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

export interface TextureRef {
  id: string;
  kind: 'uv_raw' | 'uv_color_corrected' | 'uv_pixelated' | 'checker';
  width: number;
  height: number;
  /** Which UV islands actually received photo data; others are filled with a flat colour and flagged. */
  coveredIslands: string[];
  /** Islands filled with a base colour because they are not visible in the photo (e.g. back). Conditional, not reconstructed. */
  conditionalIslands: string[];
  processingVersion: number;
}

// ---------------------------------------------------------------------------
// Stage status
// ---------------------------------------------------------------------------

export type StageStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

export interface StageResult<T> {
  status: StageStatus;
  /** Hash/version of the inputs this result was computed from. Used for invalidation. */
  inputVersion: string;
  value: T | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// GarmentRecord — the persisted unit
// ---------------------------------------------------------------------------

export interface AvatarCompatibility {
  /** Adapter id the garment was last fitted to (e.g. `test-chibi`). */
  avatarId: string;
  avatarVersion: string;
  /** `test` means the garment has only ever been fitted to a test mannequin. */
  avatarKind: 'test' | 'production';
  /** Last known fit status; `unknown` until stage 04 exists. */
  fit: 'unknown' | 'ok' | 'out_of_range' | 'incompatible';
}

export interface GarmentRecord {
  schemaVersion: number;
  id: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO

  category: CategoryState;

  /** Template used for the 3D shape; null until a category with a template is confirmed. */
  template: null | { templateId: string; templateVersion: string; topologyVersion: string };

  photos: PhotoRef[];
  masks: MaskRef[];
  landmarks: Landmark[];

  params: GarmentParams;
  scale: ScaleSource;

  textures: TextureRef[];

  /** Free-form user tags, kept for the future recommender. Not interpreted here. */
  tags: string[];
  /** Dominant colour as sRGB hex; provenance tells whether it was estimated or picked. */
  baseColor: Sourced<string> | null;

  processingVersion: number;
  avatar: AvatarCompatibility | null;
}

export function createEmptyGarmentRecord(id: string, now: Date = new Date()): GarmentRecord {
  const iso = now.toISOString();
  return {
    schemaVersion: 1,
    id,
    createdAt: iso,
    updatedAt: iso,
    category: { suggestions: [], confirmed: null, manual: false },
    template: null,
    photos: [],
    masks: [],
    landmarks: [],
    params: {},
    scale: { kind: 'none' },
    textures: [],
    tags: [],
    baseColor: null,
    processingVersion: 0,
    avatar: null,
  };
}
