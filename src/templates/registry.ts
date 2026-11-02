/**
 * TemplateRegistry — which garment categories have a 3D template, with
 * versions and parameter limits. In the first vertical only the T-shirt is
 * registered; pants/skirt map to `null` on purpose so nothing routes them to
 * the T-shirt template by accident.
 */

import type { GarmentCategory } from '../domain/types';
import { buildTShirt, type TShirtMesh } from './tshirt/buildTShirt';
import { TSHIRT_PARAM_LIMITS, TSHIRT_TEMPLATE_ID, TSHIRT_TEMPLATE_VERSION, TSHIRT_TOPOLOGY_VERSION, type ParamLimit } from './tshirt/params';

export interface TemplateEntry {
  templateId: string;
  templateVersion: string;
  topologyVersion: string;
  category: GarmentCategory;
  paramLimits: Record<string, ParamLimit>;
  uvIslands: string[];
  /** Avatar adapters this template was verified against. 'test-chibi' only until the real body exists. */
  verifiedAgainstAvatars: string[];
  build: (params: Partial<Record<string, number>>) => TShirtMesh;
}

const TEMPLATES: TemplateEntry[] = [
  {
    templateId: TSHIRT_TEMPLATE_ID,
    templateVersion: TSHIRT_TEMPLATE_VERSION,
    topologyVersion: TSHIRT_TOPOLOGY_VERSION,
    category: 'tshirt',
    paramLimits: TSHIRT_PARAM_LIMITS,
    uvIslands: ['front', 'back', 'sleeve_left', 'sleeve_right', 'collar'],
    verifiedAgainstAvatars: [],
    build: (params) => buildTShirt(params),
  },
];

/** category -> template. Explicit nulls: these categories have NO template yet. */
export const CATEGORY_TEMPLATE: Record<GarmentCategory, string | null> = {
  tshirt: TSHIRT_TEMPLATE_ID,
  pants: null,
  skirt: null,
  other: null,
};

export function getTemplate(templateId: string): TemplateEntry | null {
  return TEMPLATES.find((t) => t.templateId === templateId) ?? null;
}

export function templateForCategory(category: GarmentCategory): TemplateEntry | null {
  const id = CATEGORY_TEMPLATE[category];
  return id ? getTemplate(id) : null;
}

export function listTemplates(): TemplateEntry[] {
  return TEMPLATES.slice();
}
