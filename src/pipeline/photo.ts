/**
 * Stage 05 — photo loading and normalization (browser).
 *
 *  - accepts what the browser can actually decode (JPEG / PNG / WebP everywhere;
 *    HEIC only where the browser decodes it — otherwise a clear error)
 *  - applies EXIF orientation (createImageBitmap imageOrientation:'from-image',
 *    fallback <img> which modern browsers orient automatically)
 *  - keeps the ORIGINAL bytes untouched; the working copy is downscaled to
 *    MAX_WORKING_SIDE and the matrix working -> original is stored
 *  - never pixelates the input: the working copy is a plain bilinear downscale
 *  - nothing leaves the browser
 */
import type { PhotoRef } from '../domain/types';
import type { RasterImage } from '../image/raster';

export const MAX_WORKING_SIDE = 1024;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

export interface LoadedPhoto {
  ref: PhotoRef;
  /** untouched original file */
  file: File;
  /** working copy (orientation-normalized, downscaled) */
  working: RasterImage;
  /** object URL of the working copy as PNG, for <img> previews — release with revoke() */
  previewUrl: string;
  revoke(): void;
}

export class PhotoLoadError extends Error {
  constructor(
    message: string,
    public readonly code: 'unsupported_type' | 'too_large' | 'decode_failed' | 'heic_unsupported' | 'empty',
  ) {
    super(message);
  }
}

const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

async function decode(file: File): Promise<{ bitmap: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { bitmap: bmp, width: bmp.width, height: bmp.height };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('img decode failed'));
      img.src = url;
    });
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadPhoto(file: File, id: string): Promise<LoadedPhoto> {
  if (!file || file.size === 0) throw new PhotoLoadError('Файл пустой.', 'empty');
  if (file.size > MAX_FILE_BYTES) throw new PhotoLoadError(`Файл больше ${MAX_FILE_BYTES / 1024 / 1024} МБ.`, 'too_large');
  const okType = /^image\/(jpeg|png|webp)$/i.test(file.type);
  if (!okType && !isHeic(file)) throw new PhotoLoadError(`Неподдерживаемый тип "${file.type || file.name}". Нужен JPEG, PNG или WebP.`, 'unsupported_type');
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    if (isHeic(file)) throw new PhotoLoadError('HEIC/HEIF этот браузер не декодирует. Экспортируйте фото в JPEG (на iPhone: Настройки → Камера → Форматы → «Наиболее совместимые») и загрузите снова.', 'heic_unsupported');
    throw new PhotoLoadError('Не удалось декодировать изображение.', 'decode_failed');
  }
  const { bitmap, width, height } = decoded;
  if (!width || !height) throw new PhotoLoadError('Изображение без размеров.', 'decode_failed');
  const scale = Math.min(1, MAX_WORKING_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new PhotoLoadError('2D canvas недоступен.', 'decode_failed');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap) bitmap.close();
  const imageData = ctx.getImageData(0, 0, w, h);
  const working: RasterImage = { width: w, height: h, data: imageData.data };
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new PhotoLoadError('Не удалось создать предпросмотр.', 'decode_failed');
  const previewUrl = URL.createObjectURL(blob);
  const inv = 1 / scale;
  const ref: PhotoRef = {
    id,
    side: 'front',
    original: { width, height, mimeType: file.type || 'application/octet-stream', byteLength: file.size, fileName: file.name },
    normalized: { width: w, height: h, toOriginal: [inv, 0, 0, 0, inv, 0, 0, 0, 1] },
  };
  return { ref, file, working, previewUrl, revoke: () => URL.revokeObjectURL(previewUrl) };
}

export const PHOTO_GUIDE = [
  'Одна вещь целиком, снятая спереди, лежит ровно на плоскости.',
  'Рукава расправлены, вырез виден, ничего не перекрывает вещь.',
  'Контрастный однотонный фон и ровный свет без жёстких теней.',
  'Не на человеке и не куча вещей — такие фото сейчас не поддерживаются.',
  'Поддерживается только футболка. Другая одежда будет отклонена.',
  'Фото не отправляется никуда: всё считается в этом браузере.',
];
