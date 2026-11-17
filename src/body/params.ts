/**
 * M01 — body (mannequin) parameters.
 *
 * Units: METRES, real human scale (the garment template canon is matched to
 * the body later, in fitting, by a single scale). Two base proportion sets
 * (male / female) share one topology; every number here is a parameter with
 * explicit limits, not a hidden constant. Defaults follow the classical
 * artistic-anatomy canon (height ≈ 7.5 heads, biacromial ≈ 1/4 of height,
 * leg ≈ 0.47 of height …) and typical adult anthropometry — they are
 * PLAUSIBLE PROPORTIONS, never measurements of a real person.
 *
 * Anatomical consistency rules (`clampBodyParams`) keep slider combinations
 * possible for a human body and report every adjustment, like the T-shirt
 * template does (estimated / applied / clamped).
 */

export type BodySex = 'male' | 'female';

export const BODY_TEMPLATE_ID = 'body-basic';
export const BODY_TEMPLATE_VERSION = '0.1.0';
export const BODY_TOPOLOGY_VERSION = 'body-basic-topo-1';

export interface BodyParams {
  /** 0 = male base proportions, 1 = female. Discrete. */
  sex: number;
  /** Stature, metres (floor → top of head). */
  height: number;
  /** height / head height (classical canon 7.5; 8 = "heroic", 7 = short). */
  headRatio: number;
  /** Biacromial (shoulder-to-shoulder) width, metres. */
  shoulderWidth: number;
  /** Shoulder slope from neck base to acromion, radians. */
  shoulderSlope: number;
  /** Circumferences, metres. */
  neckCirc: number;
  chestCirc: number;
  waistCirc: number;
  hipCirc: number;
  upperArmCirc: number;
  forearmCirc: number;
  wristCirc: number;
  thighCirc: number;
  calfCirc: number;
  ankleCirc: number;
  /** Forward bust prominence beyond the chest ellipse, metres (0 for flat). */
  bust: number;
  /** Ratios of height. */
  legRatio: number; // crotch height / height
  torsoRatio: number; // neck base − crotch / height
  armRatio: number; // shoulder joint → wrist / height
  /** Depth / width of torso cross-sections (1 = round). */
  torsoDepthRatio: number;
  /** Arm abduction in the neutral pose, radians (A-pose). */
  armAbduction: number;
}

export type BodyParamName = keyof BodyParams;

export interface BodyParamLimit {
  min: number;
  max: number;
  default: Record<BodySex, number>;
  label: string;
  unit: 'm' | 'rad' | 'ratio' | 'enum';
  step?: number;
}

export const BODY_PARAM_LIMITS: Record<BodyParamName, BodyParamLimit> = {
  sex: { min: 0, max: 1, default: { male: 0, female: 1 }, label: 'Базовые пропорции (0 муж / 1 жен)', unit: 'enum', step: 1 },
  height: { min: 1.4, max: 2.1, default: { male: 1.75, female: 1.63 }, label: 'Рост', unit: 'm' },
  headRatio: { min: 6.8, max: 8.5, default: { male: 7.5, female: 7.3 }, label: 'Рост в головах', unit: 'ratio' },
  shoulderWidth: { min: 0.3, max: 0.56, default: { male: 0.41, female: 0.36 }, label: 'Ширина плеч (акромион–акромион)', unit: 'm' },
  shoulderSlope: { min: 0.17, max: 0.52, default: { male: 0.36, female: 0.38 }, label: 'Наклон плеч', unit: 'rad' },
  neckCirc: { min: 0.28, max: 0.5, default: { male: 0.39, female: 0.33 }, label: 'Обхват шеи', unit: 'm' },
  chestCirc: { min: 0.7, max: 1.45, default: { male: 0.98, female: 0.88 }, label: 'Обхват груди', unit: 'm' },
  waistCirc: { min: 0.55, max: 1.4, default: { male: 0.84, female: 0.72 }, label: 'Обхват талии', unit: 'm' },
  hipCirc: { min: 0.72, max: 1.5, default: { male: 0.97, female: 0.98 }, label: 'Обхват бёдер', unit: 'm' },
  upperArmCirc: { min: 0.2, max: 0.45, default: { male: 0.31, female: 0.27 }, label: 'Обхват плеча (руки)', unit: 'm' },
  forearmCirc: { min: 0.18, max: 0.36, default: { male: 0.27, female: 0.23 }, label: 'Обхват предплечья', unit: 'm' },
  wristCirc: { min: 0.13, max: 0.22, default: { male: 0.17, female: 0.15 }, label: 'Обхват запястья', unit: 'm' },
  thighCirc: { min: 0.38, max: 0.8, default: { male: 0.56, female: 0.57 }, label: 'Обхват бедра (ноги)', unit: 'm' },
  calfCirc: { min: 0.26, max: 0.5, default: { male: 0.37, female: 0.36 }, label: 'Обхват голени', unit: 'm' },
  ankleCirc: { min: 0.17, max: 0.3, default: { male: 0.23, female: 0.21 }, label: 'Обхват щиколотки', unit: 'm' },
  bust: { min: 0, max: 0.09, default: { male: 0, female: 0.035 }, label: 'Выступ груди', unit: 'm' },
  legRatio: { min: 0.42, max: 0.51, default: { male: 0.47, female: 0.465 }, label: 'Длина ног / рост', unit: 'ratio' },
  torsoRatio: { min: 0.29, max: 0.37, default: { male: 0.34, female: 0.335 }, label: 'Длина торса / рост', unit: 'ratio' },
  armRatio: { min: 0.29, max: 0.37, default: { male: 0.33, female: 0.325 }, label: 'Длина руки / рост', unit: 'ratio' },
  torsoDepthRatio: { min: 0.55, max: 0.95, default: { male: 0.72, female: 0.7 }, label: 'Глубина торса / ширина', unit: 'ratio' },
  armAbduction: { min: 0.1, max: 0.6, default: { male: 0.36, female: 0.36 }, label: 'Отведение рук (A-поза)', unit: 'rad' },
};

export const BODY_PARAM_NAMES = Object.keys(BODY_PARAM_LIMITS) as BodyParamName[];

export function defaultBodyParams(sex: BodySex = 'male'): BodyParams {
  const out = {} as BodyParams;
  for (const n of BODY_PARAM_NAMES) out[n] = BODY_PARAM_LIMITS[n].default[sex];
  return out;
}

export interface BodyPreset {
  id: string;
  label: string;
  sex: BodySex;
  params: Partial<BodyParams>;
}

/** Presets are PROPORTION presets (not sizes of a real person). */
export const BODY_PRESETS: BodyPreset[] = [
  { id: 'male-m', label: 'Муж · средний', sex: 'male', params: {} },
  { id: 'male-s', label: 'Муж · худой', sex: 'male', params: { height: 1.7, shoulderWidth: 0.38, chestCirc: 0.88, waistCirc: 0.74, hipCirc: 0.9, upperArmCirc: 0.27, thighCirc: 0.5, calfCirc: 0.34 } },
  { id: 'male-l', label: 'Муж · крупный', sex: 'male', params: { height: 1.82, shoulderWidth: 0.45, chestCirc: 1.12, waistCirc: 1.0, hipCirc: 1.08, upperArmCirc: 0.36, forearmCirc: 0.3, thighCirc: 0.64, calfCirc: 0.41, neckCirc: 0.42 } },
  { id: 'female-m', label: 'Жен · средняя', sex: 'female', params: {} },
  { id: 'female-s', label: 'Жен · худая', sex: 'female', params: { height: 1.6, shoulderWidth: 0.34, chestCirc: 0.8, waistCirc: 0.64, hipCirc: 0.9, thighCirc: 0.52, bust: 0.025 } },
  { id: 'female-l', label: 'Жен · крупная', sex: 'female', params: { height: 1.68, shoulderWidth: 0.39, chestCirc: 1.02, waistCirc: 0.88, hipCirc: 1.12, upperArmCirc: 0.32, thighCirc: 0.66, calfCirc: 0.4, bust: 0.05 } },
];

export interface ClampNote {
  name: BodyParamName;
  from: number;
  to: number;
  reason: string;
}

export interface ClampedBodyParams {
  params: BodyParams;
  clamped: ClampNote[];
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Hard limits + anatomical consistency rules. Rules only tighten; every change
 * is reported so the UI can show "принято: X (было Y) — причина".
 */
export function clampBodyParams(partial: Partial<BodyParams>, base?: BodyParams): ClampedBodyParams {
  const sexIdx = partial.sex ?? base?.sex ?? 0;
  const sex: BodySex = sexIdx >= 0.5 ? 'female' : 'male';
  const p: BodyParams = { ...(base ?? defaultBodyParams(sex)), ...partial };
  const clamped: ClampNote[] = [];
  const set = (name: BodyParamName, to: number, reason: string) => {
    if (Math.abs(p[name] - to) < 1e-9) return;
    clamped.push({ name, from: p[name], to, reason });
    p[name] = to;
  };
  // 1. hard limits
  for (const n of BODY_PARAM_NAMES) {
    const L = BODY_PARAM_LIMITS[n];
    const v = Number.isFinite(p[n]) ? p[n] : L.default[sex];
    const c = clamp(v, L.min, L.max);
    if (c !== p[n]) set(n, c, `лимит ${L.min}…${L.max}`);
  }
  set('sex', p.sex >= 0.5 ? 1 : 0, 'дискретный параметр');
  // 2. segment lengths must leave room for head + neck: head = H/headRatio; neck ≈ 0.4 head; torso + legs + head + neck ≤ H
  {
    const head = p.height / p.headRatio;
    const neck = 0.3 * head;
    const maxLegTorso = (p.height - head - neck) / p.height; // ≈ 0.81 at 7.5 heads
    if (p.legRatio + p.torsoRatio > maxLegTorso) {
      // reduce torso first (legs are what people set deliberately), then legs
      const torso = Math.max(BODY_PARAM_LIMITS.torsoRatio.min, maxLegTorso - p.legRatio);
      set('torsoRatio', torso, 'ноги + торс + шея + голова не длиннее роста');
      if (p.legRatio + p.torsoRatio > maxLegTorso + 1e-9) set('legRatio', maxLegTorso - p.torsoRatio, 'ноги + торс + шея + голова не длиннее роста');
    }
  }
  // 3. waist narrower than chest and hips; hips not wider than ... (allowed any)
  if (p.waistCirc > p.chestCirc * 0.98) set('waistCirc', p.chestCirc * 0.98, 'талия не шире груди');
  if (p.waistCirc > p.hipCirc * 0.98) set('waistCirc', p.hipCirc * 0.98, 'талия не шире бёдер');
  // 4. shoulders at least as wide as the chest ellipse + arm joints (acromion sits outside the ribcage)
  {
    const chestHalf = ellipseHalfWidth(p.chestCirc, p.torsoDepthRatio);
    const minShoulder = 2 * chestHalf * 0.95 + 0.04;
    if (p.shoulderWidth < minShoulder) set('shoulderWidth', Math.min(BODY_PARAM_LIMITS.shoulderWidth.max, minShoulder), 'плечи не уже грудной клетки');
  }
  // 4a. the acromion stays well above the armpit line: shoulder drop ≤ 0.12·T
  {
    const T = p.torsoRatio * p.height;
    const neckR = p.neckCirc / (2 * Math.PI);
    const half = Math.max(0.02, p.shoulderWidth / 2 - neckR);
    const maxSlope = Math.atan((0.12 * T) / half);
    if (p.shoulderSlope > maxSlope) set('shoulderSlope', Math.max(BODY_PARAM_LIMITS.shoulderSlope.min, maxSlope), 'плечо не опускается ниже линии подмышки');
  }
  // 4b. the hanging arm must clear the torso at every ring (chest, underbust, waist, hip): the arm axis
  //     x(y) = sw/2 + sin(abd)·(yShoulder − y), radius interpolated along the arm. Resolution order:
  //     more abduction → wider shoulders → thinner arm → narrower torso ring. Every step is reported.
  for (let iter = 0; iter < 6; iter++) {
    const d = armClearanceDeficit(p);
    if (!d) break;
    const L = BODY_PARAM_LIMITS;
    if (p.armAbduction < L.armAbduction.max - 1e-6) {
      // solve sin(abd) for the worst ring
      const abd = Math.asin(Math.min(1, Math.max(0, (d.need - p.shoulderWidth / 2) / Math.max(0.01, d.dy))));
      set('armAbduction', Math.min(L.armAbduction.max, Math.max(p.armAbduction, abd + 1e-4)), `рука не входит в торс на уровне «${d.ring}» (отведение увеличено)`);
    } else if (p.shoulderWidth < L.shoulderWidth.max - 1e-6) {
      set('shoulderWidth', Math.min(L.shoulderWidth.max, 2 * (d.need - Math.sin(p.armAbduction) * d.dy) + 1e-4), `рука не входит в торс на уровне «${d.ring}» (плечи шире)`);
    } else if (d.ring === 'chest' || d.ring === 'underbust') {
      if (p.upperArmCirc > L.upperArmCirc.min + 1e-6) {
        set('upperArmCirc', Math.max(L.upperArmCirc.min, p.upperArmCirc - d.deficit * 2 * Math.PI * Math.cos(L.armAbduction.max)), `рука не входит в торс на уровне «${d.ring}» (рука тоньше)`);
        if (p.forearmCirc > p.upperArmCirc) set('forearmCirc', p.upperArmCirc, 'предплечье не толще плеча');
      } else {
        set('chestCirc', Math.max(L.chestCirc.min, p.chestCirc - d.deficit * ellipsePerimeter(1, p.torsoDepthRatio)), 'грудная клетка не шире, чем позволяют плечи');
        if (p.waistCirc > p.chestCirc * 0.98) set('waistCirc', p.chestCirc * 0.98, 'талия не шире груди');
      }
    } else if (d.ring === 'waist') {
      set('waistCirc', Math.max(L.waistCirc.min, p.waistCirc - d.deficit * ellipsePerimeter(1, p.torsoDepthRatio * 1.08)), 'талия не шире, чем позволяет рука');
    } else {
      set('hipCirc', Math.max(L.hipCirc.min, p.hipCirc - d.deficit * ellipsePerimeter(1, p.torsoDepthRatio)), 'бёдра не шире, чем позволяет свисающая рука');
      if (p.waistCirc > p.hipCirc * 0.98) set('waistCirc', p.hipCirc * 0.98, 'талия не шире бёдер');
    }
  }
  // 5. neck thinner than chest ellipse width
  {
    const chestHalf = ellipseHalfWidth(p.chestCirc, p.torsoDepthRatio);
    const neckR = p.neckCirc / (2 * Math.PI);
    if (neckR > chestHalf * 0.55) set('neckCirc', chestHalf * 0.55 * 2 * Math.PI, 'шея не шире половины грудной клетки');
  }
  // 6. limb tapering: wrist < forearm < upper arm; ankle < calf < thigh
  if (p.forearmCirc > p.upperArmCirc) set('forearmCirc', p.upperArmCirc, 'предплечье не толще плеча');
  if (p.wristCirc > p.forearmCirc * 0.8) set('wristCirc', p.forearmCirc * 0.8, 'запястье тоньше предплечья');
  if (p.calfCirc > p.thighCirc * 0.85) set('calfCirc', p.thighCirc * 0.85, 'голень тоньше бедра');
  if (p.ankleCirc > p.calfCirc * 0.75) set('ankleCirc', p.calfCirc * 0.75, 'щиколотка тоньше голени');
  // 7. two thighs must fit under the hips
  {
    const hipHalf = ellipseHalfWidth(p.hipCirc, p.torsoDepthRatio);
    const thighR = p.thighCirc / (2 * Math.PI);
    if (thighR * 2 > hipHalf * 1.05) set('thighCirc', hipHalf * 1.05 * Math.PI, 'два бедра помещаются под тазом');
  }
  // 7b. calves must not touch each other: leg axes sit at ≈ 0.44·hipHalf from the centre at the calf
  {
    const hipHalf = ellipseHalfWidth(p.hipCirc, p.torsoDepthRatio);
    const maxCalfR = hipHalf * 0.44 - 0.002;
    if (p.calfCirc / (2 * Math.PI) > maxCalfR) set('calfCirc', Math.max(BODY_PARAM_LIMITS.calfCirc.min, maxCalfR * 2 * Math.PI), 'голени не соприкасаются');
    if (p.ankleCirc > p.calfCirc * 0.75) set('ankleCirc', p.calfCirc * 0.75, 'щиколотка тоньше голени');
  }
  // 8. bust only adds forward; cap relative to chest depth
  {
    const chestHalf = ellipseHalfWidth(p.chestCirc, p.torsoDepthRatio);
    if (p.bust > chestHalf * p.torsoDepthRatio * 0.5) set('bust', chestHalf * p.torsoDepthRatio * 0.5, 'выступ груди не больше половины глубины грудной клетки');
  }
  // merge repeated notes for the same parameter (iterative rules): keep the original `from`, the final `to`
  const merged: ClampNote[] = [];
  for (const c of clamped) {
    const prev = merged.find((m) => m.name === c.name);
    if (prev) {
      prev.to = c.to;
      prev.reason = c.reason;
    } else merged.push({ ...c });
  }
  return { params: p, clamped: merged.filter((c) => Math.abs(c.from - c.to) > 1e-9) };
}

/**
 * Worst clearance deficit between the hanging arm and the torso rings (null = clear).
 * Mirrors the ring layout in anatomy.ts (fractions of torso length T).
 */
export function armClearanceDeficit(p: BodyParams): { ring: string; need: number; dy: number; deficit: number } | null {
  const T = p.torsoRatio * p.height;
  const neckR = p.neckCirc / (2 * Math.PI);
  const drop = Math.tan(p.shoulderSlope) * Math.max(0.02, p.shoulderWidth / 2 - neckR);
  const upperArmR = p.upperArmCirc / (2 * Math.PI);
  const yShoulder = -drop - upperArmR * 0.6; // relative to neck base (arm root sits 0.6·r below the acromion, see anatomy.ts)
  const armLen = p.armRatio * p.height;
  const upper = armLen * 0.56;
  const forearmR = p.forearmCirc / (2 * Math.PI);
  const wristR = p.wristCirc / (2 * Math.PI);
  const dr = p.torsoDepthRatio;
  const rings: [string, number, number][] = [
    ['chest', -0.3 * T, ellipseHalfWidth(p.chestCirc, dr)],
    ['underbust', -0.4 * T, ellipseHalfWidth((p.chestCirc + p.waistCirc) / 2, dr * 1.02)],
    ['waist', -0.55 * T, ellipseHalfWidth(p.waistCirc, dr * 1.08)],
    ['hip', -T + 0.15 * T, ellipseHalfWidth(p.hipCirc, dr)],
  ];
  // up to 1 cm of the upper arm may sink into the ribcage ellipse: the real lateral chest is flatter than an ellipse
  const ALLOWED_OVERLAP = 0.01;
  const cosMax = Math.cos(p.armAbduction);
  let worst: ReturnType<typeof armClearanceDeficit> = null;
  for (const [name, y, half] of rings) {
    const dy = Math.max(0, yShoulder - y); // distance below the shoulder joint along the arm (0 = joint sphere itself)
    const along = dy / Math.cos(p.armAbduction);
    if (along > armLen) continue; // ring below the wrist — hands clear
    // radius profile mirrors anatomy.ts: upper arm constant, forearm full to 30 % of its length, then taper to the wrist
    const fore = armLen - upper;
    const r = along <= upper ? upperArmR : along <= upper + 0.3 * fore ? forearmR : forearmR + ((wristR - forearmR) * (along - upper - 0.3 * fore)) / (0.7 * fore);
    const need = half + r / cosMax - ALLOWED_OVERLAP;
    const axisX = p.shoulderWidth / 2 + Math.sin(p.armAbduction) * dy;
    const deficit = need - axisX;
    if (deficit > 0 && (!worst || deficit > worst.deficit)) worst = { ring: name, need, dy, deficit };
  }
  return worst;
}

/** Ramanujan perimeter approximation of an ellipse with half-axes a, b. */
export function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Half-width a of an ellipse with perimeter `circ` and depth ratio b/a = r (b = r·a). */
export function ellipseHalfWidth(circ: number, r: number): number {
  // perimeter is linear in a for fixed r
  const p1 = ellipsePerimeter(1, r);
  return circ / p1;
}

export function bodySex(p: BodyParams): BodySex {
  return p.sex >= 0.5 ? 'female' : 'male';
}
