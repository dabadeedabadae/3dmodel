import { BadRequestException } from '@nestjs/common';

/**
 * Validation of the photo → 3D package the browser computes (frontend/lib/garment/analyze.ts). The server
 * cannot recompute it, so it accepts only a strictly shaped document: known keys, finite numbers inside the
 * image, bounded strings. Anything else is rejected, never stored half-checked.
 */
const POINTS = [
  'neck_left', 'neck_right', 'neck_bottom', 'shoulder_left', 'shoulder_right', 'armpit_left', 'armpit_right',
  'cuff_left_top', 'cuff_left_bottom', 'cuff_right_top', 'cuff_right_bottom', 'hem_left', 'hem_right',
] as const;

export interface Garment3d {
  version: 1;
  category: 'tshirt';
  anchors: { width: number; height: number; points: Record<string, { x: number; y: number }>; rows: { left: { x: number; y: number }; right: { x: number; y: number } }[] };
  baseColor: string;
  maskQuality: 'ok' | 'suspicious' | 'empty';
  landmarkStatus: 'ok' | 'uncertain';
  anchorIssues: string[];
  needsReview: boolean;
  provider: string;
}

const fail = (why: string): never => { throw new BadRequestException(`Пакет 3D-вещи отклонён: ${why}.`); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseGarment3d(raw: unknown): Garment3d {
  if (typeof raw !== 'string' || raw.length > 20_000) fail('ожидается JSON до 20 КБ');
  let j: unknown;
  try { j = JSON.parse(raw as string); } catch { fail('не JSON'); }
  if (!isObj(j)) return fail('не объект');
  if (j.version !== 1 || j.category !== 'tshirt') fail('неизвестная версия или категория');
  const a = j.anchors;
  if (!isObj(a)) return fail('нет опорных точек');
  const W = a.width, H = a.height;
  if (!Number.isInteger(W) || !Number.isInteger(H) || (W as number) < 16 || (H as number) < 16 || (W as number) > 4096 || (H as number) > 4096) fail('размер снимка');
  const pt = (p: unknown, what: string) => {
    if (!isObj(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) fail(`точка ${what}`);
    const { x, y } = p as { x: number; y: number };
    if (x < -(W as number) || x > 2 * (W as number) || y < -(H as number) || y > 2 * (H as number)) fail(`точка ${what} вне снимка`);
    return { x, y };
  };
  if (!isObj(a.points)) fail('нет точек');
  const pts = a.points as Record<string, unknown>;
  if (Object.keys(pts).length !== POINTS.length) fail('лишние или недостающие точки');
  const points = Object.fromEntries(POINTS.map((k) => [k, pt(pts[k], k)]));
  if (!Array.isArray(a.rows) || a.rows.length !== 4) fail('ряды');
  const rows = (a.rows as unknown[]).map((r, i) => { if (!isObj(r)) fail(`ряд ${i}`); return { left: pt((r as Record<string, unknown>).left, `ряд ${i}`), right: pt((r as Record<string, unknown>).right, `ряд ${i}`) }; });
  if (typeof j.baseColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(j.baseColor)) fail('цвет');
  if (!['ok', 'suspicious', 'empty'].includes(j.maskQuality as string)) fail('статус маски');
  if (!['ok', 'uncertain'].includes(j.landmarkStatus as string)) fail('статус точек');
  if (!Array.isArray(j.anchorIssues) || j.anchorIssues.length > 10 || !j.anchorIssues.every((s) => typeof s === 'string' && s.length <= 200)) fail('замечания');
  if (typeof j.needsReview !== 'boolean') fail('флаг проверки');
  if (typeof j.provider !== 'string' || j.provider.length > 120) fail('модель');
  return {
    version: 1, category: 'tshirt', anchors: { width: W as number, height: H as number, points, rows },
    baseColor: (j.baseColor as string).toLowerCase(), maskQuality: j.maskQuality as Garment3d['maskQuality'],
    landmarkStatus: j.landmarkStatus as Garment3d['landmarkStatus'], anchorIssues: j.anchorIssues as string[],
    // the server never lets a package claim it is fine when its own statuses say otherwise
    needsReview: (j.needsReview as boolean) || j.landmarkStatus !== 'ok' || j.maskQuality !== 'ok' || (j.anchorIssues as string[]).length > 0,
    provider: j.provider as string,
  };
}
