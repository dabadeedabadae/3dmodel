import type { EventType, FitTag, GarmentType, Precipitation } from './api';

export const GARMENT_LABELS: Record<GarmentType, string> = {
  TSHIRT: 'T-shirt', SHIRT: 'Shirt', JACKET: 'Jacket', COAT: 'Coat', SWEATER: 'Sweater',
  HOODIE: 'Hoodie', CARDIGAN: 'Cardigan', BLAZER: 'Blazer', PANTS: 'Pants', JEANS: 'Jeans', SHORTS: 'Shorts',
  SKIRT: 'Skirt', DRESS: 'Dress', SHOES: 'Shoes', ACCESSORY: 'Accessory',
};

export const FIT_LABELS: Record<FitTag, string> = { GOOD: 'Fits well', TIGHT: 'Too tight', LOOSE: 'Too loose' };

export const EVENT_LABELS: Record<EventType, string> = {
  CASUAL: 'Casual', GYM: 'Gym', BUSINESS: 'Business meeting', FORMAL: 'Formal event', OUTDOOR: 'Outdoors',
  DATE: 'Date', WEDDING_GUEST: 'Wedding (guest)', INTERVIEW: 'Job interview', PARTY: 'Party',
  THEATER: 'Theater or restaurant', TRAVEL: 'Travel', STUDY: 'Study', FAMILY_WALK: 'Walk with kids',
};

export const PRECIPITATION_LABELS: Record<Precipitation, string> = { NONE: 'No precipitation', RAIN: 'Rain', SNOW: 'Snow', MIXED: 'Rain and snow' };

/** what each occasion usually asks of an outfit (shown when picking the event type) */
export const EVENT_HINTS: Record<EventType, string> = {
  CASUAL: 'Everyday comfort', GYM: 'Sportswear, freedom of movement', BUSINESS: 'Neat and restrained',
  FORMAL: 'Smart, dressed up', OUTDOOR: 'Practical, ready for the weather',
  DATE: 'A bit dressed up, your style', WEDDING_GUEST: 'Festive, but not white', INTERVIEW: 'Blazer, shirt, calm colors',
  PARTY: 'Bright colors welcome', THEATER: 'Smart casual, no hoodie', TRAVEL: 'Comfortable layers',
  STUDY: 'Comfortable and neat', FAMILY_WALK: 'Practical, easy to move in',
};

/** A symbol for a WMO weather code (Open-Meteo `weather_code`). */
export function weatherIcon(code: number): string {
  if (code === 0 || code === 1) return '☀\uFE0F';
  if (code === 2) return '⛅';
  if (code === 3) return '☁\uFE0F';
  if (code === 45 || code === 48) return '🌫';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄\uFE0F';
  if (code >= 95) return '⛈\uFE0F';
  if (code >= 51) return '🌧';
  return '☁\uFE0F';
}

export const formatTemp = (c: number) => `${c > 0 ? '+' : ''}${Math.round(c)}°`;

/** The 13-colour palette of the recommendation contract, with display values. */
export const COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'black', label: 'Black', hex: '#1b1b1f' },
  { id: 'white', label: 'White', hex: '#f4f4f2' },
  { id: 'gray', label: 'Gray', hex: '#8d9097' },
  { id: 'beige', label: 'Beige', hex: '#d8c3a0' },
  { id: 'brown', label: 'Brown', hex: '#7a5134' },
  { id: 'red', label: 'Red', hex: '#c62f35' },
  { id: 'orange', label: 'Orange', hex: '#e57a2c' },
  { id: 'yellow', label: 'Yellow', hex: '#e8c53a' },
  { id: 'green', label: 'Green', hex: '#3f8a4c' },
  { id: 'blue', label: 'Blue', hex: '#3a6fd1' },
  { id: 'navy', label: 'Navy', hex: '#1f2f5c' },
  { id: 'purple', label: 'Purple', hex: '#7b4bb3' },
  { id: 'pink', label: 'Pink', hex: '#e48fb0' },
];
export const colorById = (id: string) => COLORS.find((c) => c.id === id);

/** Nearest palette colour to an sRGB hex (redmean distance), e.g. the median colour of a garment mask. */
export function nearestPaletteColor(hex: string): string {
  const px = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let best = COLORS[0]!.id, bestD = Infinity;
  for (const c of COLORS) {
    const q = [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16));
    const rm = (px[0]! + q[0]!) / 2;
    const d = (2 + rm / 256) * (px[0]! - q[0]!) ** 2 + 4 * (px[1]! - q[1]!) ** 2 + (2 + (255 - rm) / 256) * (px[2]! - q[2]!) ** 2;
    if (d < bestD) { bestD = d; best = c.id; }
  }
  return best;
}

/**
 * Suggests the palette colour of a garment photo: median of the centre region
 * (the garment usually fills it), snapped to the nearest palette colour in Lab-ish
 * space. A hint for the user, not recognition — the user confirms or changes it.
 */
export async function suggestColor(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) { bitmap.close(); return null; }
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  const { data } = ctx.getImageData(size * 0.3, size * 0.3, size * 0.4, size * 0.4);
  const r: number[] = [], g: number[] = [], b: number[] = [];
  for (let i = 0; i < data.length; i += 4) { r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]); }
  const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
  const px = [median(r), median(g), median(b)];
  const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let best: string | null = null, bestD = Infinity;
  for (const c of COLORS) {
    const [cr, cg, cb] = hexRgb(c.hex);
    const rm = (px[0] + cr) / 2; // "redmean" perceptual approximation
    const d = (2 + rm / 256) * (px[0] - cr) ** 2 + 4 * (px[1] - cg) ** 2 + (2 + (255 - rm) / 256) * (px[2] - cb) ** 2;
    if (d < bestD) { bestD = d; best = c.id; }
  }
  return best;
}
