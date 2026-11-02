/**
 * UV checker texture with letters and a grid, generated on a canvas.
 *
 * Why letters: a plain checkerboard cannot reveal a mirrored island; readable
 * glyphs (F, R, G, 2, 4, 7) can. Each island rect gets its own tint, its name
 * and a lettered coordinate grid; stretched cells show up as non-square.
 *
 * Image Y runs downward; three.js CanvasTexture has flipY = true, so uv v=0 is
 * the bottom row of the canvas. We draw in uv space via `toPx`.
 */

import * as THREE from 'three';
import type { IslandMeta } from '../templates/tshirt/buildTShirt';

export interface CheckerOptions {
  size?: number; // px, square
  cell?: number; // uv units per cell
}

const TINTS: Record<string, [string, string]> = {
  front: ['#cfe3ff', '#9ec3f7'],
  back: ['#ffd9c9', '#f7b28f'],
  sleeve_left: ['#d6f5d6', '#a3e0a3'], // +X, wearer's left
  sleeve_right: ['#f3d9f7', '#dfa8ea'], // -X, wearer's right
  collar: ['#fff2b3', '#f2d873'],
};

const LETTERS = 'FRG247KPJLQBDE';

export function drawUVChecker(canvas: HTMLCanvasElement, islands: IslandMeta[], opts: CheckerOptions = {}): void {
  const size = opts.size ?? 1024;
  const cell = opts.cell ?? 1 / 32;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const toPx = (u: number, v: number): [number, number] => [u * size, (1 - v) * size];

  // background: neutral grey with a faint global grid (anything that shows this on the mesh is outside all islands)
  ctx.fillStyle = '#6b6f78';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#7d818a';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 1 / cell; i++) {
    const [x] = toPx(i * cell, 0);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
    const [, y] = toPx(0, i * cell);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  for (const isl of islands) {
    const r = isl.uvRect;
    const [light, dark] = TINTS[isl.name] ?? ['#dddddd', '#aaaaaa'];
    // checker cells aligned to the global cell grid, clipped to the rect
    const [x0, y1] = toPx(r.u0, r.v0);
    const [x1, y0] = toPx(r.u1, r.v1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    const c0 = Math.floor(r.u0 / cell);
    const c1 = Math.ceil(r.u1 / cell);
    const r0 = Math.floor(r.v0 / cell);
    const r1 = Math.ceil(r.v1 / cell);
    for (let i = c0; i < c1; i++) {
      for (let j = r0; j < r1; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? light : dark;
        const [px, py] = toPx(i * cell, (j + 1) * cell);
        ctx.fillRect(px, py, cell * size + 0.5, cell * size + 0.5);
      }
    }
    // letters: column letter + row digit in every other cell, small
    ctx.fillStyle = '#1b1e26';
    ctx.font = `${Math.round(cell * size * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = c0; i < c1; i++) {
      for (let j = r0; j < r1; j++) {
        if ((i + j) % 2 !== 0) continue;
        const [px, py] = toPx((i + 0.5) * cell, (j + 0.5) * cell);
        ctx.fillText(LETTERS[(i - c0) % LETTERS.length]! + String((j - r0) % 10), px, py);
      }
    }
    // island label — large, asymmetric glyphs reveal mirroring at a glance
    ctx.fillStyle = 'rgba(20,24,34,0.82)';
    const label = isl.name.toUpperCase().replace('_', ' ');
    const fontPx = Math.min((x1 - x0) / (label.length * 0.62), (y1 - y0) * 0.45);
    ctx.font = `bold ${Math.round(fontPx)}px sans-serif`;
    ctx.fillText(label, (x0 + x1) / 2, (y0 + y1) / 2);
    // arrow pointing "up" in uv (towards v=1) so vertical flips are visible
    ctx.strokeStyle = '#1b1e26';
    ctx.lineWidth = Math.max(2, size / 400);
    const ax = x0 + (x1 - x0) * 0.08;
    const ay0 = y1 - (y1 - y0) * 0.12;
    const ay1 = y0 + (y1 - y0) * 0.12;
    ctx.beginPath();
    ctx.moveTo(ax, ay0);
    ctx.lineTo(ax, ay1);
    ctx.lineTo(ax - 8, ay1 + 12);
    ctx.moveTo(ax, ay1);
    ctx.lineTo(ax + 8, ay1 + 12);
    ctx.stroke();
    ctx.restore();
    // rect outline
    ctx.strokeStyle = '#1b1e26';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

export function createCheckerTexture(islands: IslandMeta[], opts: CheckerOptions = {}): { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  drawUVChecker(canvas, islands, opts);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, canvas };
}

/** Draws the UV wireframe of a geometry over a checker image (2D diagnostic). */
export function drawUVLayout(canvas: HTMLCanvasElement, geometry: THREE.BufferGeometry, islands: IslandMeta[], size = 1024): void {
  drawUVChecker(canvas, islands, { size });
  const ctx = canvas.getContext('2d')!;
  const uv = geometry.attributes.uv!.array as ArrayLike<number>;
  const idx = geometry.index!.array as ArrayLike<number>;
  ctx.strokeStyle = 'rgba(200,20,40,0.9)';
  ctx.lineWidth = 1.5;
  for (let t = 0; t < idx.length; t += 3) {
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k]!;
      const x = uv[i * 2]! * size;
      const y = (1 - uv[i * 2 + 1]!) * size;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}
