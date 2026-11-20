import * as THREE from 'three';
import { deform, GAIN, WEIGHT_NAMES, type Weights } from '../src/deform';
import { measureImported } from '../src/measure';
import { buildSkeleton, computeSkin } from '../src/rig';
import { verifiedAPose } from '../src/pose';
import { buildCloth, stepCloth, stretchStats, DEFAULT_CLOTH, type ClothParams } from '../src/cloth';
import { resolvePoint, type BodyColliders } from '../src/collider';
import type { BodyAsset } from '../src/asset';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'front';
const wire = q.get('wire') === '1';
const headless = q.get('ui') === '0';
const assetFile = q.get('asset') ? `/imported-body/out/asset-${q.get('asset')}.json` : '/imported-body/out/asset.json';
const raw = await (await fetch(assetFile)).json();
const asset: BodyAsset = { ...raw, base: new Float32Array(raw.base), index: new Uint32Array(raw.index) };

const PRESETS: Record<string, { w: Partial<Weights>; h?: number }> = {
  base: { w: {} },
  athletic: { w: { chest: 0.8, waist: -0.6, hip: -0.2, shoulders: 1, arms: 0.7, thighs: 0.4 } },
  round: { w: { chest: 0.4, waist: 1, hip: 0.8, shoulders: -0.3, arms: 0.2, thighs: 0.6 } },
  slim: { w: { chest: -0.6, waist: -0.8, hip: -0.5, shoulders: -0.5, arms: -0.6, thighs: -0.6 } },
  tall: { w: {}, h: 190 },
};
const state: Weights = { chest: 0, waist: 0, hip: 0, shoulders: 0, arms: 0, thighs: 0 };
let heightCm = Math.round((raw.landmarks?.height ?? 1.65) * 100);
let mode: 'keep_girths' | 'proportional' = 'keep_girths';
let posed = q.get('pose') === 'a';
const preset = q.get('preset');
if (preset && PRESETS[preset]) {
  Object.assign(state, PRESETS[preset]!.w);
  if (PRESETS[preset]!.h) heightCm = PRESETS[preset]!.h!;
}

const app = document.getElementById('app')!;
app.innerHTML = headless ? '<div class="vp"></div>' : '<div class="vp"></div><div class="panel"></div>';
const vp = app.querySelector('.vp') as HTMLElement;
const W = headless ? 820 : 900, Hpx = headless ? 1000 : window.innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, Hpx);
// studio look: soft shadow, filmic tone mapping, a floor that only catches the shadow
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
vp.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1f0ee);
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(asset.base), 3));
g.setIndex(Array.from(asset.index));
const skinMat = new THREE.MeshStandardMaterial({ color: 0xd3d4d8, flatShading: true, roughness: 0.62, metalness: 0.0 });
const mesh = new THREE.Mesh(g, skinMat);
mesh.castShadow = true;
mesh.receiveShadow = true;
scene.add(mesh);
let wf: THREE.LineSegments | null = null;
const studio = q.get('studio') !== '0';
// ?clean=1 — no floor, no grid, white background: a reference frame for the generator, which should see the
// figure and nothing of our studio
const clean = q.get('clean') === '1';
if (clean) scene.background = new THREE.Color(0xffffff);
if (clean) {
  // nothing under the figure
} else if (studio) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.17 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
} else scene.add(new THREE.GridHelper(2, 20, 0xc3c7d0, 0xd8dbe2));
scene.add(new THREE.HemisphereLight(0xffffff, clean ? 0xdddddd : 0x9aa0ad, clean ? 2.0 : studio ? 1.25 : 1.0));
const key = new THREE.DirectionalLight(0xffffff, clean ? 1.1 : studio ? 1.9 : 1.5);
key.position.set(1.6, 2.6, 2.2);
if (studio && !clean) {
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4;
  key.shadow.bias = -0.0006;
  const c = key.shadow.camera as THREE.OrthographicCamera;
  c.left = -1.4; c.right = 1.4; c.top = 2.4; c.bottom = -0.3; c.near = 0.5; c.far = 8;
}
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe6f0, studio ? 0.55 : 0.5); fill.position.set(-1.8, 1.2, -1.4); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, studio ? 0.5 : 0); rim.position.set(-0.6, 1.6, -2.4); scene.add(rim);
const cam = new THREE.PerspectiveCamera(28, W / Hpx, 0.05, 20);
const d = 4.6;
const place: Record<string, [number, number, number]> = {
  front: [0, 0.95, d], back: [0, 0.95, -d], left: [d, 0.95, 0],
  threequarter: [d * 0.62, 1.2, d * 0.72], top: [0.01, d, 0],
};
let orbit = 0;
function placeCam() {
  const p = place[view] ?? place.front!;
  const c = Math.cos(orbit), s = Math.sin(orbit);
  cam.position.set(p[0] * c + p[2] * s, p[1], p[2] * c - p[0] * s);
  cam.lookAt(0, 0.9 * (heightCm / 175), 0);
  // close-ups for checks: ?cam=x,y,z&look=x,y,z (metres)
  const qp = new URLSearchParams(location.search), cp = qp.get('cam'), lp = qp.get('look');
  if (cp) { const [x, y, z] = cp.split(',').map(Number); cam.position.set(x!, y!, z!); }
  if (lp) { const [x, y, z] = lp.split(',').map(Number); cam.lookAt(x!, y!, z!); }
}

let last: any = null;
function rebuild() {
  let p = deform(asset, state, { mode, height_cm: heightCm });
  // measurements are taken in the T-pose, where the horizontal slices are the ones the landmarks were found on
  const measureOn = p;
  let poseNote = '';
  if (posed) {
    const sk = computeSkin(asset, p, buildSkeleton(asset, p));
    const v = verifiedAPose(asset, p, sk);
    p = v.positions;
    poseNote = v.verified ? `A-поза ${v.shoulderDegrees}°` : 'A-поза не прошла проверку, показана T-поза';
  }
  (g.attributes.position as THREE.BufferAttribute).copyArray(p);
  g.attributes.position!.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  if (wf) { scene.remove(wf); wf.geometry.dispose(); wf = null; }
  if (wire) { wf = new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: 0x33384a, transparent: true, opacity: 0.35 })); scene.add(wf); }
  last = measureImported(asset, measureOn, mode);
  if (!headless) readout(poseNote);
  placeCam();
  renderer.render(scene, cam);
}
function readout(note = '') {
  const el = document.querySelector('#cm')!;
  el.innerHTML = `рост <b>${last.height_cm}</b> · грудь <b>${last.chest_cm}</b> · талия <b>${last.waist_cm}</b> · бёдра <b>${last.hip_cm}</b><br>корпус по пройме <b>${last.torso_width_cm}</b> · бицепс <b>${last.bicep_cm}</b> · бедро <b>${last.thigh_cm}</b> <span class="u">см</span>${note ? `<br><span class="u">${note}</span>` : ''}`;
}
if (!headless) {
  const panel = app.querySelector('.panel') as HTMLElement;
  const RU: Record<string, string> = { chest: 'грудь', waist: 'талия', hip: 'бёдра', shoulders: 'плечи', arms: 'руки', thighs: 'ноги' };
  panel.innerHTML =
    `<h3>Манекен · ${asset.id}</h3><div id="cm" class="cm"></div>` +
    `<label>рост, см <span id="hv">165</span><input id="h" type="range" min="140" max="200" step="1" value="165"></label>` +
    `<label><input id="mode" type="checkbox"> пропорциональный рост</label>` +
    `<label><input id="pose" type="checkbox"${posed ? ' checked' : ''}> руки опущены (A-поза)</label>` +
    // the range is clamped to what this asset survives without inverting triangles (check-outfit measures it)
    WEIGHT_NAMES.map((n) => {
      const lim = (raw.usableSliderRange?.[n] ?? 1) || 1;
      return `<label>${RU[n]} <span id="v-${n}">0</span><input data-w="${n}" type="range" min="${-lim}" max="${lim}" step="0.05" value="0"></label>`;
    }).join('') +
    `<div class="row">${Object.keys(PRESETS).map((k) => `<button data-p="${k}">${k}</button>`).join('')}<button data-p="reset">сброс</button></div>` +
    `<p class="note">Сантиметры снимаются с меша срезами плоскостями, а не из ползунков. «Корпус по пройме» — ширина корпуса на уровне проймы, это не биакромиальная ширина плеч: в T-позе дельта переходит в руку без границы.</p>` +
    `<p class="note">Ползунки безразмерные, ±1. Шаг ±1 меняет обхват примерно на ${WEIGHT_NAMES.map((n) => `${RU[n]} ${Math.round(GAIN[n] * 100)}%`).join(', ')}.</p>`;
  panel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.w) { (state as any)[t.dataset.w] = Number(t.value); panel.querySelector(`#v-${t.dataset.w}`)!.textContent = t.value; }
    if (t.id === 'h') { heightCm = Number(t.value); panel.querySelector('#hv')!.textContent = t.value; }
    if (t.id === 'mode') mode = t.checked ? 'proportional' : 'keep_girths';
    if (t.id === 'pose') posed = t.checked;
    rebuild();
  });
  panel.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'pose' || t.id === 'mode') rebuild();
  });
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    const p = b.dataset.p!;
    for (const n of WEIGHT_NAMES) state[n] = 0;
    heightCm = 165;
    if (p !== 'reset') { Object.assign(state, PRESETS[p]!.w); if (PRESETS[p]!.h) heightCm = PRESETS[p]!.h!; }
    for (const n of WEIGHT_NAMES) {
      (panel.querySelector(`[data-w="${n}"]`) as HTMLInputElement).value = String(state[n]);
      panel.querySelector(`#v-${n}`)!.textContent = String(state[n]);
    }
    (panel.querySelector('#h') as HTMLInputElement).value = String(heightCm);
    panel.querySelector('#hv')!.textContent = String(heightCm);
    rebuild();
  });
  let drag = false, px = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = true; px = e.clientX; });
  addEventListener('pointerup', () => { drag = false; });
  addEventListener('pointermove', (e) => { if (!drag) return; orbit += (e.clientX - px) * 0.008; px = e.clientX; placeCam(); renderer.render(scene, cam); });
}
// raw garment preview: ?garment=<id> shows the imported garment alone, in its own normalised box
const rawG = q.get('sim') ? null : q.get('garment');
if (rawG) {
  const d = await (await fetch(`/imported-body/out/garment-${rawG}.json`)).json();
  scene.remove(mesh);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(d.positions), 3));
  gg.setIndex(d.index);
  gg.computeVertexNormals();
  const m = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: 0x9aa3b2, flatShading: false, roughness: 0.9, side: THREE.DoubleSide }));
  m.scale.setScalar(1.6);
  scene.add(m);
  if (wire) scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(gg), new THREE.LineBasicMaterial({ color: 0x33384a, transparent: true, opacity: 0.25 })));
  placeCam();
  renderer.render(scene, cam);
}
// simulated view: ?sim=<garment>-<shape> shows the body with the draped imported garment and, with colliders=1,
// the collider stack that the cloth actually touched
const sim = q.get('sim');
if (sim) {
  const d = await (await fetch(`/imported-body/out/sim-${sim}.json`)).json();
  (g.attributes.position as THREE.BufferAttribute).copyArray(new Float32Array(d.body));
  g.attributes.position!.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(q.get('live') === '1' && d.aligned ? d.aligned : d.garment), 3));
  gg.setIndex(d.garmentIndex);
  gg.computeVertexNormals();
  // fit map: the gap between fabric and skin per vertex. Red = tight (under 2 mm), green = normal, blue = loose.
  // fabric: smooth normals, matte with a restrained sheen — flat shading on 10 k triangles read as plastic
  let gmat: THREE.Material = new THREE.MeshPhysicalMaterial({
    color: 0x6b7f9e, roughness: 0.92, metalness: 0, sheen: 0.55, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x9fb0c6),
    side: THREE.DoubleSide, flatShading: false,
  });
  if (q.get('fitmap') === '1' && d.clearance) {
    const c = d.clearance as number[];
    const col = new Float32Array(c.length * 3);
    for (let i = 0; i < c.length; i++) {
      const mm = c[i]!;
      let r = 0, g2 = 0, b = 0;
      if (mm < 2) { r = 0.85; g2 = 0.18; b = 0.12; }
      else if (mm < 8) { const t = (mm - 2) / 6; r = 0.85 - 0.5 * t; g2 = 0.18 + 0.5 * t; b = 0.12 + 0.1 * t; }
      else if (mm < 25) { const t = (mm - 8) / 17; r = 0.35 - 0.2 * t; g2 = 0.68 - 0.2 * t; b = 0.22 + 0.5 * t; }
      else { r = 0.15; g2 = 0.33; b = 0.78; }
      col[i * 3] = r; col[i * 3 + 1] = g2; col[i * 3 + 2] = b;
    }
    gg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    gmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  }
  const gmesh = new THREE.Mesh(gg, gmat);
  gmesh.castShadow = true;
  gmesh.receiveShadow = true;
  scene.add(gmesh);
  if (q.get('colliders') === '1') {
    const mat = new THREE.MeshBasicMaterial({ color: 0xd4553e, wireframe: true, transparent: true, opacity: 0.5 });
    for (const r of d.colliders.torso) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.004, 24), mat);
      ring.scale.set(r.a, 1, r.b);
      ring.position.set(r.cx, r.y, r.cz);
      scene.add(ring);
    }
    for (const c of d.colliders.capsules) {
      const a = new THREE.Vector3(...c.a), b = new THREE.Vector3(...c.b);
      const len = a.distanceTo(b);
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(c.r, len, 4, 10), mat);
      cap.position.copy(a).add(b).multiplyScalar(0.5);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      scene.add(cap);
    }
  }
  // live physics: ?sim=...&live=1 re-runs the solver in the browser from the aligned state
  if (q.get('live') === '1' && d.aligned) {
    const colliders = d.colliders as BodyColliders;
    const params: ClothParams = { ...DEFAULT_CLOTH, thickness: 0.0006, iterations: 5, substeps: 4 };
    let cloth = buildCloth(new Float32Array(d.aligned), new Uint32Array(d.garmentIndex));
    let pins: number[] = d.pinned ?? [];
    let pinOn = true;
    const applyPins = () => { for (let i = 0; i < cloth.count; i++) cloth.invMass[i] = 1; if (pinOn) for (const i of pins) cloth.invMass[i] = 0; };
    applyPins();
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;left:12px;top:12px;font:12px system-ui;background:#fffd;padding:8px 10px;border-radius:6px;line-height:1.5';
    vp.style.position = 'relative';
    vp.appendChild(hud);
    const ui = document.createElement('div');
    ui.style.cssText = 'position:absolute;left:12px;bottom:12px;font:12px system-ui;background:#fffd;padding:8px 10px;border-radius:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:560px';
    ui.innerHTML = `<button id="p">отпустить воротник</button><button id="r">заново</button>
      <label>тянучесть <input id="st" type="range" min="0" max="100" value="20" style="width:90px"></label>
      <label>трение <input id="fr" type="range" min="0" max="100" value="35" style="width:90px"></label>
      <label>гравитация <input id="gv" type="range" min="0" max="150" value="98" style="width:90px"></label>`;
    vp.appendChild(ui);
    ui.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      if (b.id === 'p') { pinOn = !pinOn; applyPins(); b.textContent = pinOn ? 'отпустить воротник' : 'закрепить воротник'; }
      if (b.id === 'r') { cloth = buildCloth(new Float32Array(d.aligned), new Uint32Array(d.garmentIndex)); applyPins(); }
    });
    ui.addEventListener('input', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.id === 'st') params.stretchCompliance = (Number(t.value) / 100) ** 2 * 1e-4 + 1e-7;
      if (t.id === 'fr') params.friction = 1 - Number(t.value) / 100;
      if (t.id === 'gv') params.gravity = -Number(t.value) / 10;
    });
    placeCam(); // the live branch renders inside the loop, so the camera has to be placed before it starts
    const posAttr = gg.attributes.position as THREE.BufferAttribute;
    let frame = 0;
    const tick = () => {
      stepCloth(cloth, colliders, params, 1 / 60);
      posAttr.copyArray(cloth.pos);
      posAttr.needsUpdate = true;
      gg.computeVertexNormals();
      if (++frame % 12 === 0) {
        const st = stretchStats(cloth);
        let inside = 0;
        const probe = new Float32Array(cloth.pos);
        for (let i = 0; i < cloth.count; i += 4) if (resolvePoint(colliders, probe, i, 0)) inside++;
        hud.innerHTML = `вершин ткани <b>${cloth.count}</b> · связей <b>${cloth.rest.length + cloth.bendRest.length}</b><br>растяжение ср. <b>${st.mean.toFixed(2)}%</b>, макс <b>${st.max.toFixed(0)}%</b><br>внутри тела (выборка) <b>${inside}</b>`;
      }
      renderer.render(scene, cam);
      requestAnimationFrame(tick);
    };
    tick();
  } else {
    placeCam();
    renderer.render(scene, cam);
  }
}
// dressed view: body + fitted template garment, both precomputed by scripts/dress.ts
const dressed = rawG || q.get('sim') ? null : q.get('dressed');
if (dressed) {
  const d = await (await fetch(`/imported-body/out/dressed-${dressed}.json`)).json();
  (g.attributes.position as THREE.BufferAttribute).copyArray(new Float32Array(d.body));
  g.attributes.position!.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(d.garment), 3));
  gg.setIndex(d.garmentIndex);
  gg.computeVertexNormals();
  scene.add(new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: 0x5b7fb5, flatShading: true, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide })));
  placeCam();
  renderer.render(scene, cam);
} else if (!rawG && !q.get('sim')) {
  rebuild();
}
(window as any).__ib = { ready: true, measure: () => last };
