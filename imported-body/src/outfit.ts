/**
 * Stage I-15 — a DRESSED figure as the asset.
 *
 * A figure generated already wearing its clothes has no fitting problem: the garment sits correctly because it
 * was modelled that way. What it needs instead is segmentation (which shell is the shirt, which the trousers)
 * and landmarks, and neither can be taken the way they are taken on a naked body: a waist found as the minimum
 * girth would be the shirt's waist, not the wearer's.
 *
 * Both are solved from the figure's own structure. These meshes arrive as separate shells — shirt, trousers,
 * head, two arms, two shoes — so a shell IS a garment or a body part, and the anchors that clothing does not
 * cover (the neck under the head, the arm roots, the ankles above the shoes, the split between the legs) give
 * the heights everything else hangs from.
 */
export type PartKind = 'head' | 'arm_left' | 'arm_right' | 'top' | 'bottom' | 'shoe_left' | 'shoe_right' | 'inner' | 'other';

export interface Part {
  kind: PartKind;
  vertices: number[];
  /** triangles of the original index buffer that belong to this shell */
  triangles: number[];
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** true when this part was cut out of a larger shell (the generator fused it to a neighbour) */
  cut?: boolean;
}

/** connected shells of an indexed mesh */
export function components(positions: Float32Array, index: Uint32Array): { vertices: number[]; triangles: number[] }[] {
  const n = positions.length / 3;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < index.length / 3; t++) {
    const v = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
    for (let k = 0; k < 3; k++) { adj[v[k]!]!.push(v[(k + 1) % 3]!); adj[v[(k + 1) % 3]!]!.push(v[k]!); }
  }
  const comp = new Int32Array(n).fill(-1);
  const out: { vertices: number[]; triangles: number[] }[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s]! >= 0) continue;
    const id = out.length;
    const verts: number[] = [];
    const st = [s];
    comp[s] = id;
    while (st.length) {
      const u = st.pop()!;
      verts.push(u);
      for (const v of adj[u]!) if (comp[v]! < 0) { comp[v] = id; st.push(v); }
    }
    out.push({ vertices: verts, triangles: [] });
  }
  for (let t = 0; t < index.length / 3; t++) out[comp[index[t * 3]!]!]!.triangles.push(t);
  return out;
}

/**
 * Labels the shells from their place in the figure. Nothing is matched by name or by material — a generated
 * asset carries neither — only by where the shell sits and how far it reaches.
 */
export function labelParts(positions: Float32Array, index: Uint32Array, opts: { splitFused?: boolean } = {}): Part[] {
  let H = 0;
  for (let i = 0; i < positions.length / 3; i++) H = Math.max(H, positions[i * 3 + 1]!);
  // a mesh composed onto the reference body is clean by construction; cutting it again would trim the cuffs
  const shells = opts.splitFused === false ? components(positions, index) : splitFused(positions, index, components(positions, index), H);
  const parts: Part[] = shells.map((c) => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const i of c.vertices) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, positions[i * 3 + k]!);
      max[k] = Math.max(max[k]!, positions[i * 3 + k]!);
    }
    return { kind: 'other' as PartKind, vertices: c.vertices, triangles: c.triangles, bbox: { min, max }, cut: c.cut };
  });
  const midX = (p: Part) => (p.bbox.min[0] + p.bbox.max[0]) / 2;
  const reach = (p: Part) => Math.max(Math.abs(p.bbox.min[0]), Math.abs(p.bbox.max[0]));
  // a shell that crosses the centre line is part of the trunk, however far its sleeves reach (I-47)
  const crossesCentre = (p: Part) => p.bbox.min[0] < -H * 0.03 && p.bbox.max[0] > H * 0.03;
  for (const p of parts) {
    const top = p.bbox.max[1] / H, bot = p.bbox.min[1] / H;
    const width = p.bbox.max[0] - p.bbox.min[0];
    if (bot < 0.12 && top < 0.2) p.kind = midX(p) > 0 ? 'shoe_left' : 'shoe_right';
    else if (top > 0.95 && width < H * 0.3) p.kind = 'head';
    else if (reach(p) > H * 0.35 && top > 0.6 && !crossesCentre(p)) p.kind = midX(p) > 0 ? 'arm_left' : 'arm_right';
    else if (bot < 0.3) p.kind = 'bottom';
    else p.kind = 'top';
  }
  return parts;
}

type Shell = { vertices: number[]; triangles: number[]; cut?: boolean };

/**
 * Generated figures do not always arrive as clean shells: one fused the shirt with the head, another the
 * hoodie with both hands (I-47). Fused shells are cut by geometry, never by a fixed height:
 *   • head — at the narrowest central slice between the shoulders and the chin (the neck);
 *   • hands — at the wrist: walking from the fingertip inwards, the first place where the arm becomes
 *     markedly thicker than the hand (the cuff of the sleeve).
 * A triangle that straddles a cut goes with its first vertex; labels are per vertex, the mesh is untouched.
 */
function splitFused(pos: Float32Array, index: Uint32Array, comps: Shell[], H: number): Shell[] {
  const X = (i: number) => pos[i * 3]!, Y = (i: number) => pos[i * 3 + 1]!;
  const out: Shell[] = [];
  for (const c of comps) {
    let maxY = -Infinity, minY = Infinity, minX = Infinity, maxX = -Infinity;
    for (const v of c.vertices) { maxY = Math.max(maxY, Y(v)); minY = Math.min(minY, Y(v)); minX = Math.min(minX, X(v)); maxX = Math.max(maxX, X(v)); }
    const trunkLike = minX < -H * 0.03 && maxX > H * 0.03;
    if (!trunkLike) { out.push(c); continue; }
    const label = new Map<number, number>(); // vertex -> 0 rest, 1 head, 2 hand left, 3 hand right
    // head fused to the top garment
    if (maxY > 0.95 * H && minY < 0.75 * H) {
      // the neck is a cylinder: its width is minimal along its whole length, so the cut goes at the LOWEST
      // slice that is still neck-narrow — right above the collar, so the bare neck goes with the head
      const prof: [number, number][] = [];
      for (let y = 0.76 * H; y < 0.93 * H; y += 0.004) {
        let w = 0, n = 0;
        for (const v of c.vertices) if (Math.abs(Y(v) - y) < 0.008 && Math.abs(X(v)) < 0.12 * H) { w = Math.max(w, Math.abs(X(v))); n++; }
        if (n >= 4) prof.push([y, w]);
      }
      const best = Math.min(...prof.map((q) => q[1]));
      const neckY = prof.length ? prof.find((q) => q[1] <= best * 1.3)![0] : NaN;
      if (Number.isFinite(neckY)) for (const v of c.vertices) if (Y(v) > neckY && Math.abs(X(v)) < 0.12 * H) label.set(v, 1);
    }
    // hands fused to the sleeves
    if (Math.max(-minX, maxX) > 0.35 * H) {
      for (const side of [1, -1]) {
        const arm = c.vertices.filter((v) => X(v) * side > 0.25 * H);
        if (arm.length < 20) continue;
        const tip = Math.max(...arm.map((v) => X(v) * side));
        const thick = (x0: number) => {
          let lo = Infinity, hi = -Infinity;
          for (const v of arm) { const ax = X(v) * side; if (ax > x0 && ax <= x0 + 0.01) { lo = Math.min(lo, Y(v)); hi = Math.max(hi, Y(v)); } }
          return hi > lo ? hi - lo : NaN;
        };
        const handSamples: number[] = [];
        for (let x = tip - 0.08; x < tip - 0.02; x += 0.01) { const t = thick(x); if (Number.isFinite(t)) handSamples.push(t); }
        if (!handSamples.length) continue;
        handSamples.sort((a, b) => a - b);
        const hand = handSamples[handSamples.length >> 1]!;
        let wrist = NaN;
        for (let x = tip - 0.06; x > tip - 0.3; x -= 0.005) {
          const t = thick(x);
          if (Number.isFinite(t) && t > hand * 1.5) { wrist = x + 0.01; break; }
        }
        if (!Number.isFinite(wrist)) continue;
        for (const v of arm) if (X(v) * side > wrist) label.set(v, side > 0 ? 2 : 3);
      }
    }
    if (!label.size) { out.push(c); continue; }
    const groups: Shell[] = [0, 1, 2, 3].map(() => ({ vertices: [], triangles: [], cut: true }));
    for (const v of c.vertices) groups[label.get(v) ?? 0]!.vertices.push(v);
    for (const t of c.triangles) groups[label.get(index[t * 3]!) ?? 0]!.triangles.push(t);
    for (const g of groups) if (g.vertices.length) out.push(g);
  }
  return out;
}

export interface OutfitLandmarks {
  height: number;
  /** top of the shoes — the ankle */
  ankle: number;
  /** where a horizontal slice of the lower garment stops cutting two legs */
  crotch: number;
  /** waistband: the top of the lower garment */
  waistband: number;
  /** widest point of the lower garment between the crotch and the waistband */
  hip: number;
  /** widest point of the upper garment */
  chest: number;
  /** the lowest point of the arm shells — the armhole */
  armpit: number;
  /** the inner end of the arm shells — the shoulder joint */
  shoulder: number;
  /** bottom of the head shell — the neck */
  neck_base: number;
  /** hem of the upper garment */
  topHem: number;
}
