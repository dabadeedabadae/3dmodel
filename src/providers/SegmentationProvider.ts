/**
 * SegmentationProvider — mask of the garment in a normalized photo.
 *
 * The mask is a soft 0..255 alpha in NORMALIZED-PHOTO pixel coordinates (same
 * size as the input image), plus a binary post-processed version. The user
 * confirms/edits it separately (stage 07 editor).
 */
import { assessMask, postprocessSoftMask, type MaskQuality, type Region } from '../image/maskOps';
import { resizeGray, resizeRaster, toCHWFloat, type GrayImage, type RasterImage } from '../image/raster';
import { float32Tensor, loadSession, type OrtSession } from './onnx';

export interface SegmentationResult {
  providerId: string;
  providerVersion: string;
  width: number;
  height: number;
  /** Soft saliency 0..255 straight from the model (resized to the image). Kept so the threshold can be changed without inference. */
  soft: Uint8ClampedArray;
  /** Raw model mask at `threshold` (no post-processing). */
  thresholded: Uint8Array;
  /** Post-processed mask: largest component, only tiny holes (<=0.5 % of the garment) filled. 1 = garment. */
  binary: Uint8Array;
  /** What post-processing changed, so the user can undo it. */
  post: { removedComponents: Region[]; openHoles: Region[]; smallHolesFilled: number; keptArea: number };
  stats: {
    threshold: number;
    components: number;
    coverage: number;
    bounds: { x0: number; y0: number; x1: number; y1: number } | null;
    touchesBorder: boolean;
    inferenceMs: number;
  };
  /** HEURISTIC quality status (coverage / border / fragments / holes). Not accuracy. User confirmation is separate. */
  quality: MaskQuality['status'];
  warnings: string[];
}

export const DEFAULT_MASK_THRESHOLD = 128;

/** Re-run post-processing for a new threshold on the stored soft map (no inference). */
export function rethreshold(result: Pick<SegmentationResult, 'soft' | 'width' | 'height'>, threshold: number) {
  const soft: GrayImage = { width: result.width, height: result.height, data: result.soft };
  const post = postprocessSoftMask(soft, threshold);
  const q = assessMask(post.mask, result.width, result.height);
  return { post, quality: q };
}

export interface SegmentationProvider {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  load(): Promise<void>;
  segment(image: RasterImage, signal?: AbortSignal): Promise<SegmentationResult>;
  dispose(): Promise<void>;
}

export const U2NETP_PROVIDER_ID = 'u2netp';
export const U2NETP_PROVIDER_VERSION = 'u2netp.onnx@sha256:309c8469…4ddd8;post-v2';

/**
 * U²-Netp (Qin et al., Apache-2.0; ONNX export from the rembg release) via
 * onnxruntime-web. General salient-object segmentation — NOT trained on
 * garments specifically, which is exactly why the plan asks to verify it on
 * flat-lay photos (scripts/eval-fixtures.ts does).
 */
export class U2NetpSegmentationProvider implements SegmentationProvider {
  readonly id = U2NETP_PROVIDER_ID;
  readonly version = U2NETP_PROVIDER_VERSION;
  readonly description = 'U²-Netp salient object segmentation (4.6 MB, Apache-2.0), 320×320 input, run locally with onnxruntime-web; post-processing (re-runnable without inference): threshold, largest connected component, only tiny holes (<=0.5 % of the garment) filled; larger holes and removed fragments are reported and restorable.';
  private session: OrtSession | null = null;

  constructor(
    private readonly modelPath: string,
    private readonly options: { threshold?: number } = {},
  ) {}

  async load(): Promise<void> {
    if (!this.session) this.session = await loadSession(this.modelPath);
  }

  async segment(image: RasterImage, signal?: AbortSignal): Promise<SegmentationResult> {
    if (!this.session) await this.load();
    signal?.throwIfAborted();
    const N = 320;
    const input = resizeRaster(image, N, N); // rembg stretches to 320x320 (no aspect preservation)
    const chw = toCHWFloat(input, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], true);
    const t0 = performance.now();
    const out = await this.session!.run({ 'input.1': float32Tensor(chw, [1, 3, N, N]) });
    const inferenceMs = performance.now() - t0;
    signal?.throwIfAborted();
    const d0 = out[this.session!.outputNames[0]!]!.data as Float32Array; // fused output, sigmoid already applied
    let mn = Infinity,
      mx = -Infinity;
    for (let i = 0; i < d0.length; i++) {
      mn = Math.min(mn, d0[i]!);
      mx = Math.max(mx, d0[i]!);
    }
    const small: GrayImage = { width: N, height: N, data: new Uint8ClampedArray(N * N) };
    for (let i = 0; i < d0.length; i++) small.data[i] = ((d0[i]! - mn) / (mx - mn || 1)) * 255;
    const soft = resizeGray(small, image.width, image.height);

    const threshold = this.options.threshold ?? DEFAULT_MASK_THRESHOLD;
    const { post, quality } = rethreshold({ soft: soft.data, width: image.width, height: image.height }, threshold);
    let bounds: SegmentationResult['stats']['bounds'] = null;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        if (post.mask[y * image.width + x]) {
          if (!bounds) bounds = { x0: x, y0: y, x1: x, y1: y };
          else {
            if (x < bounds.x0) bounds.x0 = x;
            if (x > bounds.x1) bounds.x1 = x;
            if (y > bounds.y1) bounds.y1 = y;
          }
        }
    return {
      providerId: this.id,
      providerVersion: this.version,
      width: image.width,
      height: image.height,
      soft: soft.data,
      thresholded: post.thresholded,
      binary: post.mask,
      post: { removedComponents: post.removedComponents, openHoles: post.openHoles, smallHolesFilled: post.smallHolesFilled, keptArea: post.keptArea },
      stats: { threshold, components: post.removedComponents.length + 1, coverage: quality.coverage, bounds, touchesBorder: quality.touchesBorder, inferenceMs },
      quality: quality.status,
      warnings: quality.warnings,
    };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = null;
  }
}
