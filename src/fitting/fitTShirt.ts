/**
 * F01–F02 — fitting the T-shirt template onto the procedural body.
 *
 * Not physics. Three explicit steps, each recorded separately:
 *  1. ALIGN   one scale (metres per template unit) from ONE anchor (chest or
 *             shoulders) + translation (shoulder line onto the acromions).
 *             Photo proportions stay untouched.
 *  2. EASE    every torso ring is compared with the body cross-section at its
 *             height (+ ease). With `fitToBody` the template params are widened
 *             only where needed (`fitAdjust`, via the template's own clamp) —
 *             otherwise the garment is shown "as photographed" with statuses
 *             tight / ok / loose per ring.
 *  3. RESOLVE vertex-level push-out of whatever still sits inside the body
 *             (ellipse + ease for the torso, arm capsules for the sleeves) and
 *             re-centring of the sleeve rings on the arm axis. Done from the
 *             template positions every time — never accumulated.
 * `checks` (blocking in scripts/check-fit.ts): no garment vertex inside the
 * body, the arm axis stays inside the sleeve tube.
 */
import * as THREE from 'three';
import { capsuleSignedDistance, ellipsePoint, torsoCrossSection, type BodyFrame, type Capsule } from '../body/anatomy';
import { bodyCapsules } from '../body/anatomy';
import type { WearerSide } from '../domain/sides';
import { clampTShirtParams, type TShirtParams } from '../templates/tshirt/params';
import { buildTShirt, gridId, M, SLEEVE_N, SLEEVE_RINGS, sleeveId, type TShirtMesh } from '../templates/tshirt/buildTShirt';
import { NECK_ROW, gridPosition } from '../templates/tshirt/rows';
import type { CheckResult } from '../templates/checks';

export type FitAnchor = 'chest' | 'shoulder';

/** Ease (metres of clearance between body surface and garment), per garment zone. Layer 1 (a tee on skin). */
export interface EaseTable {
  chest: number;
  waist: number;
  hem: number;
  shoulder: number;
  sleeve: number;
}
export const DEFAULT_EASE: EaseTable = { chest: 0.03, waist: 0.035, hem: 0.035, shoulder: 0.008, sleeve: 0.015 };

export interface FitOptions {
  anchor: FitAnchor;
  ease: EaseTable;
  /** widen template params where the body needs it (recorded as fitAdjust); false = "as photographed" */
  fitToBody: boolean;
  /** fabric thickness lifting the shoulder line above the acromion */
  shoulderLift: number;
}
export const DEFAULT_FIT_OPTIONS: FitOptions = { anchor: 'chest', ease: DEFAULT_EASE, fitToBody: true, shoulderLift: 0.012 };

export type RingFitStatus = 'tight' | 'ok' | 'loose' | 'free';
export interface RingFit {
  ring: string;
  y: number;
  /** minimal clearance garment − body along the ring (metres); null when no body at that height */
  clearance: number | null;
  ease: number;
  status: RingFitStatus;
}

export interface FitAdjustNote {
  name: keyof TShirtParams;
  from: number;
  to: number;
  reason: string;
}

export interface FitResult {
  bodyId: string;
  anchor: FitAnchor;
  scale: number;
  offset: [number, number, number];
  /** params actually built (resolved + fitAdjust when fitToBody) */
  params: TShirtParams;
  fitAdjust: FitAdjustNote[];
  /** world-space positions for the template mesh (same vertex order as buildTShirt) */
  positions: Float32Array;
  pushedVertices: number;
  maxPush: number;
  rings: RingFit[];
  checks: CheckResult[];
  ok: boolean;
  status: 'ok' | 'tight' | 'intersects';
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** radius of the body cross-section at height y in direction θ (about the ellipse centre) with bust bulge; null = no torso there */
function bodyRadiusAt(frame: BodyFrame, y: number, theta: number): { c: [number, number]; r: number } | null {
  const e = torsoCrossSection(frame, y);
  if (!e) return null;
  const p = ellipsePoint(e, theta);
  return { c: [e.cx, e.cz], r: Math.hypot(p[0] - e.cx, p[2] - e.cz) };
}

export function fitTShirtToBody(resolved: TShirtParams, frame: BodyFrame, bodyId: string, opts: Partial<FitOptions> = {}): FitResult {
  const o: FitOptions = { ...DEFAULT_FIT_OPTIONS, ...opts, ease: { ...DEFAULT_EASE, ...(opts.ease ?? {}) } };
  const h = frame.heights;
  const chest = frame.torso.chest;
  const upperArmR = frame.arms.left.joints[0]!.r;

  // ---- 1. align -----------------------------------------------------------
  const scale = o.anchor === 'chest' ? (chest.a + o.ease.chest) / resolved.chestHalfWidth : (frame.params.shoulderWidth / 2 + o.ease.shoulder) / resolved.shoulderHalfWidth;
  // vertical: the garment's neck ring (back of row 6) sits on the body's neck base; the shoulder tips then
  // hover above the acromions by whatever the garment's own shoulder slope leaves (never pushed into the trapezius)
  const neckTopY = Math.max(...Array.from({ length: M }, (_, c) => gridPosition(resolved, NECK_ROW, c, { x: 0, y: 0, z: 0 }).y));
  const offset: [number, number, number] = [0, h.neck_base + o.shoulderLift - neckTopY * scale, chest.cz];
  const toWorld = (p: THREE.Vector3) => V(p.x * scale + offset[0], p.y * scale + offset[1], p.z * scale + offset[2]);

  // ---- 2. ease: required template params ---------------------------------
  const fitAdjust: FitAdjustNote[] = [];
  let params: TShirtParams = { ...resolved };
  if (o.fitToBody) {
    const want: Partial<Record<keyof TShirtParams, number>> = {};
    const note = (name: keyof TShirtParams, to: number, reason: string) => {
      if (to > params[name] + 1e-6) want[name] = Math.max(want[name] ?? 0, to);
      void reason;
    };
    // body widths at the garment rows (world y → template units)
    const rowY = (rowYTemplate: number) => rowYTemplate * scale + offset[1];
    const need = (y: number, ease: number): { a: number; b: number } | null => {
      const e = torsoCrossSection(frame, y);
      if (!e) return null;
      return { a: e.a + ease, b: e.b + e.bulge + ease };
    };
    const L = params.length,
      AD = params.armholeDepth;
    const rows = [
      { name: 'hemHalfWidth' as const, y: rowY(-L), ease: o.ease.hem },
      { name: 'chestHalfWidth' as const, y: rowY(-AD - 0.22 * (L - AD)), ease: o.ease.chest },
      { name: 'chestHalfWidth' as const, y: rowY(-AD), ease: o.ease.chest },
      { name: 'shoulderHalfWidth' as const, y: rowY(0), ease: o.ease.shoulder },
    ];
    let depthNeed = 0;
    for (const r of rows) {
      const n = need(r.y, r.ease);
      if (!n) continue;
      note(r.name, n.a / scale, `тело шире на уровне ${r.name}`);
      const aTemplate = Math.max(params[r.name], want[r.name] ?? 0);
      depthNeed = Math.max(depthNeed, n.b / scale / aTemplate);
    }
    // waist row (row 1) sits between hem and chest: its width is derived (mean) — covered by hem/chest.
    if (depthNeed > params.depthRatio + 1e-6) want.depthRatio = depthNeed;
    // sleeves: cuff must clear the arm where it ends
    const armR = frame.arms.left.joints[1]!.r;
    note('cuffRadius', (armR + o.ease.sleeve) / scale, 'рука толще манжеты');
    // sleeve tilt follows the hanging arm as far as the template allows (checked later by re-centring)
    const armTilt = Math.PI / 2 - frame.params.armAbduction; // below horizontal
    if (armTilt > params.sleeveAngle) want.sleeveAngle = armTilt;
    const { params: clamped } = clampTShirtParams({ ...params, ...want });
    for (const k of Object.keys(want) as (keyof TShirtParams)[]) {
      if (Math.abs(clamped[k] - params[k]) > 1e-6) fitAdjust.push({ name: k, from: params[k], to: clamped[k], reason: 'подгонка по телу (ease)' });
    }
    params = clamped;
  }

  // ---- 3. build + resolve ----------------------------------------------------
  const mesh: TShirtMesh = buildTShirt(params);
  const src = mesh.geometry.attributes.position!.array as Float32Array;
  const n = src.length / 3;
  const positions = new Float32Array(src.length);
  const logical = mesh.logicalIndex;
  for (let i = 0; i < n; i++) {
    const w = toWorld(V(src[i * 3]!, src[i * 3 + 1]!, src[i * 3 + 2]!));
    positions[i * 3] = w.x;
    positions[i * 3 + 1] = w.y;
    positions[i * 3 + 2] = w.z;
  }
  const caps = bodyCapsules(frame);
  const armCaps: Record<WearerSide, Capsule[]> = { left: caps.filter((c) => c.region === 'arm_left'), right: caps.filter((c) => c.region === 'arm_right') };
  // torso capsules are crude (round ends bulge above the shoulders); outside the torso band use only what is really there
  const neckHeadCaps = caps.filter((c) => c.region === 'neck' || c.region === 'head');
  const legCaps = caps.filter((c) => c.region.startsWith('leg'));
  const outsideTorsoDistance = (x: number, y: number, z: number) => capsuleSignedDistance(y > h.neck_base ? neckHeadCaps : legCaps, x, y, z);
  let pushed = 0,
    maxPush = 0;
  const get = (i: number) => V(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
  const set = (i: number, p: THREE.Vector3) => {
    const d = get(i).distanceTo(p);
    if (d > 1e-6) {
      pushed++;
      maxPush = Math.max(maxPush, d);
    }
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  };
  const sleeveVertex = (i: number): WearerSide | null => {
    const id = logical[i]!;
    if (id < (NECK_ROW + 2) * M) return null;
    return id < sleeveId('right', 1, 0) ? 'left' : 'right';
  };
  if (o.fitToBody) {
    // 3a. sleeves: re-centre rings 1..2 on the arm axis, keep their radius ≥ arm + ease
    for (const side of ['left', 'right'] as WearerSide[]) {
      const J = frame.arms[side].joints;
      const axisA = V(...J[0]!.pos),
        axisDir = V(...J[J.length - 1]!.pos).sub(axisA).normalize();
      const loop = mesh.rings.find((r) => r.name === `armhole_${side}`)!;
      const armholeCentre = new THREE.Vector3();
      const byLogical = new Map<number, number>();
      for (let i = 0; i < n; i++) if (!byLogical.has(logical[i]!)) byLogical.set(logical[i]!, i);
      for (const lid of loop.logical) armholeCentre.add(get(byLogical.get(lid)!));
      armholeCentre.multiplyScalar(1 / loop.logical.length);
      const tA = armholeCentre.clone().sub(axisA).dot(axisDir);
      for (let ring = 1; ring < SLEEVE_RINGS; ring++) {
        const ids: number[] = [];
        for (let i = 0; i < n; i++) {
          const id = logical[i]!;
          for (let m = 0; m < SLEEVE_N; m++) if (id === sleeveId(side, ring, m)) ids.push(i);
        }
        const c = new THREE.Vector3();
        for (const i of ids) c.add(get(i));
        c.multiplyScalar(1 / ids.length);
        const tRing = c.distanceTo(armholeCentre);
        const target = axisA.clone().addScaledVector(axisDir, tA + tRing);
        // arm radius at that point
        const armR = Math.max(...armCaps[side].map((cp) => cp.ra), 0);
        let radius = 0;
        for (const i of ids) radius += get(i).distanceTo(c);
        radius /= ids.length;
        const k = Math.max(1, (armR + o.ease.sleeve) / Math.max(1e-6, radius));
        for (const i of ids) {
          const p = get(i).sub(c).multiplyScalar(k).add(target);
          set(i, p);
        }
      }
    }
    // 3b. torso push-out against the body cross-section (+ease), sleeves against arm capsules
    for (let i = 0; i < n; i++) {
      const id = logical[i]!;
      const side = sleeveVertex(i);
      const p = get(i);
      if (side) {
        const d = capsuleSignedDistance(armCaps[side], p.x, p.y, p.z);
        if (d < o.ease.sleeve) {
          // move away from the nearest capsule axis point
          const J = frame.arms[side].joints;
          const a = V(...J[0]!.pos),
            dir = V(...J[J.length - 1]!.pos).sub(a).normalize();
          const t = p.clone().sub(a).dot(dir);
          const foot = a.clone().addScaledVector(dir, t);
          const out = p.clone().sub(foot);
          const len = out.length();
          if (len < 1e-6) continue;
          set(i, foot.add(out.multiplyScalar((len + (o.ease.sleeve - d)) / len)));
        }
        continue;
      }
      const row = Math.floor(id / M);
      const ease = row === 0 ? o.ease.hem : row === 1 ? o.ease.waist : row >= 5 ? o.ease.shoulder : o.ease.chest;
      const e = torsoCrossSection(frame, p.y);
      if (!e) {
        // above the torso: keep the neck opening / collar off the neck (radially from the neck axis)
        if (p.y <= h.neck_base) continue;
        const d = capsuleSignedDistance(neckHeadCaps, p.x, p.y, p.z);
        if (d < o.ease.shoulder) {
          const cx = 0,
            cz = -0.008;
          const rr = Math.hypot(p.x - cx, p.z - cz);
          if (rr < 1e-6) continue;
          const k = (rr + (o.ease.shoulder - d)) / rr;
          set(i, V(cx + (p.x - cx) * k, p.y, cz + (p.z - cz) * k));
        }
        continue;
      }
      const theta = Math.atan2(p.z - e.cz, p.x - e.cx);
      const b = bodyRadiusAt(frame, p.y, theta)!;
      const r = Math.hypot(p.x - b.c[0], p.z - b.c[1]);
      if (r < b.r + ease) {
        const k = (b.r + ease) / Math.max(1e-6, r);
        set(i, V(b.c[0] + (p.x - b.c[0]) * k, p.y, b.c[1] + (p.z - b.c[1]) * k));
      }
    }
  }

  // ---- statuses per ring ---------------------------------------------------
  const rings: RingFit[] = [];
  const ringEase: Record<string, number> = { hem: o.ease.hem, waist: o.ease.waist, chest: o.ease.chest, armpit: o.ease.chest, shoulder: o.ease.shoulder, cuff_left: o.ease.sleeve, cuff_right: o.ease.sleeve };
  const byLogical = new Map<number, number>();
  for (let i = 0; i < n; i++) if (!byLogical.has(logical[i]!)) byLogical.set(logical[i]!, i);
  for (const rm of mesh.rings) {
    const ease = ringEase[rm.name];
    if (ease === undefined) continue;
    let minClear = Infinity,
      any = false,
      ySum = 0;
    const side: WearerSide | null = rm.name === 'cuff_left' ? 'left' : rm.name === 'cuff_right' ? 'right' : null;
    for (const lid of rm.logical) {
      const p = get(byLogical.get(lid)!);
      ySum += p.y;
      if (side) {
        any = true;
        minClear = Math.min(minClear, capsuleSignedDistance(armCaps[side], p.x, p.y, p.z));
        continue;
      }
      const e = torsoCrossSection(frame, p.y);
      if (!e) continue;
      any = true;
      const b = bodyRadiusAt(frame, p.y, Math.atan2(p.z - e.cz, p.x - e.cx))!;
      minClear = Math.min(minClear, Math.hypot(p.x - b.c[0], p.z - b.c[1]) - b.r);
    }
    const y = ySum / rm.logical.length;
    if (!any) rings.push({ ring: rm.name, y, clearance: null, ease, status: 'free' });
    else rings.push({ ring: rm.name, y, clearance: minClear, ease, status: minClear < ease * 0.5 ? 'tight' : minClear > ease * 3 + 0.04 ? 'loose' : 'ok' });
  }

  // ---- checks ----------------------------------------------------------------
  const checks: CheckResult[] = [];
  {
    let inside = 0,
      worst = 0;
    for (let i = 0; i < n; i++) {
      const p = get(i);
      const side = sleeveVertex(i);
      let d: number;
      if (side) d = capsuleSignedDistance(armCaps[side], p.x, p.y, p.z);
      else {
        const e = torsoCrossSection(frame, p.y);
        if (!e) {
          d = outsideTorsoDistance(p.x, p.y, p.z);
        } else {
          const b = bodyRadiusAt(frame, p.y, Math.atan2(p.z - e.cz, p.x - e.cx))!;
          d = Math.hypot(p.x - b.c[0], p.z - b.c[1]) - b.r;
        }
      }
      if (d < -0.002) {
        inside++;
        worst = Math.min(worst, d);
      }
    }
    checks.push({ name: 'no_vertex_inside_body', pass: inside === 0, level: 'fail', detail: `${inside} vertices inside the body (worst ${(worst * 100).toFixed(1)} cm)` });
  }
  {
    // arm axis stays inside the sleeve tube: sample the axis at each sleeve ring and compare with ring radius
    const problems: string[] = [];
    for (const side of ['left', 'right'] as WearerSide[]) {
      const J = frame.arms[side].joints;
      const a = V(...J[0]!.pos),
        dir = V(...J[J.length - 1]!.pos).sub(a).normalize();
      for (let ring = 1; ring < SLEEVE_RINGS; ring++) {
        const ids: number[] = [];
        for (let m = 0; m < SLEEVE_N; m++) ids.push(byLogical.get(sleeveId(side, ring, m))!);
        const c = new THREE.Vector3();
        for (const i of ids) c.add(get(i));
        c.multiplyScalar(1 / ids.length);
        let radius = 0;
        for (const i of ids) radius += get(i).distanceTo(c);
        radius /= ids.length;
        const t = c.clone().sub(a).dot(dir);
        const axisPt = a.clone().addScaledVector(dir, t);
        const off = axisPt.distanceTo(c);
        if (off > radius * 0.85) problems.push(`${side} ring ${ring}: axis ${(off * 100).toFixed(1)} cm from centre, radius ${(radius * 100).toFixed(1)} cm`);
      }
    }
    checks.push({ name: 'arm_inside_sleeve', pass: problems.length === 0, level: o.fitToBody ? 'fail' : 'warn', detail: problems.length ? problems.join('; ') : 'arm axis inside both sleeves' });
  }
  {
    // neck opening around the neck: collar inner ring must clear the neck capsule
    const neckCap = caps.filter((c) => c.region === 'neck');
    let inside = 0;
    for (const lid of mesh.rings.find((r) => r.name === 'collar_inner')!.logical) {
      const p = get(byLogical.get(lid)!);
      if (capsuleSignedDistance(neckCap, p.x, p.y, p.z) < 0) inside++;
    }
    checks.push({ name: 'neck_opening_clears_neck', pass: inside === 0, level: 'warn', detail: `${inside} collar vertices inside the neck` });
  }
  mesh.geometry.dispose();
  const ok = checks.every((c) => c.pass || c.level === 'warn');
  const anyTight = rings.some((r) => r.status === 'tight');
  return {
    bodyId,
    anchor: o.anchor,
    scale,
    offset,
    params,
    fitAdjust,
    positions,
    pushedVertices: pushed,
    maxPush,
    rings,
    checks,
    ok,
    status: !checks[0]!.pass ? 'intersects' : anyTight ? 'tight' : 'ok',
  };
}

/** Helper for scripts/tests: logical row of a torso grid id (or -1 for sleeves). */
export function torsoRowOf(logicalId: number): number {
  return logicalId < (NECK_ROW + 2) * M ? Math.floor(logicalId / M) : -1;
}
export { gridId };
