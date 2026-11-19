import { FitTag, GarmentType } from '@prisma/client';

/** Palette shared with the recommendation-service contract (ColorName). */
export const COLOR_NAMES = [
  'black', 'white', 'gray', 'beige', 'brown', 'red', 'orange',
  'yellow', 'green', 'blue', 'navy', 'purple', 'pink',
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const GARMENT_TYPES = Object.values(GarmentType);
export const FIT_TAGS = Object.values(FitTag);

export const UPLOAD_ROOT = 'uploads';
export const WARDROBE_UPLOAD_DIR = `${UPLOAD_ROOT}/wardrobe`;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};
