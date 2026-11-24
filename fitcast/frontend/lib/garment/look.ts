/**
 * What the photographed top looks like, from its landmark points (I-75): sleeve length against the shoulder
 * width. Measured on the project's photos (out/photo/*): T-shirts 0.16–0.36, long sleeves 0.53–0.64, so the
 * cut is at 0.45. The neckline depth from the points was the same (0.21) on nearly every photo — it does not
 * separate a V-neck from a crew neck and is not used.
 */
import type { PhotoAnchors } from '../figure/photoMap';

type P = { x: number; y: number };
const d = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function sleeveFromAnchors(anchors: PhotoAnchors): 'short' | 'long' | null {
  const P = anchors.points;
  const sw = d(P.shoulder_left, P.shoulder_right);
  if (!(sw > 0)) return null;
  const len = (d(P.armpit_left, mid(P.cuff_left_top, P.cuff_left_bottom)) + d(P.armpit_right, mid(P.cuff_right_top, P.cuff_right_bottom))) / 2;
  return len / sw >= 0.45 ? 'long' : 'short';
}
