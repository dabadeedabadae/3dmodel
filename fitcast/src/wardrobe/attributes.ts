import { BadRequestException } from '@nestjs/common';
import { COLOR_NAMES } from './wardrobe.constants';

/**
 * What the photo says about an item beyond its type and main colour (I-77), computed on the device when the item
 * is added (frontend/lib/garment/attributes.ts) and used by the recommendations:
 *  • pattern — "solid", or "pattern" (stripes, checks, a print: the photo is not one colour);
 *  • secondaryColor — the second colour of the 13-colour palette when it covers a real share of the item;
 *  • sleeve — "short" / "long" for tops whose points were found;
 *  • tone — "light" / "mid" / "dark" by the main colour's lightness.
 * Strictly shaped: unknown keys or values are rejected, never stored half-checked.
 */
export interface ItemAttributes {
  pattern?: 'solid' | 'pattern';
  secondaryColor?: string;
  sleeve?: 'short' | 'long';
  tone?: 'light' | 'mid' | 'dark';
}
const ALLOWED: Record<keyof ItemAttributes, readonly string[]> = {
  pattern: ['solid', 'pattern'], secondaryColor: COLOR_NAMES as readonly string[], sleeve: ['short', 'long'], tone: ['light', 'mid', 'dark'],
};

export function parseAttributes(raw: string): ItemAttributes {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new BadRequestException('The item attributes are not valid JSON.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('The item attributes must be an object.');
  const out: ItemAttributes = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const allowed = ALLOWED[k as keyof ItemAttributes];
    if (!allowed) throw new BadRequestException(`Unknown item attribute: ${k}.`);
    if (typeof val !== 'string' || !allowed.includes(val)) throw new BadRequestException(`Invalid value for the item attribute ${k}.`);
    (out as Record<string, string>)[k] = val;
  }
  return out;
}
