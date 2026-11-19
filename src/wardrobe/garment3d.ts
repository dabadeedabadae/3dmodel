import { BadRequestException } from '@nestjs/common';

/**
 * Validation of the photo → 3D package the browser computes (frontend/lib/garment/analyze.ts). The server
 * cannot recompute it, so it accepts only a strictly shaped document: known keys, finite numbers inside the
 * image, bounded strings. Anything else is rejected, never stored half-checked.
 */
const PANTS_POINTS = [
  'waist_left', 'waist_right', 'crotch', 'hip_left', 'hip_right',
  'hem_left_outer', 'hem_left_inner', 'hem_right_inner', 'hem_right_outer',
] as const;
const POINTS = [
  'neck_left', 'neck_right', 'neck_bottom', 'shoulder_left', 'shoulder_right', 'armpit_left', 'armpit_right',
  'cuff_left_top', 'cuff_left_bottom', 'cuff_right_top', 'cuff_right_bottom', 'hem_left', 'hem_right',
] as const;

type Pt = { x: number; y: number };
export interface Garment3d {
  version: 1;
  /** tshirt → figure top (I-51); top → long-sleeved top: shirt, hoodie, sweater (same points); pants → figure
   *  bottom, trousers and jeans (I-53) */
  category: 'tshirt' | 'top' | 'pants';
  anchors:
    | { width: number; height: number; points: Record<string, Pt>; rows: { left: Pt; right: Pt }[] }
    | { width: number; height: number; points: Record<string, Pt>; seat: { left: Pt; right: Pt }[]; legLeft: { outer: Pt; inner: Pt }[]; legRight: { inner: Pt; outer: Pt }[] };
  baseColor: string;
  maskQuality: 'ok' | 'suspicious' | 'empty';
  landmarkStatus: 'ok' | 'uncertain';
  anchorIssues: string[];
  needsReview: boolean;
  provider: string;
  /** who placed the points: the estimator or the person in the form (I-63); absent in older packages = 'auto' */
  pointsSource: 'auto' | 'user';
}

const fail = (why: string): never => { throw new BadRequestException(`Пакет 3D-вещи отклонён: ${why}.`); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseGarment3d(raw: unknown): Garment3d {
  if (typeof raw !== 'string' || raw.length > 20_000) fail('ожидается JSON до 20 КБ');
  let j: unknown;
  try { j = JSON.parse(raw as string); } catch { fail('не JSON'); }
  if (!isObj(j)) return fail('не объект');
  if (j.version !== 1 || !['tshirt', 'top', 'pants'].includes(j.category as string)) fail('неизвестная версия или категория');
  const isPants = j.category === 'pants';
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
  const names = isPants ? PANTS_POINTS : POINTS;
  if (Object.keys(pts).length !== names.length) fail('лишние или недостающие точки');
  const points = Object.fromEntries(names.map((k) => [k, pt(pts[k], k)]));
  /** an array of exactly n rows, each { a, b } of two points */
  const rowList = <A extends string, B extends string>(v: unknown, n: number, ka: A, kb: B, what: string) => {
    if (!Array.isArray(v) || v.length !== n) fail(what);
    return (v as unknown[]).map((r, i) => {
      if (!isObj(r) || Object.keys(r).length !== 2) fail(`${what} ${i}`);
      const rr = r as Record<string, unknown>;
      return { [ka]: pt(rr[ka], `${what} ${i}`), [kb]: pt(rr[kb], `${what} ${i}`) } as Record<A | B, Pt>;
    });
  };
  const anchors: Garment3d['anchors'] = isPants
    ? { width: W as number, height: H as number, points, seat: rowList(a.seat, 5, 'left', 'right', 'сиденье'), legLeft: rowList(a.legLeft, 9, 'outer', 'inner', 'левая штанина'), legRight: rowList(a.legRight, 9, 'inner', 'outer', 'правая штанина') }
    : { width: W as number, height: H as number, points, rows: rowList(a.rows, 4, 'left', 'right', 'ряд') };
  const extra = Object.keys(a).filter((k) => !['width', 'height', 'points', ...(isPants ? ['seat', 'legLeft', 'legRight'] : ['rows'])].includes(k));
  if (extra.length) fail('лишние поля');
  if (typeof j.baseColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(j.baseColor)) fail('цвет');
  if (!['ok', 'suspicious', 'empty'].includes(j.maskQuality as string)) fail('статус маски');
  if (!['ok', 'uncertain'].includes(j.landmarkStatus as string)) fail('статус точек');
  if (!Array.isArray(j.anchorIssues) || j.anchorIssues.length > 10 || !j.anchorIssues.every((s) => typeof s === 'string' && s.length <= 200)) fail('замечания');
  if (typeof j.needsReview !== 'boolean') fail('флаг проверки');
  if (typeof j.provider !== 'string' || j.provider.length > 120) fail('модель');
  if (j.pointsSource !== undefined && j.pointsSource !== 'auto' && j.pointsSource !== 'user') fail('источник точек');
  // the manual point editor exists for tops only; trousers points always come from the estimator
  if (j.pointsSource === 'user' && isPants) fail('ручные точки — только для верха');
  return {
    version: 1, category: j.category as Garment3d['category'], anchors,
    baseColor: (j.baseColor as string).toLowerCase(), maskQuality: j.maskQuality as Garment3d['maskQuality'],
    landmarkStatus: j.landmarkStatus as Garment3d['landmarkStatus'], anchorIssues: j.anchorIssues as string[],
    // the server never lets a package claim it is fine when its own statuses say otherwise
    needsReview: (j.needsReview as boolean) || j.landmarkStatus !== 'ok' || j.maskQuality !== 'ok' || (j.anchorIssues as string[]).length > 0,
    provider: j.provider as string,
    pointsSource: (j.pointsSource as 'auto' | 'user' | undefined) ?? 'auto',
  };
}
