/**
 * Sides. Two different vocabularies that must never be mixed:
 *
 *  - GARMENT / WEARER side (`WearerSide`): 'left' | 'right' as the person
 *    wearing the garment would say. All semantic IDs in templates use this:
 *    `sleeve_left`, `cuff_right`, `armhole_left`, landmarks `shoulder_left`...
 *    In adapter/template space the wearer's LEFT is +X (the body faces +Z,
 *    so a viewer in front sees the wearer's left on screen-right).
 *
 *  - IMAGE side (`ImageSide`): 'image_left' | 'image_right' = where something
 *    is in the photo as displayed. Which wearer side that is depends on the
 *    view (front / back) and on whether the image is mirrored (selfie-style
 *    capture, flipped scan).
 *
 * `imageSideToWearerSide` is the ONLY allowed bridge between the two.
 */

export type WearerSide = 'left' | 'right';
export type ImageSide = 'image_left' | 'image_right';
export type GarmentView = 'front' | 'back';

/** Sign of X in template/adapter space for a wearer side. */
export const WEARER_SIDE_X_SIGN: Record<WearerSide, 1 | -1> = { left: 1, right: -1 };

export function wearerSideFromX(x: number): WearerSide | null {
  if (x > 0) return 'left';
  if (x < 0) return 'right';
  return null;
}

export function oppositeSide(s: WearerSide): WearerSide {
  return s === 'left' ? 'right' : 'left';
}

/**
 * Map a side in the image to the wearer's side.
 *
 * Front view, not mirrored: the garment faces the camera, so image_right is the
 * wearer's LEFT (like shaking hands). Back view flips that. A mirrored image
 * flips it again.
 */
export function imageSideToWearerSide(side: ImageSide, view: GarmentView, mirrored = false): WearerSide {
  let flip = view === 'front'; // front: image_right -> wearer left
  if (mirrored) flip = !flip;
  const asIs: WearerSide = side === 'image_left' ? 'left' : 'right';
  return flip ? oppositeSide(asIs) : asIs;
}

export function wearerSideToImageSide(side: WearerSide, view: GarmentView, mirrored = false): ImageSide {
  const l = imageSideToWearerSide('image_left', view, mirrored);
  return l === side ? 'image_left' : 'image_right';
}

/** Island / ring name for a wearer side, e.g. sideName('sleeve', 'left') -> 'sleeve_left'. */
export function sideName<B extends string>(base: B, side: WearerSide): `${B}_${WearerSide}` {
  return `${base}_${side}`;
}
