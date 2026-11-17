/**
 * Stage I-07 — bridge from the imported body to the garment module.
 *
 * The fitter (`src/fitting/fitTShirt.ts`) asks a body for an analytic `BodyFrame`: key heights, torso ellipses,
 * limb axes. The imported mesh has none of that, so every field is MEASURED from the mesh by slicing — not
 * copied from the procedural body and not guessed. The frame is built on the POSED body (arms down): in a
 * T-pose a horizontal slice at shoulder height runs along the arms and no torso ellipse exists there.
 *
 * Nothing here changes the garment module; it only implements the shape of data the module already expects.
 */
import { sliceContours, type Contour } from './geom/measure';
import type { BodyFrame, Ellipse, LimbAxis, LimbJoint, TorsoRingName } from '../body-types';
import type { BodyAsset } from './asset';
import { buildSkeleton, type BoneDef } from './rig';

const TAU = Math.PI * 2;

function contoursAt(p: Float32Array, idx: Uint32Array, y: number): Contour[] {
  try {
    return sliceContours(p, idx, y);
  } catch {
    return [];
  }
}
function centroidX(c: Contour): number {
  let s = 0;
  for (const q of c.points) s += q[0];
  return s / c.points.length;
}
function extent(c: Contour) {
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const q of c.points) {
    xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]);
    zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1]);
  }
  return { a: (xmax - xmin) / 2, b: (zmax - zmin) / 2, cx: (xmin + xmax) / 2, cz: (zmin + zmax) / 2 };
}
/** the contour that contains the body axis — the torso, not a limb */
function torsoAt(p: Float32Array, idx: Uint32Array, y: number): Ellipse | null {
  const cs = contoursAt(p, idx, y);
  if (!cs.length) return null;
  const c = cs.reduce((best, cur) => (Math.abs(centroidX(cur)) < Math.abs(centroidX(best)) ? cur : best));
  const e = extent(c);
  return { y, cx: e.cx, cz: e.cz, a: e.a, b: e.b, bulge: 0 };
}
/** radius of the limb contour on one side at this height (perimeter/2π); null when no limb is cut there */
function limbRadiusAt(p: Float32Array, idx: Uint32Array, y: number, side: 1 | -1, axisX: number): { r: number; x: number } | null {
  const cs = contoursAt(p, idx, y).filter((c) => Math.sign(centroidX(c)) === side && Math.abs(centroidX(c)) > Math.abs(axisX) * 0.35);
  if (!cs.length) return null;
  const c = cs.reduce((best, cur) => (Math.abs(centroidX(cur) - axisX) < Math.abs(centroidX(best) - axisX) ? cur : best));
  return { r: c.perimeter / TAU, x: centroidX(c) };
}

export interface ImportedFrameInfo {
  frame: BodyFrame;
  bones: BoneDef[];
  /** fields that could not be measured and fall back to a documented default */
  assumed: string[];
}

export function frameFromImported(asset: BodyAsset, posed: Float32Array): ImportedFrameInfo {
  const idx = asset.index;
  const n = posed.length / 3;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) maxY = Math.max(maxY, posed[i * 3 + 1]!);
  const L = asset.landmarks;
  const k = maxY / L.height;
  const assumed: string[] = [];
  const bones = buildSkeleton(asset, posed);
  const bone = (nm: string) => bones.find((b) => b.name === nm)!;

  // neck: above the shoulders the torso contour is narrowest at the neck
  const shoulderY = L.neck_base * k;
  let neckY = shoulderY, neckR = 0.05, best = Infinity;
  for (let y = shoulderY; y < shoulderY + (maxY - shoulderY) * 0.6; y += 0.005) {
    const e = torsoAt(posed, idx, y);
    if (!e) continue;
    const r = (e.a + e.b) / 2;
    // a sliver contour (an ear, a chin edge) is not the neck: below 2 cm it is not a torso cross-section
    if (r < 0.02) continue;
    if (r < best) { best = r; neckY = y; neckR = r; }
  }
  const headTop = maxY;
  const chin = neckY + (headTop - neckY) * 0.22;
  const heights: BodyFrame['heights'] = {
    floor: 0,
    ankle: bone('foot_left').head[1],
    knee: bone('shin_left').head[1],
    crotch: L.crotch * k,
    hip: L.hip * k,
    waist: L.waist * k,
    underbust: L.waist * k + (L.chest - L.waist) * k * 0.45,
    chest: L.chest * k,
    armpit: L.armpit * k,
    shoulder: shoulderY,
    neck_base: neckY,
    chin,
    head_top: headTop,
  };
  const ringY: Record<TorsoRingName, number> = {
    crotch: heights.crotch,
    hip: heights.hip,
    waist: heights.waist,
    underbust: heights.underbust,
    chest: heights.chest,
    armpit: heights.armpit,
    deltoid: heights.armpit + (shoulderY - heights.armpit) * 0.5,
    shoulder: shoulderY,
    neck_base: neckY,
  };
  const torso = {} as Record<TorsoRingName, Ellipse>;
  for (const [name, y] of Object.entries(ringY) as [TorsoRingName, number][]) {
    const e = torsoAt(posed, idx, y - 1e-4);
    if (!e) {
      assumed.push(`torso.${name}`);
      torso[name] = { y, cx: 0, cz: 0, a: 0.15, b: 0.1, bulge: 0 };
      continue;
    }
    // the shoulder and deltoid rings span the DELTOIDS: a garment's shoulder seam goes over them, not over the
    // narrow slice of trapezius the torso contour alone gives at that height (it read 13 cm "loose" before)
    if (name === 'shoulder' || name === 'deltoid') {
      let wide = e.a;
      for (const c of contoursAt(posed, idx, y - 1e-4)) for (const q of c.points) wide = Math.max(wide, Math.abs(q[0] - e.cx));
      e.a = wide;
    }
    torso[name] = e;
  }
  /**
   * Arm axis measured on the POSED mesh, not laid out from the skeleton: with the arms down the axis runs
   * downward, and a garment whose sleeves are re-centred on a horizontal T-pose axis ends up sticking out
   * sideways (seen in the first dressed render).
   */
  const armAxis = (side: 'left' | 'right'): LimbAxis => {
    const sgn = (side === 'left' ? 1 : -1) as 1 | -1;
    const samples: { y: number; x: number; z: number; r: number }[] = [];
    const top = heights.armpit + (shoulderY - heights.armpit) * 0.35;
    for (let y = top; y > heights.crotch * 0.75; y -= 0.01) {
      const cs = contoursAt(posed, idx, y).filter((c) => Math.sign(centroidX(c)) === sgn);
      if (cs.length < 2 && y < shoulderY) {
        // only one contour on this side: it is the torso unless it sits clearly outside the body axis
        const only = cs[0];
        if (!only || Math.abs(centroidX(only)) < torso.chest.a * 0.75) continue;
      }
      const arm = cs.reduce((best, cur) => (Math.abs(centroidX(cur)) > Math.abs(centroidX(best)) ? cur : best));
      if (Math.abs(centroidX(arm)) < torso.chest.a * 0.55) continue;
      const e = extent(arm);
      samples.push({ y, x: e.cx, z: e.cz, r: arm.perimeter / TAU });
    }
    if (samples.length < 3) {
      assumed.push(`arm_${side} axis (not enough slices; skeleton layout used)`);
      const chain = ['upper_arm', 'forearm', 'hand'].map((nm) => bone(`${nm}_${side}`));
      return { side: side as LimbAxis['side'], joints: chain.map((b) => ({ pos: [...b.head] as [number, number, number], r: 0.04 })) };
    }
    // the last samples are the fingers, whose contour radius collapses; the wrist joint is taken before them
    while (samples.length > 3 && samples[samples.length - 1]!.r < 0.02) samples.pop();
    const pick = (t: number) => samples[Math.min(samples.length - 1, Math.round(t * (samples.length - 1)))]!;
    return {
      side: side as LimbAxis['side'],
      joints: [0, 0.5, 0.95].map((t) => {
        const q = pick(t);
        return { pos: [q.x, q.y, q.z] as [number, number, number], r: q.r };
      }),
    };
  };
  // legs: joints from the skeleton, radii measured at each joint height on the posed mesh
  const limb = (side: 'left' | 'right', chain: string[], fallback: number): LimbAxis => {
    const s = side === 'left' ? 1 : -1;
    const joints: LimbJoint[] = chain.map((nm) => {
      const b = bone(`${nm}_${side}`);
      const m = limbRadiusAt(posed, idx, b.head[1], s as 1 | -1, b.head[0]);
      if (!m) assumed.push(`${nm}_${side}.r`);
      return { pos: [m ? m.x : b.head[0], b.head[1], b.head[2]] as [number, number, number], r: m ? m.r : fallback };
    });
    return { side: side as LimbAxis['side'], joints };
  };
  // the arm chain is sampled at the shoulder, elbow and wrist of the POSED skeleton
  const legChain = ['thigh', 'shin', 'foot'];
  const head = (() => {
    const e = torsoAt(posed, idx, (chin + headTop) / 2);
    return { h: headTop - chin, width: e ? e.a * 2 : 0.15, depth: e ? e.b * 2 : 0.19, cy: (chin + headTop) / 2, cz: e ? e.cz : 0 };
  })();
  const frame: BodyFrame = {
    // only the fields the fitter actually reads are filled, and they are MEASURED: the shoulder anchor divides
    // by params.shoulderWidth, and an undefined one silently produced a NaN scale
    params: { height: maxY, shoulderWidth: torso.shoulder.a * 2 } as BodyFrame['params'],
    heights,
    head,
    neck: { r: neckR, yBottom: shoulderY, yTop: chin },
    torso,
    arms: { left: armAxis('left'), right: armAxis('right') },
    legs: { left: limb('left', legChain, 0.07), right: limb('right', legChain, 0.07) },
    hand: { length: 0.1 * maxY, width: 0.05 * maxY, thick: 0.018 * maxY },
    foot: { length: 0.15 * maxY, width: 0.058 * maxY, height: 0.04 * maxY },
    headUnit: headTop - chin,
  };
  assumed.push('params (reference only — the imported body is not parameterised by BodyParams)', 'hand/foot box (proportional, not measured)');
  return { frame, bones, assumed };
}
