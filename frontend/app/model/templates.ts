import * as THREE from 'three';

export type Zone = 'torso' | 'legs' | 'outer' | 'feet';

export interface TemplateEntry {
  zone: Zone;
  label: string;
  /**
   * For the demo: a factory that builds placeholder garment geometry, shaped
   * (roughly) to fit the chibi mannequin in Body.tsx. Geometry is authored in
   * body space, so `position` stays [0,0,0]. Later this record is the single
   * place to swap in a real GLB (add `glbUrl?` + `useGLTF`) without touching
   * the rendering or state code.
   */
  makePlaceholder: () => THREE.BufferGeometry;
  /** Offset relative to the body root (kept for the future GLB path). */
  position: [number, number, number];
}

// --- geometry helpers ------------------------------------------------------

/** A cone/cylinder segment along +Y, transformed into place. */
function tube(
  rTop: number,
  rBottom: number,
  height: number,
  t: {
    pos?: [number, number, number];
    rotZ?: number;
    rotX?: number;
    scale?: [number, number, number];
    openEnded?: boolean;
    radial?: number;
  } = {}
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(
    rTop,
    rBottom,
    height,
    t.radial ?? 28,
    2,
    t.openEnded ?? false
  );
  if (t.scale) g.scale(...t.scale);
  if (t.rotZ) g.rotateZ(t.rotZ);
  if (t.rotX) g.rotateX(t.rotX);
  if (t.pos) g.translate(...t.pos);
  return g;
}

function ball(
  r: number,
  pos: [number, number, number],
  scale: [number, number, number] = [1, 1, 1]
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 24, 20);
  g.scale(...scale);
  g.translate(...pos);
  return g;
}

/** Merge geometries (position + normal only — enough for MeshStandardMaterial). */
function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const position: number[] = [];
  const normal: number[] = [];
  for (const g of geoms) {
    const ng = g.index ? g.toNonIndexed() : g;
    position.push(...ng.attributes.position.array);
    normal.push(...ng.attributes.normal.array);
    g.dispose();
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  out.computeVertexNormals();
  return out;
}

// --- garment builders ----------------------------------------------------
// Body reference (Body.tsx, feet at y = 0):
//   torso capsule r 0.36, y 0.47–1.53 (straight part 0.83–1.17)
//   arms  capsule r 0.135, centre (±0.46, 0.98), top tilted outward by 0.28 rad
//   legs  capsule r 0.16, x ±0.2, y 0.07–0.57
//   feet  ellipsoid centre (±0.2, 0.08, 0.08), semi-axes 0.17 / 0.12 / 0.26
// Every garment keeps a ≥ 0.03 gap over these so no skin pokes through.

const ARM = { x: 0.46, y: 0.98, tilt: 0.28, r: 0.135 };

/** Point on the arm axis, `t` units from the arm centre (+ = towards shoulder). */
function armPoint(side: -1 | 1, t: number): [number, number, number] {
  return [side * (ARM.x + Math.sin(ARM.tilt) * t), ARM.y + Math.cos(ARM.tilt) * t, 0];
}

/** A top: torso shell + shoulder yoke + sleeves that follow the arms. */
function makeTop(opts: {
  hemY: number; // bottom hem height
  topY: number; // where the shell meets the yoke
  rTop: number;
  rBottom: number;
  depth: number; // Z squash of the shell; rTop * depth must clear the torso (0.36)
  sleeveEnd: number; // arm-axis t where the sleeve ends (lower = longer sleeve)
  sleeveR: number;
}) {
  const h = opts.topY - opts.hemY;
  const parts: THREE.BufferGeometry[] = [
    // body shell
    tube(opts.rTop, opts.rBottom, h, {
      pos: [0, (opts.topY + opts.hemY) / 2, 0],
      scale: [1.05, 1, opts.depth],
      radial: 44,
    }),
    // shoulder yoke — tall enough to cover the top of the torso capsule up to the head
    ball(opts.rTop, [0, opts.topY - 0.04, 0], [1.08, 0.76, opts.depth]),
  ];

  const shoulderT = 0.17; // just above the arm's top cap
  const L = shoulderT - opts.sleeveEnd;
  for (const side of [-1, 1] as const) {
    parts.push(
      tube(opts.sleeveR, opts.sleeveR * 0.94, L, {
        rotZ: -side * ARM.tilt,
        pos: armPoint(side, shoulderT - L / 2),
      })
    );
    parts.push(ball(opts.sleeveR + 0.015, armPoint(side, shoulderT))); // shoulder cap
  }
  return merge(parts);
}

/**
 * Legwear: short hip block with a rounded crotch + two separate legs.
 * The hip block stops just below the torso tip (y 0.47) so the legs read as
 * two tubes with a gap between them, not one solid cylinder.
 */
function makeLegs(opts: { waistY: number; legBottomY: number }) {
  const seatY = 0.58; // where the straight hip part turns into the rounded crotch
  const hipH = opts.waistY - seatY;
  const legX = 0.205; // body legs sit at ±0.2 with inner edges at ±0.04
  const legR = 0.185; // leaves a 0.04 gap between the trouser legs
  const legTop = seatY + 0.04; // overlap the hip block
  const legH = legTop - opts.legBottomY;
  const parts: THREE.BufferGeometry[] = [
    // hip: wider than the torso (r 0.36 at the waist) and the leg tops (x up to 0.36)
    tube(0.39, 0.41, hipH, {
      pos: [0, seatY + hipH / 2, 0],
      radial: 40,
    }),
    // crotch: rounded underside, bottom at y 0.45 — just under the torso tip
    ball(1, [0, seatY, 0], [0.41, 0.13, 0.41]),
  ];
  for (const side of [-1, 1] as const) {
    parts.push(
      tube(legR, legR - 0.005, legH, {
        pos: [side * legX, opts.legBottomY + legH / 2, 0],
      })
    );
  }
  return merge(parts);
}

function makeBoots() {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1] as const) {
    const x = side * 0.21; // shifted out a bit so the two boots don't fuse in the middle
    // ankle shaft, over the trouser hem (r 0.185 at x ±0.205)
    parts.push(tube(0.2, 0.2, 0.32, { pos: [x, 0.2, 0] }));
    // toe box, encloses the whole foot ellipsoid (its bottom, y −0.06, is below the foot's −0.04)
    parts.push(ball(1, [x, 0.1, 0.08], [0.2, 0.16, 0.3]));
  }
  return merge(parts);
}

// --- registry ----------------------------------------------------------

const at0: [number, number, number] = [0, 0, 0];

export const TEMPLATES: Record<string, TemplateEntry> = {
  tshirt: {
    zone: 'torso',
    label: 'T-shirt',
    position: at0,
    makePlaceholder: () =>
      makeTop({
        hemY: 0.72, // just over the trouser waist (0.8), no bare belly
        topY: 1.24,
        rTop: 0.42,
        rBottom: 0.45,
        depth: 0.92,
        sleeveEnd: -0.08,
        sleeveR: 0.175,
      }),
  },
  pants: {
    zone: 'legs',
    label: 'Pants',
    position: at0,
    makePlaceholder: () =>
      makeLegs({ waistY: 0.8, legBottomY: 0.12 }),
  },
  boots: {
    zone: 'feet',
    label: 'Boots',
    position: at0,
    makePlaceholder: makeBoots,
  },
};

export type TemplateKey = keyof typeof TEMPLATES;

export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];
