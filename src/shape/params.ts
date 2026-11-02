/**
 * Stage 09 — landmarks -> template parameters, with provenance kept apart:
 *
 *   estimated  : straight from the photo ratios (relative units, no centimetres)
 *   applied    : after the template's own limits/derived rules (clampTShirtParams)
 *   user       : overrides the user set with the sliders
 *
 * `resolveParams` merges them: user > applied(estimated). The record stores all
 * three so a later change (re-estimate, new template version) never silently
 * destroys the user's corrections.
 *
 * Units: the template's canonical chest half-width (0.44) is the anchor —
 * every photo ratio is multiplied by the canonical torso width (0.88). These
 * are RELATIVE template units; without a scale source they are not cm.
 */
import type { GarmentParams, Landmark, ScaleSource, Sourced } from '../domain/types';
import { clampTShirtParams, defaultTShirtParams, TSHIRT_PARAM_LIMITS, TSHIRT_TEMPLATE_ID, TSHIRT_TEMPLATE_VERSION, TSHIRT_TOPOLOGY_VERSION, type TShirtParams } from '../templates/tshirt/params';
import { CATEGORY_TEMPLATE } from '../templates/registry';
import type { GarmentCategory } from '../domain/types';
import { tshirtRatios, type TShirtLandmarkName } from './landmarks';

export const CANONICAL_TORSO_WIDTH = 2 * TSHIRT_PARAM_LIMITS.chestHalfWidth.default; // 0.88

export interface ParamLayers {
  templateId: string;
  templateVersion: string;
  topologyVersion: string;
  /** raw photo-derived values (may be outside limits) */
  estimated: Partial<TShirtParams>;
  /** what the template accepted; `clamped` lists every change with reason */
  applied: TShirtParams;
  clamped: { name: keyof TShirtParams; requested: number; applied: number }[];
  /** slider overrides */
  user: Partial<TShirtParams>;
  /** final values used to build the mesh */
  resolved: TShirtParams;
  /** photo ratios behind the estimate (for display) */
  ratios: ReturnType<typeof tshirtRatios>;
  scale: ScaleSource;
  note: string;
}

export function selectTemplate(category: GarmentCategory): { templateId: string; templateVersion: string; topologyVersion: string } | null {
  const id = CATEGORY_TEMPLATE[category];
  if (!id) return null;
  if (id !== TSHIRT_TEMPLATE_ID) return null;
  return { templateId: TSHIRT_TEMPLATE_ID, templateVersion: TSHIRT_TEMPLATE_VERSION, topologyVersion: TSHIRT_TOPOLOGY_VERSION };
}

/** Photo landmarks (image space, front view) -> estimated template params (relative units). */
export function estimateParams(points: Record<TShirtLandmarkName, Landmark>): { estimated: Partial<TShirtParams>; ratios: ReturnType<typeof tshirtRatios> } {
  const r = tshirtRatios(points);
  const U = CANONICAL_TORSO_WIDTH;
  const estimated: Partial<TShirtParams> = {
    chestHalfWidth: U / 2, // the anchor by definition
    length: r.length * U,
    hemHalfWidth: (r.hemWidth * U) / 2,
    shoulderHalfWidth: (r.shoulderWidth * U) / 2,
    armholeDepth: r.armholeDepth * U,
    sleeveLength: r.sleeveLength * U,
    cuffRadius: (r.cuffWidth * U) / 2,
    sleeveAngle: r.sleeveAngle,
    neckHalfWidth: (r.neckWidth * U) / 2,
    neckFrontDrop: Math.max(0, r.neckDepth * U),
  };
  // depthRatio, neckBackDrop, collarWidth, shoulderSlope are NOT visible in a front photo: template defaults
  return { estimated, ratios: r };
}

export function resolveParams(estimated: Partial<TShirtParams>, user: Partial<TShirtParams>, scale: ScaleSource = { kind: 'none' }, ratios?: ReturnType<typeof tshirtRatios>): ParamLayers {
  const { params: applied, clamped } = clampTShirtParams(estimated);
  const merged = clampTShirtParams({ ...applied, ...user });
  const d = defaultTShirtParams();
  const unseen = ['depthRatio', 'neckBackDrop', 'collarWidth', 'shoulderSlope'] as const;
  return {
    templateId: TSHIRT_TEMPLATE_ID,
    templateVersion: TSHIRT_TEMPLATE_VERSION,
    topologyVersion: TSHIRT_TOPOLOGY_VERSION,
    estimated,
    applied,
    clamped,
    user,
    resolved: merged.params,
    ratios: ratios ?? ({} as ReturnType<typeof tshirtRatios>),
    scale,
    note: `Относительные единицы шаблона (ширина груди = ${CANONICAL_TORSO_WIDTH}); масштаба нет — это не сантиметры. Не видны на фронтальном фото и взяты из шаблона: ${unseen.map((k) => `${k}=${d[k]}`).join(', ')}.`,
  };
}

/** GarmentRecord.params with per-value provenance. */
export function toGarmentParams(layers: ParamLayers): GarmentParams {
  const out: GarmentParams = {};
  const d = defaultTShirtParams();
  for (const k of Object.keys(layers.resolved) as (keyof TShirtParams)[]) {
    const v = layers.resolved[k];
    let src: Sourced<number>['source'] = 'default';
    let note: string | undefined;
    if (k in layers.user) src = 'user_adjusted';
    else if (k in layers.estimated) {
      src = 'estimated';
      const c = layers.clamped.find((x) => x.name === k);
      if (c) note = `оценка ${c.requested.toFixed(3)} ограничена шаблоном до ${c.applied.toFixed(3)}`;
    }
    const s: Sourced<number> = { value: v, source: src };
    if (note) s.note = note;
    if (src === 'default') s.note = `шаблон по умолчанию ${d[k]}`;
    out[k] = s;
  }
  return out;
}
