/**
 * CategoryProvider — suggests garment categories for a photo.
 *
 * Suggestions are SUGGESTIONS: the user confirms the category separately
 * (GarmentRecord.category.confirmed). Scores are uncalibrated and are never
 * shown as "accuracy %".
 */
import type { CategorySuggestion, GarmentCategory } from '../domain/types';
import { centerCropSquare, resizeRaster, softmax, toCHWFloat, type RasterImage } from '../image/raster';
import { float32Tensor, loadSession, type OrtSession } from './onnx';

export interface CategoryProvider {
  readonly id: string;
  readonly version: string;
  /** Human-readable description of what actually runs (model, weights, backend). */
  readonly description: string;
  /** Loads weights; may be slow the first time. */
  load(): Promise<void>;
  suggest(image: RasterImage, signal?: AbortSignal): Promise<CategoryResult>;
  dispose(): Promise<void>;
}

export interface CategoryResult {
  providerId: string;
  providerVersion: string;
  /** Aggregated per-category suggestions, best first. Scores are uncalibrated, sum ≤ 1. */
  suggestions: CategorySuggestion[];
  /** Raw top classes of the underlying model, for transparency/debugging. */
  rawTop: { index: number; label: string; score: number }[];
  /** Milliseconds spent in inference (not including load). */
  inferenceMs: number;
}

// ---------------------------------------------------------------------------
// ImageNet (MobileNetV2-12, ONNX model zoo, Apache-2.0) -> garment categories
// ---------------------------------------------------------------------------

/**
 * ImageNet-1k class indices mapped to our categories. Everything else is
 * "other". The mapping is deliberately narrow: a sweatshirt (841) or a
 * cardigan (474) is NOT a tshirt for this module.
 */
export const IMAGENET_CATEGORY_MAP: Record<number, GarmentCategory> = {
  610: 'tshirt', // jersey, T-shirt, tee shirt
  608: 'pants', // jean, blue jean, denim
  655: 'skirt', // miniskirt
  689: 'skirt', // overskirt
  601: 'skirt', // hoopskirt
};

export const IMAGENET_CATEGORY_PROVIDER_ID = 'imagenet-mobilenetv2-12';
export const IMAGENET_CATEGORY_PROVIDER_VERSION = 'mobilenetv2-12.onnx@sha256:c0c3f76d…32ad5;map-v1';

export class ImageNetCategoryProvider implements CategoryProvider {
  readonly id = IMAGENET_CATEGORY_PROVIDER_ID;
  readonly version = IMAGENET_CATEGORY_PROVIDER_VERSION;
  readonly description =
    'MobileNetV2-12 (ONNX model zoo, ImageNet-1k, Apache-2.0) run locally with onnxruntime-web; ImageNet classes jersey/T-shirt, jean, *skirt mapped to tshirt/pants/skirt, everything else = other. Scores are softmax mass per category (uncalibrated).';

  private session: OrtSession | null = null;
  private labels: string[] = [];

  constructor(
    private readonly modelPath: string,
    private readonly synsetText: string,
  ) {}

  async load(): Promise<void> {
    if (this.session) return;
    this.labels = this.synsetText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^n\d+\s+/, ''));
    if (this.labels.length !== 1000) throw new Error(`synset: expected 1000 labels, got ${this.labels.length}`);
    this.session = await loadSession(this.modelPath);
  }

  async suggest(image: RasterImage, signal?: AbortSignal): Promise<CategoryResult> {
    if (!this.session) await this.load();
    signal?.throwIfAborted();
    // ONNX zoo recipe: resize shorter side to 256, centre crop 224, normalise with ImageNet mean/std
    const side = Math.min(image.width, image.height);
    const scale = 256 / side;
    const resized = resizeRaster(image, Math.round(image.width * scale), Math.round(image.height * scale));
    const square = centerCropSquare(resized).image;
    const input = resizeRaster(square, 224, 224);
    const chw = toCHWFloat(input, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
    const t0 = performance.now();
    const out = await this.session!.run({ input: float32Tensor(chw, [1, 3, 224, 224]) });
    const inferenceMs = performance.now() - t0;
    signal?.throwIfAborted();
    const logits = out['output']!.data as Float32Array;
    const probs = softmax(logits);
    const order = Array.from(probs.keys()).sort((a, b) => probs[b]! - probs[a]!);
    const rawTop = order.slice(0, 5).map((i) => ({ index: i, label: this.labels[i]!, score: probs[i]! }));
    const mass: Record<GarmentCategory, number> = { tshirt: 0, pants: 0, skirt: 0, other: 0 };
    for (let i = 0; i < probs.length; i++) mass[IMAGENET_CATEGORY_MAP[i] ?? 'other'] += probs[i]!;
    const suggestions: CategorySuggestion[] = (Object.keys(mass) as GarmentCategory[])
      .map((category) => ({ category, score: mass[category], providerId: this.id, providerVersion: this.version }))
      .sort((a, b) => b.score - a.score);
    return { providerId: this.id, providerVersion: this.version, suggestions, rawTop, inferenceMs };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = null;
  }
}

/**
 * Manual mode: no model ran. Exists so the UI can be explicit that the
 * category was chosen by hand; it never produces suggestions.
 */
export class ManualCategoryProvider implements CategoryProvider {
  readonly id = 'manual';
  readonly version = '1';
  readonly description = 'No automatic recognition — the user picks the category.';
  async load() {}
  async suggest(): Promise<CategoryResult> {
    return { providerId: this.id, providerVersion: this.version, suggestions: [], rawTop: [], inferenceMs: 0 };
  }
  async dispose() {}
}
