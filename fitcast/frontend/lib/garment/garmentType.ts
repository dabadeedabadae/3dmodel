/**
 * ImageNet classes → FitCast garment types (pure, no DOM: the browser and the node evaluation use the same map).
 *
 * MobileNetV2-12 (ONNX model zoo, ImageNet-1k, Apache-2.0) knows ~30 clothing classes. Each is mapped to the
 * site's GarmentType; the softmax mass of the classes is summed per type. The result is a SUGGESTION: the form
 * pre-selects the best type, says it was suggested from the photo and offers the next ones to tap. Scores are
 * uncalibrated and are never shown as accuracy. Measured on the project's photos (scripts/eval-garment-type.ts):
 * see reports/stage-I75-garment-type.md.
 */
import type { GarmentType } from '../api';
import type { ShapeFacts } from './shape';

export const IMAGENET_TO_TYPE: Record<number, GarmentType> = {
  610: 'TSHIRT', // jersey, T-shirt
  465: 'TSHIRT', // bulletproof vest — tank tops and tight tops land here
  639: 'TSHIRT', // maillot, tank suit
  841: 'SWEATER', // sweatshirt
  911: 'SWEATER', // wool (knitwear photographed close)
  735: 'SWEATER', // poncho (loose knit)
  474: 'CARDIGAN', // cardigan
  834: 'BLAZER', // suit
  906: 'SHIRT', // Windsor tie — a shirt with a tie
  457: 'SHIRT', // bow tie
  652: 'JACKET', // military uniform
  869: 'COAT', // trench coat
  568: 'COAT', // fur coat
  617: 'COAT', // lab coat
  501: 'COAT', // cloak
  608: 'JEANS', // jean, denim
  697: 'PANTS', // pajama
  842: 'SHORTS', // swimming trunks
  655: 'SKIRT', // miniskirt
  689: 'SKIRT', // overskirt
  601: 'SKIRT', // hoopskirt
  775: 'SKIRT', // sarong
  578: 'DRESS', // gown
  399: 'DRESS', // abaya
  614: 'DRESS', // kimono
  774: 'SHOES', // sandal
  630: 'SHOES', // Loafer
  502: 'SHOES', // clog
  770: 'SHOES', // running shoe
  514: 'SHOES', // cowboy boot
};

/** types a person most often means instead of the suggested one: offered next to it */
const NEAR: Partial<Record<GarmentType, GarmentType[]>> = {
  TSHIRT: ['SHIRT', 'SWEATER'],
  SWEATER: ['HOODIE', 'CARDIGAN'],
  CARDIGAN: ['SWEATER', 'BLAZER'],
  BLAZER: ['JACKET', 'COAT'],
  SHIRT: ['TSHIRT', 'BLAZER'],
  JACKET: ['COAT', 'HOODIE'],
  COAT: ['JACKET', 'BLAZER'],
  JEANS: ['PANTS', 'SHORTS'],
  PANTS: ['JEANS', 'SHORTS'],
  SHORTS: ['PANTS', 'SKIRT'],
  SKIRT: ['DRESS', 'SHORTS'],
  DRESS: ['SKIRT', 'COAT'],
};

export interface TypeSuggestion {
  /** best type, or null when no clothing class got enough mass (the photo may not show a garment) */
  type: GarmentType | null;
  /** softmax mass of the best type's classes (uncalibrated) */
  score: number;
  /** true when the best type is clearly ahead: the form may pre-select it */
  confident: boolean;
  /** up to 3 other types to offer, best first */
  alternatives: GarmentType[];
  /** raw top ImageNet classes, for transparency */
  rawTop: { index: number; label: string; score: number }[];
}

const LEGS: GarmentType[] = ['JEANS', 'PANTS', 'SHORTS'];
const TOPS: GarmentType[] = ['TSHIRT', 'SHIRT', 'SWEATER', 'HOODIE', 'CARDIGAN', 'BLAZER', 'JACKET', 'COAT'];

/**
 * The outline corrects what the texture got wrong (I-80). Trousers and shorts show two legs with a gap; without
 * the gap a "jeans" answer is a denim skirt or a blue top. Sleeves sticking out mean a top; an outline that
 * widens downwards with no sleeves and no legs is a skirt. Factors are coarse on purpose: the outline moves the
 * classes' mass, it never invents certainty.
 */
export function applyShape(mass: Map<GarmentType, number>, shape: ShapeFacts): void {
  const scale = (types: GarmentType[], k: number) => { for (const t of types) if (mass.has(t)) mass.set(t, mass.get(t)! * k); };
  const add = (t: GarmentType, v: number) => mass.set(t, (mass.get(t) ?? 0) + v);
  if (shape.split >= 0.8) {
    scale(LEGS, 3); scale([...TOPS, 'SKIRT', 'DRESS'], 0.2);
    scale(['SHORTS'], shape.aspect < 1.45 ? 2 : 0.5);
    return;
  }
  if (shape.split < 0.15) {
    scale(LEGS, 0.2);
    // sleeves: a short pair hints at a T-shirt, a long pair spread wide at a long-sleeved top
    if (shape.shoulder >= 1.15) { scale(['SKIRT'], 0.3); scale(LEGS, 0.5); add(shape.shoulder < 2 ? 'TSHIRT' : 'SWEATER', 0.1); }
    else if (shape.shoulder < 1.05 && shape.taper < 0.95 && shape.aspect < 1.05) add('SKIRT', 0.3);
  }
}

export function suggestGarmentType(probs: ArrayLike<number>, labels: string[], shape?: ShapeFacts | null): TypeSuggestion {
  const mass = new Map<GarmentType, number>();
  for (const [i, t] of Object.entries(IMAGENET_TO_TYPE)) mass.set(t, (mass.get(t) ?? 0) + probs[Number(i)]!);
  if (shape) applyShape(mass, shape);
  const ranked = [...mass.entries()].sort((a, b) => b[1] - a[1]);
  const clothing = ranked.reduce((s, [, m]) => s + m, 0);
  const [best, second] = ranked;
  const order = Array.from({ length: probs.length }, (_, i) => i).sort((a, b) => probs[b]! - probs[a]!);
  const rawTop = order.slice(0, 5).map((i) => ({ index: i, label: labels[i] ?? String(i), score: probs[i]! }));
  if (!best || clothing < 0.15) return { type: null, score: 0, confident: false, alternatives: [], rawTop };
  const alternatives: GarmentType[] = [];
  for (const [t, m] of ranked.slice(1)) if (m >= 0.05 && alternatives.length < 3) alternatives.push(t);
  for (const t of NEAR[best[0]] ?? []) if (alternatives.length < 3 && !alternatives.includes(t)) alternatives.push(t);
  return { type: best[0], score: best[1], confident: best[1] >= 0.35 && best[1] >= 2 * (second?.[1] ?? 0), alternatives, rawTop };
}
