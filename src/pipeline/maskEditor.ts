/**
 * Stage 07 — mask editor. Binary mask in working-photo pixel coordinates,
 * brush add/erase, undo, zoom. Pure DOM + canvas, no framework.
 */
import type { RasterImage } from '../image/raster';

export interface MaskEditorOptions {
  onChange?: (mask: Uint8Array, strokes: number) => void;
}

export class MaskEditor {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cropCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private photo: RasterImage;
  private mask: Uint8Array;
  private undoStack: Uint8Array[] = [];
  private mode: 'add' | 'erase' = 'add';
  private brush = 18;
  private zoom = 1;
  private drawing = false;
  private strokes = 0;
  private photoImage: ImageData;
  private opts: MaskEditorOptions;
  private controls: HTMLElement;

  constructor(photo: RasterImage, mask: Uint8Array, opts: MaskEditorOptions = {}) {
    this.photo = photo;
    this.mask = mask.slice();
    this.opts = opts;
    this.root = document.createElement('div');
    this.root.className = 'pg-maskeditor';
    this.controls = document.createElement('div');
    this.controls.className = 'pg-row';
    const scroller = document.createElement('div');
    scroller.className = 'pg-maskscroll';
    this.canvas = document.createElement('canvas');
    this.canvas.width = photo.width;
    this.canvas.height = photo.height;
    this.canvas.className = 'pg-maskcanvas';
    scroller.appendChild(this.canvas);
    this.cropCanvas = document.createElement('canvas');
    this.cropCanvas.width = photo.width;
    this.cropCanvas.height = photo.height;
    this.cropCanvas.className = 'pg-cropcanvas';
    const cropWrap = document.createElement('div');
    cropWrap.className = 'pg-cropwrap';
    cropWrap.append(Object.assign(document.createElement('div'), { className: 'pg-muted', textContent: 'Прозрачный crop (что пойдёт дальше)' }), this.cropCanvas);
    this.root.append(this.controls, scroller, cropWrap);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.photoImage = new ImageData(new Uint8ClampedArray(photo.data), photo.width, photo.height);
    this.buildControls();
    this.bindPointer();
    this.render();
  }

  getMask(): Uint8Array {
    return this.mask.slice();
  }
  getStrokes(): number {
    return this.strokes;
  }
  setMask(mask: Uint8Array): void {
    this.mask = mask.slice();
    this.render();
  }
  /** Programmatic change that counts as a user action (undoable, bumps strokes). */
  setMaskWithUndo(mask: Uint8Array, _reason: string): void {
    this.pushUndo();
    this.strokes++;
    this.mask = mask.slice();
    this.render();
    this.opts.onChange?.(this.mask, this.strokes);
  }

  private buildControls() {
    const btn = (label: string, cls: string, on: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = cls;
      b.addEventListener('click', on);
      return b;
    };
    const add = btn('Кисть: добавить', 'pg-mode is-active', () => this.setMode('add'));
    const erase = btn('Кисть: стереть', 'pg-mode', () => this.setMode('erase'));
    add.dataset['mode'] = 'add';
    erase.dataset['mode'] = 'erase';
    const undo = btn('Отменить', '', () => this.undo());
    undo.dataset['action'] = 'undo';
    const size = document.createElement('input');
    size.type = 'range';
    size.min = '2';
    size.max = '80';
    size.value = String(this.brush);
    size.title = 'Размер кисти';
    size.addEventListener('input', () => (this.brush = Number(size.value)));
    const zoom = document.createElement('input');
    zoom.type = 'range';
    zoom.min = '0.5';
    zoom.max = '4';
    zoom.step = '0.25';
    zoom.value = '1';
    zoom.title = 'Масштаб просмотра';
    zoom.addEventListener('input', () => this.setZoom(Number(zoom.value)));
    const lbl = (t: string) => Object.assign(document.createElement('span'), { textContent: t, className: 'pg-muted' });
    this.controls.append(add, erase, undo, lbl('кисть'), size, lbl('зум'), zoom);
  }

  private setMode(m: 'add' | 'erase') {
    this.mode = m;
    this.controls.querySelectorAll<HTMLButtonElement>('.pg-mode').forEach((b) => b.classList.toggle('is-active', b.dataset['mode'] === m));
  }

  private setZoom(z: number) {
    this.zoom = z;
    this.canvas.style.width = `${this.photo.width * z}px`;
    this.canvas.style.height = `${this.photo.height * z}px`;
  }

  private bindPointer() {
    const toImage = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * this.photo.width, y: ((e.clientY - r.top) / r.height) * this.photo.height };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.pushUndo();
      this.drawing = true;
      this.strokes++;
      const p = toImage(e);
      this.stamp(p.x, p.y);
      this.render();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      const p = toImage(e);
      this.stamp(p.x, p.y);
      this.render();
    });
    const end = () => {
      if (!this.drawing) return;
      this.drawing = false;
      this.opts.onChange?.(this.mask, this.strokes);
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  /** Programmatic stroke (used by tests/e2e): points in image pixels. */
  stroke(points: { x: number; y: number }[], mode: 'add' | 'erase' = this.mode, radius = this.brush): void {
    const prevMode = this.mode;
    const prevBrush = this.brush;
    this.mode = mode;
    this.brush = radius;
    this.pushUndo();
    this.strokes++;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[Math.min(i + 1, points.length - 1)]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (radius * 0.5)));
      for (let k = 0; k <= n; k++) this.stamp(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
    }
    this.mode = prevMode;
    this.brush = prevBrush;
    this.render();
    this.opts.onChange?.(this.mask, this.strokes);
  }

  private stamp(cx: number, cy: number) {
    const r = this.brush;
    const v = this.mode === 'add' ? 1 : 0;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.photo.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.photo.height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.mask[y * this.photo.width + x] = v;
  }

  private pushUndo() {
    this.undoStack.push(this.mask.slice());
    if (this.undoStack.length > 25) this.undoStack.shift();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.mask = prev;
    this.render();
    this.opts.onChange?.(this.mask, this.strokes);
  }

  render(): void {
    const { width, height } = this.photo;
    const img = new ImageData(new Uint8ClampedArray(this.photoImage.data), width, height);
    const d = img.data;
    for (let i = 0; i < width * height; i++) {
      if (!this.mask[i]) {
        const o = i * 4;
        d[o] = d[o]! * 0.35;
        d[o + 1] = d[o + 1]! * 0.35;
        d[o + 2] = Math.min(255, d[o + 2]! * 0.35 + 110);
      }
    }
    // thin outline: mask pixels with a non-mask 4-neighbour
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (this.mask[i] && (!this.mask[i - 1] || !this.mask[i + 1] || !this.mask[i - width] || !this.mask[i + width])) {
          const o = i * 4;
          d[o] = 255;
          d[o + 1] = 230;
          d[o + 2] = 0;
        }
      }
    }
    this.ctx.putImageData(img, 0, 0);
    // crop preview
    const crop = new ImageData(new Uint8ClampedArray(this.photoImage.data), width, height);
    for (let i = 0; i < width * height; i++) crop.data[i * 4 + 3] = this.mask[i] ? 255 : 0;
    this.cropCanvas.getContext('2d')!.putImageData(crop, 0, 0);
  }

  dispose(): void {
    this.undoStack = [];
    this.root.remove();
  }
}
