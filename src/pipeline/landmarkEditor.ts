/**
 * Stage 08 UI — draggable landmarks over the photo (mask outside dimmed).
 * Every drag marks the point `user_adjusted`; nothing is "measured" unless
 * the estimator said so. Works at any zoom because hit-testing uses the
 * canvas' client rect, not fixed pixels.
 */
import type { Landmark } from '../domain/types';
import type { RasterImage } from '../image/raster';
import { TSHIRT_LANDMARK_NAMES, type LandmarkEstimate, type TShirtLandmarkName } from '../shape/landmarks';

const COLORS: Record<Landmark['status'], string> = { ok: '#00e676', uncertain: '#ffab00', unknown: '#ff1744' };

export class LandmarkEditor {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private points: Record<TShirtLandmarkName, Landmark>;
  private base: ImageData;
  private dragging: TShirtLandmarkName | null = null;
  private zoom = 1;
  private edits = 0;
  private onChange: (points: Record<TShirtLandmarkName, Landmark>, edits: number) => void;
  private contour: LandmarkEstimate['contour'];

  constructor(photo: RasterImage, mask: Uint8Array, est: LandmarkEstimate, onChange: LandmarkEditor['onChange']) {
    this.onChange = onChange;
    this.points = JSON.parse(JSON.stringify(est.points));
    this.contour = est.contour;
    this.root = document.createElement('div');
    this.root.className = 'pg-lmeditor';
    const controls = document.createElement('div');
    controls.className = 'pg-row';
    const zoom = document.createElement('input');
    zoom.type = 'range';
    zoom.min = '0.5';
    zoom.max = '3';
    zoom.step = '0.25';
    zoom.value = '1';
    zoom.title = 'Масштаб просмотра';
    zoom.addEventListener('input', () => this.setZoom(Number(zoom.value)));
    const legend = document.createElement('span');
    legend.className = 'pg-muted';
    legend.textContent = 'зелёный — оценка прошла проверки, жёлтый — неуверенно / значение по умолчанию, синий — сдвинуто вами. Перетащите точку, чтобы исправить.';
    controls.append(zoom, legend);
    const scroller = document.createElement('div');
    scroller.className = 'pg-maskscroll';
    this.canvas = document.createElement('canvas');
    this.canvas.width = photo.width;
    this.canvas.height = photo.height;
    this.canvas.className = 'pg-maskcanvas';
    scroller.appendChild(this.canvas);
    this.root.append(controls, scroller);
    this.ctx = this.canvas.getContext('2d')!;
    const d = new Uint8ClampedArray(photo.data);
    for (let i = 0; i < photo.width * photo.height; i++)
      if (!mask[i]) {
        d[i * 4] = d[i * 4]! * 0.35;
        d[i * 4 + 1] = d[i * 4 + 1]! * 0.35;
        d[i * 4 + 2] = Math.min(255, d[i * 4 + 2]! * 0.35 + 90);
      }
    this.base = new ImageData(d, photo.width, photo.height);
    this.bind();
    this.render();
  }

  getPoints(): Record<TShirtLandmarkName, Landmark> {
    return JSON.parse(JSON.stringify(this.points));
  }
  getEdits(): number {
    return this.edits;
  }
  setPoints(p: Record<TShirtLandmarkName, Landmark>): void {
    this.points = JSON.parse(JSON.stringify(p));
    this.render();
  }
  /** programmatic move (e2e / tests) — counts as a user edit */
  movePoint(name: TShirtLandmarkName, x: number, y: number): void {
    const p = this.points[name];
    p.x = Math.round(x);
    p.y = Math.round(y);
    p.source = 'user_adjusted';
    p.status = 'ok';
    this.edits++;
    this.render();
    this.onChange(this.getPoints(), this.edits);
  }

  private setZoom(z: number) {
    this.zoom = z;
    this.canvas.style.width = `${this.canvas.width * z}px`;
    this.canvas.style.height = `${this.canvas.height * z}px`;
  }

  private toImage(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.canvas.width, y: ((e.clientY - r.top) / r.height) * this.canvas.height };
  }

  private bind() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = this.toImage(e);
      let best: TShirtLandmarkName | null = null,
        bd = 12 / this.zoom;
      for (const n of TSHIRT_LANDMARK_NAMES) {
        const q = this.points[n];
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      if (!best) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = best;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const p = this.toImage(e);
      const q = this.points[this.dragging];
      q.x = Math.round(Math.max(0, Math.min(this.canvas.width - 1, p.x)));
      q.y = Math.round(Math.max(0, Math.min(this.canvas.height - 1, p.y)));
      q.source = 'user_adjusted';
      q.status = 'ok';
      this.render();
    });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = null;
      this.edits++;
      this.onChange(this.getPoints(), this.edits);
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  render(): void {
    const ctx = this.ctx;
    ctx.putImageData(this.base, 0, 0);
    // contour
    ctx.strokeStyle = 'rgba(41,121,255,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    this.contour.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    // guide lines
    const P = this.points;
    const line = (a: Landmark, b: Landmark) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([4, 3]);
    line(P.shoulder_left, P.armpit_left);
    line(P.shoulder_right, P.armpit_right);
    line(P.armpit_left, P.hem_left);
    line(P.armpit_right, P.hem_right);
    line(P.hem_left, P.hem_right);
    line(P.shoulder_left, P.neck_left);
    line(P.shoulder_right, P.neck_right);
    line(P.cuff_left_top, P.cuff_left_bottom);
    line(P.cuff_right_top, P.cuff_right_bottom);
    line(P.neck_left, P.neck_bottom);
    line(P.neck_bottom, P.neck_right);
    ctx.setLineDash([]);
    for (const n of TSHIRT_LANDMARK_NAMES) {
      const p = P[n];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.source === 'user_adjusted' ? '#2979ff' : COLORS[p.status];
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2;
      const label = n.replace(/_/g, ' ');
      ctx.strokeText(label, p.x + 7, p.y - 4);
      ctx.fillText(label, p.x + 7, p.y - 4);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
