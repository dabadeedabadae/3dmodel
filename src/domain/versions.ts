/**
 * Stable version identifiers. Every persisted record carries these so that a
 * later change in template topology, avatar contract or processing code can be
 * detected instead of silently producing a different result.
 */

/** Version of the photo-garments module as a whole. */
export const MODULE_VERSION = '0.1.0';

/**
 * Version of the (future) photo -> garment processing chain. Bumped whenever
 * segmentation / landmark / UV-transfer behaviour changes. Nothing automatic
 * exists yet, so this is 0 — a record with processingVersion 0 has no
 * automatic results.
 */
export const PROCESSING_VERSION = 0;

/** Version of the AvatarAdapter contract (interface shape), not of a mannequin. */
export const AVATAR_CONTRACT_VERSION = 1;

/** Version of the GarmentRecord schema. */
export const GARMENT_RECORD_SCHEMA_VERSION = 1;
