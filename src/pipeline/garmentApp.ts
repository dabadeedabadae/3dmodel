/**
 * Sequential garment pipeline page (stages 05–07, stops at checkpoint B):
 *   photo_loaded -> category_confirmed -> mask_confirmed -> (B)
 *
 * Honesty rules implemented here:
 *  - a category is only "confirmed" when the user clicks; suggestions are shown
 *    with uncalibrated scores and the raw ImageNet classes behind them
 *  - if the provider fails, the page says MANUAL MODE and records manual=true
 *  - unsupported categories stop the pipeline with an explicit message
 *  - the mask is confirmed by a separate click; edits are recorded as user_adjusted
 *  - changing the photo invalidates everything after it (PipelineStore)
 */
import { PIPELINE_STAGES, PipelineStore, type PipelineStage } from '../domain/pipeline';
import { GARMENT_CATEGORIES, createEmptyGarmentRecord, type GarmentCategory, type GarmentRecord, type Landmark, type MaskRef } from '../domain/types';
import { MODULE_VERSION, PROCESSING_VERSION } from '../domain/versions';
import { assessMask, fillHoles, keepComponents, maskComponents, maskHoles, type Region } from '../image/maskOps';
import { maskBounds } from '../image/raster';
import type { CategoryResult } from '../providers/CategoryProvider';
import { DEFAULT_MASK_THRESHOLD, rethreshold, type SegmentationResult } from '../providers/SegmentationProvider';
import { CATEGORY_TEMPLATE } from '../templates/registry';
import { InferenceClient } from './inferenceClient';
import { LandmarkEditor } from './landmarkEditor';
import { GarmentViewer, type GarmentView } from './viewer';
import { estimateTShirtLandmarks, type LandmarkEstimate, type TShirtLandmarkName } from '../shape/landmarks';
import { estimateParams, resolveParams, selectTemplate, toGarmentParams, type ParamLayers } from '../shape/params';
import { TSHIRT_PARAM_LIMITS, TSHIRT_PARAM_NAMES, type TShirtParams } from '../templates/tshirt/params';
import { buildTShirt } from '../templates/tshirt/buildTShirt';
import { bleedEdges, fillBase, imageCorrespondence, transferToUV, type Correspondence, type TransferResult } from '../image/uvTransfer';
import { estimateBaseColor, flattenLighting, type BaseColorResult } from '../image/color';
import { pixelate, type PixelateOptions, type PixelateResult } from '../image/pixelate';
import { ProceduralBodyAdapter } from '../body/ProceduralBodyAdapter';
import { BODY_PRESETS, BODY_TEMPLATE_VERSION, defaultBodyParams } from '../body/params';
import { DEFAULT_EASE, fitTShirtToBody, type FitAnchor, type FitResult } from '../fitting/fitTShirt';
import { MaskEditor } from './maskEditor';
import { PHOTO_GUIDE, PhotoLoadError, loadPhoto, type LoadedPhoto } from './photo';

const CATEGORY_LABELS: Record<GarmentCategory, string> = { tshirt: 'Футболка', pants: 'Брюки', skirt: 'Юбка', other: 'Другое / не уверен' };

export interface GarmentAppState {
  maskLayers?: unknown;
  record: GarmentRecord;
  stages: Record<PipelineStage, string>;
  category: CategoryResult | null;
  categoryError: string | null;
  segmentation: SegmentationResult | null;
  segmentationError: string | null;
  maskStrokes: number;
  providers: InferenceClient['info'];
}

export class GarmentApp {
  readonly store = new PipelineStore();
  readonly client = new InferenceClient();
  record: GarmentRecord;
  photo: LoadedPhoto | null = null;
  categoryResult: CategoryResult | null = null;
  categoryError: string | null = null;
  segResult: SegmentationResult | null = null;
  segError: string | null = null;
  editor: MaskEditor | null = null;
  /** mask layers kept apart: model (raw threshold) -> post (largest component, tiny holes) -> user (edited) */
  maskThreshold = DEFAULT_MASK_THRESHOLD;
  maskModel: Uint8Array | null = null;
  maskPost: Uint8Array | null = null;
  maskPostInfo: { removedComponents: Region[]; openHoles: Region[]; smallHolesFilled: number } | null = null;
  private counter = 0;
  private els: Record<string, HTMLElement> = {};
  // stages 08-12
  landmarkEst: LandmarkEstimate | null = null;
  landmarkEditor: LandmarkEditor | null = null;
  layers: ParamLayers | null = null;
  userParams: Partial<TShirtParams> = {};
  baseColor: BaseColorResult | null = null;
  userBaseColor: string | null = null;
  lightingStrength = 0;
  corr: Correspondence | null = null;
  uvRaw: TransferResult | null = null;
  uvLit: TransferResult | null = null;
  pixelOpts: PixelateOptions = { size: 256, colors: 16, dither: false, strength: 1 };
  pixel: PixelateResult | null = null;
  viewer: GarmentViewer | null = null;
  // F04: garment on the procedural mannequin (optional view; the chain itself never needs a body)
  fitOpts: { enabled: boolean; preset: string; anchor: FitAnchor; fitToBody: boolean; easeScale: number } = { enabled: false, preset: 'male-m', anchor: 'chest', fitToBody: true, easeScale: 1 };
  body: ProceduralBodyAdapter | null = null;
  fit: FitResult | null = null;

  constructor(private root: HTMLElement) {
    this.record = createEmptyGarmentRecord(this.newId('garment'));
    this.build();
    this.store.subscribe(() => this.renderStatus());
    this.client.load().then(() => this.renderStatus()).catch((e) => this.note('providers', `Модели не загрузились: ${e.message}. Доступен только ручной режим категории.`, 'err'));
    this.renderStatus();
  }

  private newId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${(++this.counter).toString(36)}`;
  }

  // ------------------------------------------------------------------ DOM
  private build() {
    this.root.innerHTML = '';
    const main = el('main', 'pgp-main');
    const aside = el('aside', 'pgp-aside');
    this.root.append(main, aside);

    // Step 1 — photo
    const s1 = step('1. Фото вещи');
    const guide = el('ul', 'pgp-guide');
    for (const g of PHOTO_GUIDE) guide.appendChild(el('li', '', g));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,.heic,.heif';
    input.id = 'pgp-file';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void this.loadFile(f);
    });
    const reset = button('Сбросить', () => this.reset());
    reset.id = 'pgp-reset';
    const preview = el('div', 'pgp-preview');
    const photoNote = el('div', 'pgp-note');
    s1.append(guide, row(input, reset), photoNote, preview);
    this.els['photoNote'] = photoNote;
    this.els['preview'] = preview;

    // Step 2 — category
    const s2 = step('2. Категория');
    const catBox = el('div', 'pgp-box');
    s2.append(catBox);
    this.els['catBox'] = catBox;

    // Step 3 — mask
    const s3 = step('3. Фон и маска');
    const maskBox = el('div', 'pgp-box');
    s3.append(maskBox);
    this.els['maskBox'] = maskBox;

    // Step 4 — checkpoint B
    const s4 = step('4. Контрольная точка B');
    const bBox = el('div', 'pgp-box');
    s4.append(bBox);
    this.els['bBox'] = bBox;

    const s5 = step('5. Ориентиры и форма');
    const shapeBox = el('div', 'pgp-box');
    s5.append(shapeBox);
    this.els['shapeBox'] = shapeBox;
    const s6 = step('6. Параметры шаблона (относительные единицы, не сантиметры)');
    const paramsBox = el('div', 'pgp-box');
    s6.append(paramsBox);
    this.els['paramsBox'] = paramsBox;
    const s7 = step('7. Текстура: перенос в UV и цвет');
    const texBox = el('div', 'pgp-box');
    s7.append(texBox);
    this.els['texBox'] = texBox;
    const s8 = step('8. Пикселизация и просмотр (без манекена)');
    const prevBox = el('div', 'pgp-box');
    s8.append(prevBox);
    this.els['prevBox'] = prevBox;
    main.append(s1, s2, s3, s4, s5, s6, s7, s8);

    aside.append(el('h1', '', `FitCast · photo-garments v${MODULE_VERSION}`), el('p', 'pg-muted', 'Фото → категория → маска. Всё считается локально в браузере, ничего не отправляется.'));
    const status = el('div', 'pgp-status');
    aside.append(el('h2', '', 'Состояние pipeline'), status);
    this.els['status'] = status;
    const prov = el('div', 'pgp-providers');
    aside.append(el('h2', '', 'Провайдеры'), prov);
    this.els['providers'] = prov;
    const notes = el('div', 'pgp-notes');
    aside.append(notes);
    this.els['notes'] = notes;
    this.renderCategory();
    this.renderMask();
    this.renderB();
    this.renderShape();
    this.renderParams();
    this.renderTexture();
    this.renderPreview();
  }

  private note(key: string, text: string, kind: 'info' | 'err' | 'ok' = 'info') {
    let n = this.els['notes']!.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!n) {
      n = el('div', '');
      n.dataset['key'] = key;
      this.els['notes']!.appendChild(n);
    }
    n.className = `pgp-note is-${kind}`;
    n.textContent = text;
  }

  // ------------------------------------------------------------------ stage 05
  async loadFile(file: File): Promise<void> {
    this.cancelAll();
    this.photo?.revoke();
    this.photo = null;
    this.categoryResult = null;
    this.categoryError = null;
    this.segResult = null;
    this.segError = null;
    this.editor?.dispose();
    this.editor = null;
    this.resetShapeState();
    this.record = createEmptyGarmentRecord(this.newId('garment'));
    this.store.setInput('photo_loaded', `${file.name}:${file.size}:${file.lastModified}`);
    this.els['photoNote']!.textContent = 'Загрузка…';
    this.els['preview']!.innerHTML = '';
    this.renderCategory();
    this.renderMask();
    this.renderB();
    const ok = await this.store.run('photo_loaded', async () => {
      const photo = await loadPhoto(file, this.newId('photo'));
      return photo;
    }).catch(() => false);
    const res = this.store.get<LoadedPhoto>('photo_loaded');
    if (!ok || !res.value) {
      const err = res.error ?? 'неизвестная ошибка';
      this.els['photoNote']!.textContent = `Ошибка: ${err}`;
      this.els['photoNote']!.className = 'pgp-note is-err';
      return;
    }
    this.photo = res.value;
    this.record.photos = [this.photo.ref];
    const o = this.photo.ref.original;
    const n = this.photo.ref.normalized!;
    this.els['photoNote']!.className = 'pgp-note is-ok';
    this.els['photoNote']!.textContent = `Оригинал ${o.width}×${o.height} (${(o.byteLength / 1024).toFixed(0)} КБ, ${o.mimeType}) сохранён без изменений; рабочая копия ${n.width}×${n.height}, масштаб ×${n.toOriginal[0].toFixed(3)} к оригиналу. EXIF-ориентация применена.`;
    const img = document.createElement('img');
    img.src = this.photo.previewUrl;
    img.alt = 'рабочая копия';
    this.els['preview']!.appendChild(img);
    void this.runCategory();
  }

  reset(): void {
    this.cancelAll();
    this.photo?.revoke();
    this.photo = null;
    this.editor?.dispose();
    this.editor = null;
    this.categoryResult = null;
    this.categoryError = null;
    this.segResult = null;
    this.segError = null;
    this.resetShapeState();
    this.record = createEmptyGarmentRecord(this.newId('garment'));
    this.store.invalidateFrom('photo_loaded', 'reset');
    (this.root.querySelector('#pgp-file') as HTMLInputElement).value = '';
    this.els['preview']!.innerHTML = '';
    this.els['photoNote']!.textContent = '';
    this.els['photoNote']!.className = 'pgp-note';
    this.renderCategory();
    this.renderMask();
    this.renderB();
  }

  private resetShapeState() {
    this.landmarkEditor?.dispose();
    this.landmarkEditor = null;
    this.landmarkEst = null;
    this.layers = null;
    this.userParams = {};
    this.baseColor = null;
    this.userBaseColor = null;
    this.lightingStrength = 0;
    this.corr = null;
    this.uvRaw = null;
    this.uvLit = null;
    this.pixel = null;
    this.viewer?.dispose();
    this.viewer = null;
    this.body?.dispose();
    this.body = null;
    this.fit = null;
    this.record.landmarks = [];
    this.record.params = {};
    this.record.textures = [];
    this.record.template = null;
  }

  private cancelAll() {
    for (const s of PIPELINE_STAGES) this.store.cancel(s, 'photo_changed');
  }

  // ------------------------------------------------------------------ stage 06
  private async runCategory(): Promise<void> {
    if (!this.photo) return;
    this.store.setInput('category_confirmed', `${this.photo.ref.id}:category`);
    this.categoryResult = null;
    this.categoryError = null;
    this.renderCategory('running');
    const image = this.photo.working;
    try {
      // not a pipeline "run": the stage succeeds only on user confirmation
      const result = await this.client.category(image);
      if (!this.photo || this.photo.working !== image) return; // stale
      this.categoryResult = result;
      this.record.category.suggestions = result.suggestions;
      this.record.category.manual = false;
    } catch (e) {
      if (!this.photo || this.photo.working !== image) return;
      this.categoryError = e instanceof Error ? e.message : String(e);
      this.record.category.suggestions = [];
      this.record.category.manual = true; // only a manual choice is possible now
    }
    this.renderCategory();
  }

  confirmCategory(category: GarmentCategory): void {
    if (!this.photo) return;
    this.record.category.confirmed = category;
    if (!this.categoryResult) this.record.category.manual = true;
    const templateId = CATEGORY_TEMPLATE[category];
    this.store.setResult('category_confirmed', { category, templateId });
    this.record.updatedAt = new Date().toISOString();
    this.renderCategory();
    if (templateId) {
      this.record.template = null; // set when the shape stage runs (after B)
      void this.runSegmentation();
    } else {
      this.store.invalidateFrom('mask_confirmed', 'unsupported_category');
      this.renderMask();
      this.renderB();
    }
  }

  private renderCategory(state: 'idle' | 'running' = 'idle') {
    const box = this.els['catBox']!;
    box.innerHTML = '';
    if (!this.photo) {
      box.appendChild(el('p', 'pg-muted', 'Сначала загрузите фото.'));
      return;
    }
    const confirmed = this.record.category.confirmed;
    if (state === 'running') {
      box.appendChild(el('p', '', 'Распознавание категории… (MobileNetV2 / ImageNet, локально)'));
      return;
    }
    if (this.categoryError) {
      const m = el('div', 'pgp-manual', `РУЧНОЙ РЕЖИМ: автоматическое распознавание не выполнено (${this.categoryError}). Выберите категорию сами.`);
      m.id = 'pgp-manual-mode';
      box.appendChild(m);
    } else if (this.categoryResult) {
      const r = this.categoryResult;
      box.appendChild(el('p', 'pg-muted', `Предложения провайдера ${r.providerId} (${r.inferenceMs.toFixed(0)} мс). Числа — некалиброванная масса softmax, не вероятность и не «точность».`));
      const list = el('div', 'pgp-suggestions');
      for (const s of r.suggestions) {
        const line = el('div', 'pgp-sugg');
        line.dataset['category'] = s.category;
        const bar = el('div', 'pgp-bar');
        bar.style.width = `${Math.round(s.score * 100)}%`;
        line.append(el('span', 'pgp-sugg-label', CATEGORY_LABELS[s.category]), bar, el('span', 'pgp-sugg-score', s.score.toFixed(2)));
        list.appendChild(line);
      }
      box.appendChild(list);
      box.appendChild(el('p', 'pg-muted pgp-raw', `Классы ImageNet за этим: ${r.rawTop.map((x) => `${x.label.split(',')[0]} ${x.score.toFixed(2)}`).join(' · ')}`));
    }
    const choose = el('div', 'pg-row');
    for (const c of GARMENT_CATEGORIES) {
      const b = button(`Подтвердить: ${CATEGORY_LABELS[c]}`, () => this.confirmCategory(c));
      b.dataset['confirm'] = c;
      if (this.categoryResult && this.categoryResult.suggestions[0]?.category === c) b.classList.add('is-suggested');
      if (confirmed === c) b.classList.add('is-active');
      choose.appendChild(b);
    }
    box.append(el('p', '', 'Подтверждение — отдельное действие пользователя:'), choose);
    if (confirmed) {
      const supported = CATEGORY_TEMPLATE[confirmed] !== null;
      const src = this.record.category.manual ? 'выбрана вручную (без распознавания)' : this.categoryResult?.suggestions[0]?.category === confirmed ? 'совпадает с предложением' : 'исправлена пользователем (отличается от предложения)';
      const line = el('div', supported ? 'pgp-note is-ok' : 'pgp-note is-err', supported ? `Подтверждено: ${CATEGORY_LABELS[confirmed]} — ${src}. Шаблон: ${CATEGORY_TEMPLATE[confirmed]}.` : `Подтверждено: ${CATEGORY_LABELS[confirmed]} — ${src}. ЭТА КАТЕГОРИЯ НЕ ПОДДЕРЖИВАЕТСЯ: в текущей версии 3D-шаблон есть только у футболки. Обработка остановлена, вещь не будет направлена на шаблон футболки.`);
      line.id = 'pgp-category-verdict';
      box.appendChild(line);
    }
  }

  // ------------------------------------------------------------------ stage 07
  private async runSegmentation(): Promise<void> {
    if (!this.photo) return;
    this.store.setInput('mask_confirmed', `${this.photo.ref.id}:mask`);
    this.segResult = null;
    this.segError = null;
    this.editor?.dispose();
    this.editor = null;
    this.renderMask('running');
    const image = this.photo.working;
    try {
      const result = await this.client.segment(image);
      if (!this.photo || this.photo.working !== image) return;
      this.segResult = result;
      this.maskThreshold = result.stats.threshold;
      this.maskModel = result.thresholded;
      this.maskPost = result.binary;
      this.maskPostInfo = { removedComponents: result.post.removedComponents, openHoles: result.post.openHoles, smallHolesFilled: result.post.smallHolesFilled };
      this.editor = new MaskEditor(image, result.binary, { onChange: () => this.renderMaskStats() });
    } catch (e) {
      if (!this.photo || this.photo.working !== image) return;
      this.segError = e instanceof Error ? e.message : String(e);
      this.maskModel = null;
      this.maskPost = null;
      this.maskPostInfo = null;
      // manual fallback: start from an empty mask so the user can paint the garment
      this.editor = new MaskEditor(image, new Uint8Array(image.width * image.height), { onChange: () => this.renderMaskStats() });
    }
    this.renderMask();
  }

  /** Re-run post-processing on the stored saliency map (no inference). Refuses silently-destroying edits. */
  applyThreshold(threshold: number, force = false): 'applied' | 'needs_confirmation' | 'unavailable' {
    if (!this.segResult || !this.editor || !this.photo) return 'unavailable';
    if (this.editor.getStrokes() > 0 && !force) return 'needs_confirmation';
    const { post } = rethreshold(this.segResult, threshold);
    this.maskThreshold = threshold;
    this.maskModel = post.thresholded;
    this.maskPost = post.mask;
    this.maskPostInfo = { removedComponents: post.removedComponents, openHoles: post.openHoles, smallHolesFilled: post.smallHolesFilled };
    this.editor.dispose();
    this.editor = new MaskEditor(this.photo.working, post.mask, { onChange: () => this.renderMaskStats() });
    if (this.store.status('mask_confirmed') === 'success') this.store.invalidateFrom('mask_confirmed', 'mask_rebuilt');
    this.renderMask();
    return 'applied';
  }

  /** Restore fragments that "largest component" dropped (ids from maskPostInfo.removedComponents). */
  restoreFragments(ids?: number[]): void {
    if (!this.editor || !this.maskModel || !this.photo || !this.maskPostInfo) return;
    const { width, height } = this.photo.working;
    const comps = maskComponents(this.maskModel, width, height);
    const chosen = ids ?? this.maskPostInfo.removedComponents.map((r) => r.id);
    const add = keepComponents(this.maskModel, comps, chosen);
    const cur = this.editor.getMask();
    for (let i = 0; i < cur.length; i++) if (add[i]) cur[i] = 1;
    this.editor.setMaskWithUndo(cur, 'restore_fragments');
    this.renderMask();
  }

  /** Fill enclosed holes of the CURRENT mask. `minArea` lets the user keep the real neck opening (largest hole). */
  fillInternalHoles(opts: { ids?: number[]; keepLargest?: boolean } = {}): void {
    if (!this.editor || !this.photo) return;
    const { width, height } = this.photo.working;
    const cur = this.editor.getMask();
    const holes = maskHoles(cur, width, height);
    let ids = opts.ids ?? holes.regions.map((h) => h.id);
    if (opts.keepLargest && holes.regions.length) {
      const largest = holes.regions.reduce((a, b) => (b.area > a.area ? b : a));
      ids = ids.filter((id) => id !== largest.id);
    }
    if (!ids.length) return;
    this.editor.setMaskWithUndo(fillHoles(cur, holes, ids), 'fill_holes');
    this.renderMask();
  }

  confirmMask(): void {
    if (!this.photo || !this.editor) return;
    const mask = this.editor.getMask();
    const strokes = this.editor.getStrokes();
    const ref: MaskRef = {
      id: this.newId('mask'),
      photoId: this.photo.ref.id,
      width: this.photo.working.width,
      height: this.photo.working.height,
      source: this.segError ? 'user_adjusted' : strokes > 0 ? 'user_adjusted' : 'estimated',
      confirmed: true,
      ...(this.segResult ? { providerId: this.segResult.providerId, providerVersion: this.segResult.providerVersion } : {}),
    };
    this.record.masks = [ref];
    this.record.processingVersion = PROCESSING_VERSION;
    this.record.updatedAt = new Date().toISOString();
    const q = assessMask(mask, this.photo.working.width, this.photo.working.height);
    this.store.setResult('mask_confirmed', { maskId: ref.id, strokes, mask, heuristic: q, threshold: this.maskThreshold, maskModel: this.maskModel, maskPost: this.maskPost });
    this.resetShapeState();
    this.renderMask();
    this.renderB();
    this.runShape();
  }

  private renderMask(state: 'idle' | 'running' = 'idle') {
    const box = this.els['maskBox']!;
    box.innerHTML = '';
    const confirmed = this.record.category.confirmed;
    if (!this.photo || !confirmed) {
      box.appendChild(el('p', 'pg-muted', 'Доступно после подтверждения категории.'));
      return;
    }
    if (CATEGORY_TEMPLATE[confirmed] === null) {
      box.appendChild(el('p', 'pgp-note is-err', 'Категория не поддерживается — маска не строится.'));
      return;
    }
    if (state === 'running') {
      box.appendChild(el('p', '', 'Сегментация… (U²-Netp, локально, может занять несколько секунд)'));
      return;
    }
    if (this.segError) {
      const m = el('div', 'pgp-manual', `РУЧНОЙ РЕЖИМ: автоматическая маска не получена (${this.segError}). Нарисуйте маску кистью.`);
      m.id = 'pgp-mask-manual';
      box.appendChild(m);
    }
    const stats = el('div', 'pgp-maskstats');
    stats.id = 'pgp-maskstats';
    box.appendChild(stats);
    if (this.segResult && this.editor) {
      // threshold: re-runs post-processing on the stored saliency map, never inference
      const tRow = el('div', 'pg-row');
      const tLabel = el('span', 'pg-muted', `порог карты модели: ${this.maskThreshold}`);
      const tInput = document.createElement('input');
      tInput.type = 'range';
      tInput.min = '16';
      tInput.max = '240';
      tInput.step = '4';
      tInput.value = String(this.maskThreshold);
      tInput.id = 'pgp-threshold';
      const tConfirm = button('Пересоздать маску с этим порогом (ручные правки будут потеряны)', () => {
        this.applyThreshold(Number(tInput.value), true);
      });
      tConfirm.id = 'pgp-threshold-confirm';
      tConfirm.style.display = 'none';
      tInput.addEventListener('input', () => {
        tLabel.textContent = `порог карты модели: ${tInput.value}`;
        const r = this.applyThreshold(Number(tInput.value));
        tConfirm.style.display = r === 'needs_confirmation' ? '' : 'none';
      });
      tRow.append(tLabel, tInput, tConfirm);
      box.appendChild(tRow);
      // post-processing panel
      const pp = el('div', 'pgp-post');
      pp.id = 'pgp-post';
      const info = this.maskPostInfo!;
      pp.appendChild(el('div', 'pg-muted', `Постобработка: оставлен крупнейший фрагмент, мелких дыр (≤0.5 % вещи) заполнено: ${info.smallHolesFilled}. Карта модели и её порог хранятся отдельно от правок.`));
      if (info.removedComponents.length) {
        const r = el('div', '', `Отброшено фрагментов: ${info.removedComponents.length} (${info.removedComponents.map((c) => c.area).join(', ')} px). `);
        const b = button('Вернуть все отброшенные фрагменты', () => this.restoreFragments());
        b.id = 'pgp-restore-fragments';
        r.appendChild(b);
        pp.appendChild(r);
      }
      box.appendChild(pp);
    }
    if (this.editor) {
      const holesRow = el('div', 'pg-row');
      holesRow.id = 'pgp-holes';
      const fillAllBut = button('Заполнить внутренние разрывы, кроме самого большого (вырез)', () => this.fillInternalHoles({ keepLargest: true }));
      fillAllBut.id = 'pgp-fill-holes-keep-largest';
      const fillAll = button('Заполнить все внутренние дыры', () => this.fillInternalHoles());
      fillAll.id = 'pgp-fill-holes-all';
      holesRow.append(fillAllBut, fillAll);
      box.appendChild(holesRow);
      box.appendChild(this.editor.root);
    }
    const confirm = button('Подтвердить маску', () => this.confirmMask());
    confirm.id = 'pgp-confirm-mask';
    confirm.className = 'primary';
    box.appendChild(row(confirm));
    const done = this.store.get('mask_confirmed');
    if (done.status === 'success') {
      const v = done.value as { strokes: number };
      const hq = (done.value as { heuristic: { status: string } }).heuristic;
      const l = el('div', hq.status === 'ok' ? 'pgp-note is-ok' : 'pgp-note is-warn', `Маска подтверждена пользователем (${this.record.masks[0]?.source === 'estimated' ? 'автоматическая, без правок' : `с ручными правками: ${v.strokes} штрих(ов)`}). Эвристический статус подтверждённой маски: ${hq.status}${hq.status !== 'ok' ? ' — подтверждение не делает её «чистой»; следующие этапы получат её как есть' : ''}.`);
      l.id = 'pgp-mask-verdict';
      box.appendChild(l);
    }
    this.renderMaskStats();
  }

  private renderMaskStats() {
    const stats = this.els['maskBox']!.querySelector<HTMLElement>('#pgp-maskstats');
    if (!stats || !this.photo) return;
    stats.innerHTML = '';
    const { width, height } = this.photo.working;
    if (this.segResult) {
      const s = this.segResult;
      stats.appendChild(el('div', '', `Авто-маска ${s.providerId}: ${s.stats.inferenceMs.toFixed(0)} мс, порог ${this.maskThreshold}. Эвристический статус авто-маски: ${s.quality} (это не точность — разметки нет).`));
    }
    if (this.editor) {
      const m = this.editor.getMask();
      const q = assessMask(m, width, height);
      const b = maskBounds(m, width, height);
      const line = el('div', q.status === 'ok' ? 'pgp-note is-ok' : 'pgp-note is-warn', `Текущая маска: ${(q.coverage * 100).toFixed(1)} % кадра, штрихов пользователя: ${this.editor.getStrokes()}${b ? `, bbox ${b.x0},${b.y0}–${b.x1},${b.y1}` : ''}. Эвристический статус: ${q.status}. Подтверждение пользователем: ${this.store.status('mask_confirmed') === 'success' ? 'да' : 'нет'}.`);
      line.id = 'pgp-mask-heuristic';
      stats.appendChild(line);
      for (const w of q.warnings) {
        const wl = el('div', 'pgp-note is-warn', `⚠ ${w}`);
        if (w.includes('разрыв')) wl.id = 'pgp-gaps-warning';
        stats.appendChild(wl);
      }
      const holesRow = this.els['maskBox']!.querySelector<HTMLElement>('#pgp-holes');
      if (holesRow) holesRow.style.display = q.openHoles > 0 ? '' : 'none';
    }
  }

  // ------------------------------------------------------------------ checkpoint B
  private renderB() {
    const box = this.els['bBox']!;
    box.innerHTML = '';
    const done = this.store.get('mask_confirmed').status === 'success';
    if (!done) {
      box.appendChild(el('p', 'pg-muted', 'Доступно после подтверждения маски.'));
      return;
    }
    box.appendChild(el('p', 'pgp-note is-ok', 'Точка B: фото → подтверждённая категория → подтверждённая маска. Дальше — ориентиры, форма, UV, пикселизация (точка C). Вернуться и исправить маску можно в шаге 3: подтверждение заново сбросит все последующие шаги.'));
    const exp = button('Скачать пакет B (JSON + маска PNG)', () => this.exportB());
    exp.id = 'pgp-export';
    box.appendChild(row(exp));
    const pre = el('pre', 'pgp-json', JSON.stringify(this.snapshot().record, null, 2));
    box.appendChild(pre);
  }

  private exportB() {
    const snap = this.snapshot();
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(snap, null, 2));
    a.download = `${this.record.id}.json`;
    a.click();
    if (this.editor && this.photo) {
      const c = document.createElement('canvas');
      c.width = this.photo.working.width;
      c.height = this.photo.working.height;
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(c.width, c.height);
      const m = this.editor.getMask();
      for (let i = 0; i < m.length; i++) {
        const v = m[i] ? 255 : 0;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const b = document.createElement('a');
      b.href = c.toDataURL('image/png');
      b.download = `${this.record.id}-mask.png`;
      b.click();
    }
  }

  // ------------------------------------------------------------------ stage 08: landmarks
  private confirmedMask(): Uint8Array | null {
    const r = this.store.get<{ mask: Uint8Array }>('mask_confirmed');
    return r.status === 'success' && r.value ? r.value.mask : null;
  }

  runShape(): void {
    const mask = this.confirmedMask();
    if (!this.photo || !mask) return;
    const { width, height } = this.photo.working;
    this.store.setInput('shape_confirmed', `${this.record.masks[0]?.id}:shape`);
    this.landmarkEst = estimateTShirtLandmarks(mask, width, height);
    this.landmarkEditor?.dispose();
    this.landmarkEditor = new LandmarkEditor(this.photo.working, mask, this.landmarkEst, (pts) => this.onLandmarksChanged(pts));
    this.record.landmarks = Object.values(this.landmarkEst.points);
    this.layers = null;
    this.renderShape();
    this.renderParams();
    this.renderTexture();
    this.renderPreview();
  }

  private onLandmarksChanged(pts: Record<TShirtLandmarkName, Landmark>) {
    this.record.landmarks = Object.values(pts);
    if (this.store.status('shape_confirmed') === 'success') this.store.invalidateFrom('shape_confirmed', 'landmarks_edited');
    this.layers = null;
    this.renderShapeChecks();
    this.renderParams();
    this.renderTexture();
    this.renderPreview();
  }

  private renderShape() {
    const box = this.els['shapeBox']!;
    box.innerHTML = '';
    if (!this.photo || !this.confirmedMask()) {
      box.appendChild(el('p', 'pg-muted', 'Доступно после подтверждения маски.'));
      return;
    }
    box.appendChild(el('p', 'pg-muted', 'Ориентиры оценены по силуэту подтверждённой маски (без ML). Это предложения: низ выреза и его края по умолчанию, если воротник не виден на силуэте. Без масштаба все величины относительные — сантиметров нет.'));
    const checks = el('div', 'pgp-checks');
    checks.id = 'pgp-shape-checks';
    box.appendChild(checks);
    if (this.landmarkEditor) box.appendChild(this.landmarkEditor.root);
    const row = el('div', 'pg-row');
    const re = button('Пересчитать ориентиры из маски', () => this.runShape());
    const ok = button('Подтвердить ориентиры → параметры', () => this.confirmLandmarks());
    ok.id = 'pgp-confirm-landmarks';
    ok.className = 'primary';
    row.append(re, ok);
    box.appendChild(row);
    this.renderShapeChecks();
  }

  private renderShapeChecks() {
    const c = this.els['shapeBox']!.querySelector<HTMLElement>('#pgp-shape-checks');
    if (!c || !this.landmarkEst || !this.landmarkEditor) return;
    c.innerHTML = '';
    const pts = this.landmarkEditor.getPoints();
    const edited = Object.values(pts).filter((p) => p.source === 'user_adjusted').length;
    const defaults = Object.values(pts).filter((p) => p.source === 'default').length;
    c.appendChild(el('div', this.landmarkEst.status === 'ok' ? 'pgp-note is-ok' : 'pgp-note is-warn', `Оценка: ${this.landmarkEst.status}; точек по умолчанию: ${defaults}; сдвинуто пользователем: ${edited}.`));
    for (const ch of this.landmarkEst.checks) c.appendChild(el('div', ch.pass ? 'pg-muted' : 'pgp-note is-warn', `${ch.pass ? '✓' : '⚠'} ${ch.name} — ${ch.detail}`));
  }

  // ------------------------------------------------------------------ stage 09: params
  confirmLandmarks(): void {
    if (!this.landmarkEditor || !this.record.category.confirmed) return;
    const tpl = selectTemplate(this.record.category.confirmed);
    if (!tpl) return;
    const pts = this.landmarkEditor.getPoints();
    this.record.landmarks = Object.values(pts);
    const { estimated, ratios } = estimateParams(pts);
    this.layers = resolveParams(estimated, this.userParams, this.record.scale, ratios);
    this.record.template = tpl;
    this.record.params = toGarmentParams(this.layers);
    this.renderParams();
    this.renderTexture();
    this.renderPreview();
  }

  setUserParam(name: keyof TShirtParams, value: number | null): void {
    if (!this.layers) return;
    if (value === null) delete this.userParams[name];
    else this.userParams[name] = value;
    this.layers = resolveParams(this.layers.estimated, this.userParams, this.record.scale, this.layers.ratios);
    this.record.params = toGarmentParams(this.layers);
    if (this.store.status('shape_confirmed') === 'success') this.store.invalidateFrom('shape_confirmed', 'params_edited');
    this.renderParams();
    this.renderTexture();
    this.renderPreview();
  }

  confirmShape(): void {
    if (!this.layers) return;
    this.store.setResult('shape_confirmed', { params: this.layers.resolved, layers: this.layers });
    this.record.updatedAt = new Date().toISOString();
    this.renderParams();
    this.runTexture();
  }

  private renderParams() {
    const box = this.els['paramsBox']!;
    box.innerHTML = '';
    if (!this.layers) {
      box.appendChild(el('p', 'pg-muted', 'Доступно после подтверждения ориентиров.'));
      return;
    }
    const L = this.layers;
    box.appendChild(el('div', 'pgp-note', `Шаблон: ${L.templateId} ${L.templateVersion} (${L.topologyVersion}). ${L.note}`));
    const tbl = document.createElement('table');
    tbl.className = 'pgp-params';
    tbl.innerHTML = '<thead><tr><th>параметр</th><th>оценка по фото</th><th>принято шаблоном</th><th>ваше значение</th><th>итог</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const k of TSHIRT_PARAM_NAMES) {
      const lim = TSHIRT_PARAM_LIMITS[k];
      const tr = document.createElement('tr');
      const est = L.estimated[k];
      const cl = L.clamped.find((c) => c.name === k);
      const user = this.userParams[k];
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(lim.min);
      slider.max = String(lim.max);
      slider.step = String(lim.step);
      slider.value = String(L.resolved[k]);
      slider.dataset['param'] = k;
      slider.addEventListener('input', () => this.setUserParam(k, Number(slider.value)));
      const reset = button('×', () => this.setUserParam(k, null));
      reset.title = 'сбросить ваше значение';
      const tdUser = document.createElement('td');
      tdUser.append(slider, user !== undefined ? reset : el('span', '', ''));
      tr.append(
        el('td', '', lim.label),
        el('td', '', est === undefined ? 'не видно на фото → шаблон' : est.toFixed(3)),
        el('td', cl ? 'pgp-warncell' : '', cl ? `${cl.applied.toFixed(3)} (ограничено, было ${cl.requested.toFixed(3)})` : est === undefined ? `${L.applied[k].toFixed(3)} (по умолчанию)` : L.applied[k].toFixed(3)),
        tdUser,
        el('td', '', `${L.resolved[k].toFixed(3)} ${user !== undefined ? '(вы)' : est !== undefined ? '(оценка)' : '(шаблон)'}`),
      );
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    box.appendChild(tbl);
    const ok = button('Подтвердить форму → перенос в UV', () => this.confirmShape());
    ok.id = 'pgp-confirm-shape';
    ok.className = 'primary';
    box.appendChild(row(ok));
    if (this.store.status('shape_confirmed') === 'success') box.appendChild(el('div', 'pgp-note is-ok', 'Форма подтверждена.'));
  }

  // ------------------------------------------------------------------ stage 10-11: UV + colour
  runTexture(): void {
    const mask = this.confirmedMask();
    if (!this.photo || !mask || !this.layers || !this.landmarkEditor) return;
    this.store.setInput('texture_ready', `${this.record.masks[0]?.id}:${JSON.stringify(this.layers.resolved)}:${this.lightingStrength}:${this.userBaseColor ?? ''}`);
    const img = this.photo.working;
    const pts = this.landmarkEditor.getPoints();
    const mesh = buildTShirt(this.layers.resolved);
    this.corr = imageCorrespondence(mesh, pts, mask, img.width, img.height);
    this.baseColor = estimateBaseColor(img, mask);
    const base = this.userBaseColor ? (hexToRgb(this.userBaseColor) ?? this.baseColor.rgb) : this.baseColor.rgb;
    const raw = transferToUV(img, mask, mesh, this.corr, 1024);
    bleedEdges(raw, 4);
    fillBase(raw, base);
    this.uvRaw = raw;
    if (this.lightingStrength > 0) {
      const lit = flattenLighting(img, mask, this.lightingStrength);
      const t = transferToUV(lit.image, mask, mesh, this.corr, 1024);
      bleedEdges(t, 4);
      fillBase(t, base);
      this.uvLit = t;
    } else this.uvLit = null;
    mesh.geometry.dispose();
    this.record.textures = [
      { id: this.newId('tex'), kind: 'uv_raw', width: 1024, height: 1024, coveredIslands: this.corr.visibleIslands, conditionalIslands: ['back', 'collar', 'sleeve_left:back', 'sleeve_right:back'], processingVersion: PROCESSING_VERSION },
      ...(this.uvLit ? [{ id: this.newId('tex'), kind: 'uv_color_corrected' as const, width: 1024, height: 1024, coveredIslands: this.corr.visibleIslands, conditionalIslands: ['back', 'collar', 'sleeve_left:back', 'sleeve_right:back'], processingVersion: PROCESSING_VERSION }] : []),
    ];
    this.record.baseColor = { value: this.userBaseColor ?? this.baseColor.hex, source: this.userBaseColor ? 'user_adjusted' : 'estimated', note: this.baseColor.note };
    this.store.setResult('texture_ready', { coverage: raw.coverage, outsideMaskTexels: raw.outsideMaskTexels, visible: this.corr.visibleIslands });
    this.renderTexture();
    this.runPixel();
  }

  /** Orientation of the transfer: Pearson sign between atlas u and image x (must be +) and between v and image y (must be −, v is up). */
  corrOrientation(): Record<string, { ux: number; uy: number; vx: number; vy: number }> | null {
    if (!this.corr || !this.layers) return null;
    const mesh = buildTShirt(this.layers.resolved);
    const uv = mesh.geometry.attributes.uv!.array as ArrayLike<number>;
    const out: Record<string, { ux: number; uy: number; vx: number; vy: number }> = {};
    for (const isl of mesh.islands) {
      if (!['front', 'sleeve_left', 'sleeve_right'].includes(isl.name)) continue;
      const us: number[] = [], xs: number[] = [], vs: number[] = [], ys: number[] = [];
      for (let i = 0; i < isl.vertices.length; i++) {
        const v = isl.vertices[i]!;
        // sleeves: u is cyclic (m=0 and m=8 are the same seam); use the visible half m=4..8 only
        if (isl.name !== 'front' && i % 9 < 4) continue;
        const x = this.corr.xy[v * 2]!;
        if (Number.isNaN(x)) continue;
        us.push(uv[v * 2]!); xs.push(x); vs.push(uv[v * 2 + 1]!); ys.push(this.corr.xy[v * 2 + 1]!);
      }
      const corr = (a: number[], b: number[]) => {
        const ma = a.reduce((p, q) => p + q, 0) / a.length, mb = b.reduce((p, q) => p + q, 0) / b.length;
        let n = 0, da = 0, db = 0;
        for (let i = 0; i < a.length; i++) { n += (a[i]! - ma) * (b[i]! - mb); da += (a[i]! - ma) ** 2; db += (b[i]! - mb) ** 2; }
        return n / Math.sqrt(da * db || 1);
      };
      out[isl.name] = { ux: corr(us, xs), uy: corr(us, ys), vx: corr(vs, xs), vy: corr(vs, ys) };
    }
    mesh.geometry.dispose();
    return out;
  }

  private renderTexture() {
    const box = this.els['texBox']!;
    box.innerHTML = '';
    if (this.store.status('shape_confirmed') !== 'success') {
      box.appendChild(el('p', 'pg-muted', 'Доступно после подтверждения формы.'));
      return;
    }
    const ctrl = el('div', 'pg-row');
    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = this.userBaseColor ?? this.baseColor?.hex ?? '#808080';
    colorIn.id = 'pgp-base-color';
    colorIn.addEventListener('change', () => {
      this.userBaseColor = colorIn.value;
      this.runTexture();
    });
    const colorReset = button('авто-цвет', () => {
      this.userBaseColor = null;
      this.runTexture();
    });
    const light = document.createElement('input');
    light.type = 'range';
    light.min = '0';
    light.max = '1';
    light.step = '0.1';
    light.value = String(this.lightingStrength);
    light.id = 'pgp-lighting';
    light.addEventListener('change', () => {
      this.lightingStrength = Number(light.value);
      this.runTexture();
    });
    ctrl.append(el('span', 'pg-muted', 'основной цвет (спинка, воротник, невидимое):'), colorIn, colorReset, el('span', 'pg-muted', 'коррекция освещения (0 = выкл):'), light);
    box.appendChild(ctrl);
    if (this.baseColor) box.appendChild(el('div', 'pg-muted', `Авто-цвет ${this.baseColor.hex}: ${this.baseColor.note}. Коррекция освещения делит яркость на её низкочастотное поле; это не восстановление albedo — тёмный принт и тень одного размера неразличимы.`));
    if (this.uvRaw && this.corr) {
      const cov = Object.entries(this.uvRaw.coverage).map(([k, v]) => `${k} ${(v * 100).toFixed(0)} %`).join(', ');
      box.appendChild(el('div', 'pgp-note is-ok', `UV построена: перенесены острова ${this.corr.visibleIslands.join(', ')} (покрытие ${cov}; текселей вне маски ${this.uvRaw.outsideMaskTexels}).`));
      box.appendChild(el('div', 'pgp-note is-warn', 'УСЛОВНО (не восстановлено по снимку, залито основным цветом): спинка, воротник, задняя половина рукавов, разрывы маски.'));
      const imgs = el('div', 'pg-row');
      const c1 = textureCanvas(this.uvRaw.data, 1024, 384);
      c1.id = 'pgp-uv-raw';
      imgs.appendChild(labelled('UV без коррекции', c1));
      if (this.uvLit) {
        const c2 = textureCanvas(this.uvLit.data, 1024, 384);
        c2.id = 'pgp-uv-lit';
        imgs.appendChild(labelled(`UV с коррекцией освещения ${this.lightingStrength}`, c2));
      }
      if (this.photo) {
        const g = gridCanvas(this.photo.working, this.corr);
        g.id = 'pgp-uv-grid';
        imgs.appendChild(labelled('сетка переноса на фото', g));
      }
      box.appendChild(imgs);
    }
  }

  // ------------------------------------------------------------------ stage 12: pixelation + viewer
  runPixel(): void {
    const src = this.uvLit ?? this.uvRaw;
    if (!src || !this.layers) return;
    this.store.setInput('preview_ready', `${JSON.stringify(this.pixelOpts)}:${this.uvLit ? 'lit' : 'raw'}`);
    this.pixel = pixelate(src.data, src.size, this.pixelOpts);
    if (!this.viewer) {
      this.viewer = new GarmentViewer(this.layers.resolved);
    } else this.viewer.setParams(this.layers.resolved);
    this.viewer.setTextures({ data: src.data, size: src.size }, { data: this.pixel.data, size: this.pixel.size });
    this.runFit();
    this.store.setResult('preview_ready', { pixel: this.pixelOpts, palette: this.pixel.palette.length });
    this.record.textures = this.record.textures.filter((t) => t.kind !== 'uv_pixelated');
    this.record.textures.push({ id: this.newId('tex'), kind: 'uv_pixelated', width: this.pixel.size, height: this.pixel.size, coveredIslands: this.corr?.visibleIslands ?? [], conditionalIslands: ['back', 'collar'], processingVersion: PROCESSING_VERSION });
    this.renderPreview();
  }

  /** F01–F04: place the garment on the mannequin (or take it off). Photo-derived params are never modified. */
  runFit(): FitResult | null {
    if (!this.viewer || !this.layers) return null;
    if (!this.fitOpts.enabled) {
      this.body?.dispose();
      this.body = null;
      this.fit = null;
      this.viewer.setBody(null);
      this.viewer.applyFit(null);
      this.record.fit = null;
      return null;
    }
    const preset = BODY_PRESETS.find((p) => p.id === this.fitOpts.preset) ?? BODY_PRESETS[0]!;
    const params = { ...defaultBodyParams(preset.sex), ...preset.params };
    if (!this.body) this.body = new ProceduralBodyAdapter(params);
    else this.body.setBodyParams(params);
    const k = this.fitOpts.easeScale;
    const ease = { chest: DEFAULT_EASE.chest * k, waist: DEFAULT_EASE.waist * k, hem: DEFAULT_EASE.hem * k, shoulder: DEFAULT_EASE.shoulder * k, sleeve: DEFAULT_EASE.sleeve * k };
    this.fit = fitTShirtToBody(this.layers.resolved, this.body.getFrame(), this.body.id, { anchor: this.fitOpts.anchor, fitToBody: this.fitOpts.fitToBody, ease });
    this.viewer.setBody(this.body);
    this.viewer.applyFit(this.fit);
    this.viewer.setView('front');
    this.record.fit = {
      bodyId: this.body.id,
      bodyVersion: BODY_TEMPLATE_VERSION,
      bodyPreset: preset.id,
      anchor: this.fit.anchor,
      scale: this.fit.scale,
      offset: this.fit.offset,
      fitToBody: this.fitOpts.fitToBody,
      fitAdjust: this.fit.fitAdjust.map((a) => ({ ...a })),
      rings: this.fit.rings.map((r) => ({ ring: r.ring, status: r.status, clearance: r.clearance })),
      status: this.fit.status,
      pushedVertices: this.fit.pushedVertices,
      checksPassed: this.fit.ok,
    };
    this.record.avatar = { avatarId: this.body.id, avatarVersion: BODY_TEMPLATE_VERSION, avatarKind: 'production', fit: this.fit.status === 'intersects' ? 'incompatible' : this.fit.status === 'tight' ? 'out_of_range' : 'ok' };
    return this.fit;
  }

  private renderFitControls(): HTMLElement {
    const box = el('div', 'pgp-fit');
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.id = 'pgp-fit-enabled';
    on.checked = this.fitOpts.enabled;
    on.addEventListener('change', () => {
      this.fitOpts.enabled = on.checked;
      this.runFit();
      this.renderPreview();
    });
    const preset = document.createElement('select');
    preset.id = 'pgp-fit-preset';
    for (const p of BODY_PRESETS) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      if (p.id === this.fitOpts.preset) o.selected = true;
      preset.appendChild(o);
    }
    preset.addEventListener('change', () => {
      this.fitOpts.preset = preset.value;
      this.runFit();
      this.renderPreview();
    });
    const anchor = document.createElement('select');
    anchor.id = 'pgp-fit-anchor';
    for (const [v, l] of [
      ['chest', 'по груди'],
      ['shoulder', 'по плечам'],
    ] as const) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      if (v === this.fitOpts.anchor) o.selected = true;
      anchor.appendChild(o);
    }
    anchor.addEventListener('change', () => {
      this.fitOpts.anchor = anchor.value as FitAnchor;
      this.runFit();
      this.renderPreview();
    });
    const toBody = document.createElement('input');
    toBody.type = 'checkbox';
    toBody.id = 'pgp-fit-tobody';
    toBody.checked = this.fitOpts.fitToBody;
    toBody.addEventListener('change', () => {
      this.fitOpts.fitToBody = toBody.checked;
      this.runFit();
      this.renderPreview();
    });
    const easeIn = document.createElement('input');
    easeIn.type = 'range';
    easeIn.min = '0.5';
    easeIn.max = '2';
    easeIn.step = '0.1';
    easeIn.value = String(this.fitOpts.easeScale);
    easeIn.id = 'pgp-fit-ease';
    easeIn.addEventListener('change', () => {
      this.fitOpts.easeScale = Number(easeIn.value);
      this.runFit();
      this.renderPreview();
    });
    const r1 = el('div', 'pg-row');
    r1.append(el('label', '', 'На манекене '), on, el('span', 'pg-muted', 'пропорции:'), preset, el('span', 'pg-muted', 'масштаб:'), anchor, el('label', '', 'подогнать по телу '), toBody, el('span', 'pg-muted', 'свобода ×'), easeIn);
    box.appendChild(r1);
    if (this.fitOpts.enabled && this.fit) {
      const f = this.fit;
      const st = el('div', `pgp-note ${f.status === 'ok' ? 'is-ok' : f.status === 'tight' ? 'is-warn' : 'is-err'}`);
      st.id = 'pgp-fit-status';
      st.textContent = `Посадка: ${f.status === 'ok' ? 'без пересечений' : f.status === 'tight' ? 'в натяг (есть кольца tight)' : 'ПЕРЕСЕЧЕНИЯ с телом'} · масштаб ${f.scale.toFixed(3)} м/ед (${f.anchor === 'chest' ? 'по груди' : 'по плечам'})`;
      box.appendChild(st);
      const tbl = el('table', 'pgp-params');
      tbl.id = 'pgp-fit-rings';
      const thead = el('tr');
      for (const h of ['кольцо', 'зазор до тела', 'нужно (ease)', 'статус']) thead.appendChild(el('th', '', h));
      tbl.appendChild(thead);
      for (const r of f.rings) {
        const tr = el('tr', `is-${r.status}`);
        tr.append(el('td', '', r.ring), el('td', '', r.clearance === null ? '— (тела нет на этой высоте)' : `${(r.clearance * 100).toFixed(1)} см`), el('td', '', `${(r.ease * 100).toFixed(1)} см`), el('td', '', r.status === 'tight' ? 'в натяг' : r.status === 'loose' ? 'свободно' : r.status === 'free' ? 'свисает' : 'ok'));
        tbl.appendChild(tr);
      }
      box.appendChild(tbl);
      if (f.fitAdjust.length) {
        const adj = el('div', 'pg-muted');
        adj.id = 'pgp-fit-adjust';
        adj.textContent = 'Подгонка по телу изменила параметры шаблона (оценка по фото не тронута): ' + f.fitAdjust.map((a) => `${a.name} ${a.from.toFixed(2)} → ${a.to.toFixed(2)}`).join(', ');
        box.appendChild(adj);
      } else if (this.fitOpts.fitToBody) box.appendChild(el('div', 'pg-muted', 'Параметры шаблона менять не пришлось; выталкивание вершин: ' + f.pushedVertices + ` (макс. ${(f.maxPush * 100).toFixed(1)} см).`));
      else box.appendChild(el('div', 'pg-muted', 'Показано как на фото: без подгонки; пересечения и натяг показаны честно.'));
      const ch = el('div', 'pg-muted');
      ch.textContent = f.checks.map((c) => `${c.pass ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'} ${c.name} — ${c.detail}`).join(' · ');
      box.appendChild(ch);
    }
    return box;
  }

  /** re-render step 8 (used by e2e after programmatic fit changes) */
  refreshPreview(): void {
    this.renderPreview();
  }

  private renderPreview() {
    const box = this.els['prevBox']!;
    const keepViewer = this.viewer?.root;
    box.innerHTML = '';
    if (!this.pixel || !this.viewer) {
      box.appendChild(el('p', 'pg-muted', 'Доступно после построения UV.'));
      return;
    }
    const ctrl = el('div', 'pg-row');
    const sizeSel = document.createElement('select');
    for (const sz of [64, 128, 256]) {
      const o = document.createElement('option');
      o.value = String(sz);
      o.textContent = `${sz} px`;
      if (sz === this.pixelOpts.size) o.selected = true;
      sizeSel.appendChild(o);
    }
    sizeSel.id = 'pgp-pixel-size';
    sizeSel.addEventListener('change', () => {
      this.pixelOpts.size = Number(sizeSel.value) as 64 | 128 | 256;
      this.runPixel();
    });
    const colors = document.createElement('input');
    colors.type = 'range';
    colors.min = '0';
    colors.max = '64';
    colors.step = '4';
    colors.value = String(this.pixelOpts.colors);
    colors.id = 'pgp-pixel-colors';
    colors.addEventListener('change', () => {
      this.pixelOpts.colors = Number(colors.value);
      this.runPixel();
    });
    const dither = document.createElement('input');
    dither.type = 'checkbox';
    dither.checked = this.pixelOpts.dither;
    dither.id = 'pgp-pixel-dither';
    dither.addEventListener('change', () => {
      this.pixelOpts.dither = dither.checked;
      this.runPixel();
    });
    const strength = document.createElement('input');
    strength.type = 'range';
    strength.min = '0';
    strength.max = '1';
    strength.step = '0.1';
    strength.value = String(this.pixelOpts.strength);
    strength.id = 'pgp-pixel-strength';
    strength.addEventListener('change', () => {
      this.pixelOpts.strength = Number(strength.value);
      this.runPixel();
    });
    ctrl.append(el('span', 'pg-muted', 'размер'), sizeSel, el('span', 'pg-muted', `цветов: ${this.pixelOpts.colors || 'без квантования'}`), colors, el('span', 'pg-muted', 'дизеринг'), dither, el('span', 'pg-muted', 'сила'), strength);
    box.appendChild(ctrl);
    box.appendChild(el('div', 'pg-muted', `Пикселизация меняет только текстуру (меш тот же). Палитра: ${this.pixel.palette.length || '—'} цветов. Текстура ${this.pixel.size}² покрывает весь атлас; перёд занимает ~45 % его высоты.`));
    const imgs = el('div', 'pg-row');
    const src = this.uvLit ?? this.uvRaw!;
    imgs.appendChild(labelled('исходная UV', textureCanvas(src.data, src.size, 256)));
    const pc = textureCanvas(this.pixel.data, this.pixel.size, 256);
    pc.id = 'pgp-pixel-canvas';
    imgs.appendChild(labelled('пиксельная UV', pc));
    box.appendChild(imgs);
    // viewer
    const vrow = el('div', 'pg-row');
    for (const v of ['front', 'back', 'threequarter', 'threequarter_back'] as GarmentView[]) {
      const b = button(v, () => this.viewer!.setView(v));
      b.dataset['view'] = v;
      vrow.appendChild(b);
    }
    for (const m of ['original', 'pixel', 'none'] as const) {
      const b = button(`текстура: ${m === 'original' ? 'исходная' : m === 'pixel' ? 'пиксельная' : 'нет'}`, () => {
        this.viewer!.setMode(m);
        vrow.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('is-active', (x as HTMLElement).dataset['mode'] === m));
      });
      b.dataset['mode'] = m;
      if (this.viewer.getMode() === m) b.classList.add('is-active');
      vrow.appendChild(b);
    }
    box.appendChild(vrow);
    box.appendChild(el('div', 'pg-muted', 'Вращение — мышью, зум — колесом. Спинка и воротник — условные, залиты основным цветом. Манекен — процедурный (пропорции, не мерки); посадка — выравнивание + зазор + выталкивание, не физика ткани.'));
    box.appendChild(this.renderFitControls());
    box.appendChild(keepViewer ?? this.viewer.root);
    const exp = button('Сохранить пакет C (JSON + UV + пиксельная + маска)', () => this.exportC());
    exp.id = 'pgp-export-c';
    box.appendChild(row(exp));
    if (this.store.status('saved') === 'success') box.appendChild(el('div', 'pgp-note is-ok', 'Пакет сохранён (скачан).'));
  }

  private exportC() {
    this.store.setInput('saved', `${Date.now()}`);
    const snap = this.snapshot();
    const dl = (name: string, href: string) => {
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.click();
    };
    dl(`${this.record.id}.json`, 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ ...snap, layers: this.layers, pixelOpts: this.pixelOpts }, null, 2)));
    if (this.uvRaw) dl(`${this.record.id}-uv-raw.png`, textureCanvas(this.uvRaw.data, 1024, 1024).toDataURL('image/png'));
    if (this.uvLit) dl(`${this.record.id}-uv-corrected.png`, textureCanvas(this.uvLit.data, 1024, 1024).toDataURL('image/png'));
    if (this.pixel) dl(`${this.record.id}-uv-pixel.png`, textureCanvas(this.pixel.data, this.pixel.size, this.pixel.size).toDataURL('image/png'));
    this.store.setResult('saved', { at: new Date().toISOString() });
    this.renderPreview();
  }

  // ------------------------------------------------------------------ status
  private renderStatus() {
    const st = this.els['status']!;
    st.innerHTML = '';
    for (const s of PIPELINE_STAGES) {
      const r = this.store.get(s);
      const line = el('div', `pgp-stage is-${r.status}`, `${s}: ${r.status}${r.error ? ` — ${r.error}` : ''}`);
      line.dataset['stage'] = s;
      st.appendChild(line);
    }
    const pv = this.els['providers']!;
    pv.innerHTML = '';
    const info = this.client.info;
    if (!info) {
      pv.appendChild(el('div', 'pg-muted', 'Модели загружаются… (MobileNetV2-12 14 МБ + U²-Netp 4.6 МБ, из /models/, кешируются браузером)'));
    } else {
      pv.appendChild(el('div', '', `Категория: ${info.category.id} · ${info.category.version}`));
      pv.appendChild(el('div', 'pg-muted', info.category.description));
      pv.appendChild(el('div', '', `Маска: ${info.segmentation.id} · ${info.segmentation.version}`));
      pv.appendChild(el('div', 'pg-muted', info.segmentation.description));
      pv.appendChild(el('div', 'pg-muted', `backend: ${info.backend}, загрузка ${info.loadMs.toFixed(0)} мс. Изображение не отправляется на внешний сервис.`));
    }
  }

  snapshot(): GarmentAppState & { maskSummary: unknown; photoWorking: { width: number; height: number } | null } {
    const stages = {} as Record<PipelineStage, string>;
    for (const s of PIPELINE_STAGES) stages[s] = this.store.status(s);
    let maskSummary: unknown = null;
    if (this.editor && this.photo) {
      const m = this.editor.getMask();
      const b = maskBounds(m, this.photo.working.width, this.photo.working.height);
      maskSummary = { strokes: this.editor.getStrokes(), bounds: b, coverage: b ? b.area / (this.photo.working.width * this.photo.working.height) : 0 };
    }
    return {
      record: this.record,
      stages,
      category: this.categoryResult,
      categoryError: this.categoryError,
      segmentation: this.segResult ? { ...this.segResult, soft: undefined as unknown as Uint8ClampedArray, binary: undefined as unknown as Uint8Array } : null,
      segmentationError: this.segError,
      maskStrokes: this.editor?.getStrokes() ?? 0,
      maskLayers: this.photo && this.editor ? { threshold: this.maskThreshold, model: this.maskModel ? assessMask(this.maskModel, this.photo.working.width, this.photo.working.height) : null, post: this.maskPost ? assessMask(this.maskPost, this.photo.working.width, this.photo.working.height) : null, user: assessMask(this.editor.getMask(), this.photo.working.width, this.photo.working.height), postInfo: this.maskPostInfo ? { removedComponents: this.maskPostInfo.removedComponents.length, openHoles: this.maskPostInfo.openHoles.length, smallHolesFilled: this.maskPostInfo.smallHolesFilled } : null } : null,
      providers: this.client.info,
      maskSummary,
      photoWorking: this.photo ? { width: this.photo.working.width, height: this.photo.working.height } : null,
    };
  }

  dispose(): void {
    this.cancelAll();
    this.photo?.revoke();
    this.editor?.dispose();
    this.client.terminate();
  }
}

// ---------------------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function button(label: string, on: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', on);
  return b;
}
function row(...children: HTMLElement[]): HTMLElement {
  const r = el('div', 'pg-row');
  r.append(...children);
  return r;
}
function step(title: string): HTMLElement {
  const s = el('section', 'pgp-step');
  s.appendChild(el('h2', '', title));
  return s;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function textureCanvas(data: Uint8ClampedArray, size: number, display: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
  c.style.width = `${display}px`;
  c.style.height = `${display}px`;
  c.style.imageRendering = 'pixelated';
  c.className = 'pgp-texcanvas';
  return c;
}
function gridCanvas(photo: { width: number; height: number; data: Uint8ClampedArray }, corr: Correspondence): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = photo.width;
  c.height = photo.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(photo.data), photo.width, photo.height), 0, 0);
  ctx.strokeStyle = 'rgba(255,61,0,0.9)';
  ctx.lineWidth = 0.8;
  for (let t = 0; t < corr.triangles.length; t += 3) {
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const v = corr.triangles[t + k]!;
      const x = corr.xy[v * 2]!,
        y = corr.xy[v * 2 + 1]!;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  c.style.maxWidth = '300px';
  c.style.height = 'auto';
  return c;
}
function labelled(label: string, node: HTMLElement): HTMLElement {
  const w = el('figure', 'pgp-fig');
  w.append(node, el('figcaption', 'pg-muted', label));
  return w;
}
