/**
 * M04 — mannequin dev page (body.html): parameter sliders with anatomical
 * clamps, two base proportion sets, presets, fixed views, wireframe / flat,
 * landmarks, in-browser geometry checks, JSON export.
 *
 * URL parameters (scripts/render-body.mjs):
 *   view=front|back|left|right|iso|top|threequarter   wire=1  flat=1  landmarks=1  parts=1
 *   preset=<id>   params=<url-encoded JSON of partial BodyParams>
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MODULE_VERSION } from '../domain/versions';
import { bodyCapsules } from '../body/anatomy';
import { buildBody, updateBody, type BodyMesh } from '../body/buildBody';
import { checkBodyFixedTopology, checkBodyMesh } from '../body/checks';
import { landmarksFromFrame } from '../body/landmarks';
import { BODY_PARAM_LIMITS, BODY_PARAM_NAMES, BODY_PRESETS, BODY_TEMPLATE_VERSION, BODY_TOPOLOGY_VERSION, bodySex, defaultBodyParams, type BodyParams } from '../body/params';
import type { CheckReport } from '../templates/checks';

export type BodyViewName = 'front' | 'back' | 'left' | 'right' | 'iso' | 'top' | 'threequarter';

export interface BodyAppHandle {
  dispose(): void;
  setView(view: BodyViewName): void;
  setParams(p: Partial<BodyParams>): void;
  getParams(): BodyParams;
  getReport(): CheckReport;
  getMesh(): BodyMesh;
  renderOnce(): void;
}

const PART_COLORS = ['#d9c2a7', '#c9b59b', '#c9b59b', '#bfae96', '#bfae96', '#a8998a', '#a8998a'];

export function startBodyApp(root: HTMLElement): BodyAppHandle {
  const url = new URL(window.location.href);
  const q = (k: string) => url.searchParams.get(k);
  const flag = (k: string, def: boolean) => {
    const v = q(k);
    return v === null ? def : v === '1' || v === 'true';
  };
  root.innerHTML = '';
  const viewport = el('div', 'pg-viewport');
  const panel = el('aside', 'pg-panel');
  root.append(viewport, panel);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#f4f5f7', 1);
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8bcc8', 1.1));
  const key = new THREE.DirectionalLight('#ffffff', 1.5);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#ffffff', 0.5);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
  scene.add(new THREE.GridHelper(2, 20, '#b7bbc6', '#d9dce3'));

  // initial params
  let initial: Partial<BodyParams> = {};
  const presetId = q('preset');
  if (presetId) {
    const pr = BODY_PRESETS.find((p) => p.id === presetId);
    if (pr) initial = { ...defaultBodyParams(pr.sex), ...pr.params };
  }
  const pq = q('params');
  if (pq) {
    try {
      initial = { ...initial, ...(JSON.parse(pq) as Partial<BodyParams>) };
    } catch (e) {
      console.warn('bad params', e);
    }
  }
  const body = buildBody(initial);
  const materials = PART_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0 }));
  const partsOn = flag('parts', false);
  const mesh = new THREE.Mesh(body.geometry, partsOn ? materials : materials.map(() => materials[0]!));
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);
  let wire = new THREE.LineSegments(new THREE.WireframeGeometry(body.geometry), new THREE.LineBasicMaterial({ color: '#1f2430', transparent: true, opacity: 0.5 }));
  wire.visible = flag('wire', false);
  group.add(wire);
  const setFlat = (on: boolean) => {
    for (const m of materials) {
      m.flatShading = on;
      m.needsUpdate = true;
    }
  };
  setFlat(flag('flat', true));

  // landmarks + capsules overlay
  const overlay = new THREE.Group();
  overlay.visible = flag('landmarks', false);
  group.add(overlay);
  const rebuildOverlay = () => {
    overlay.clear();
    const lm = landmarksFromFrame(body.frame);
    const geo = new THREE.SphereGeometry(0.012, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: '#2979ff' });
    for (const l of lm) {
      const s = new THREE.Mesh(geo, mat);
      s.position.set(...l.position);
      overlay.add(s);
    }
    const capMat = new THREE.LineBasicMaterial({ color: '#ff5252', transparent: true, opacity: 0.6 });
    for (const c of bodyCapsules(body.frame)) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...c.a), new THREE.Vector3(...c.b)]);
      overlay.add(new THREE.Line(g, capMat));
    }
  };
  rebuildOverlay();

  // camera
  const target = new THREE.Vector3(0, body.params.height / 2, 0);
  const renderOnce = () => renderer.render(scene, camera);
  const setView = (view: BodyViewName) => {
    const H = body.params.height;
    const dist = H * 1.75;
    target.set(0, H / 2, 0);
    const y = target.y;
    const pos: Record<BodyViewName, [number, number, number]> = {
      front: [0, y, dist],
      back: [0, y, -dist],
      left: [dist, y, 0],
      right: [-dist, y, 0],
      top: [0, y + dist, 0.001],
      threequarter: [dist * 0.6, y + dist * 0.3, dist * 0.6],
      iso: [dist * 0.65, y + dist * 0.18, dist * 0.75],
    };
    camera.position.set(...pos[view]);
    controls.target.copy(target);
    controls.update();
    renderOnce();
  };
  const resize = () => {
    const w = viewport.clientWidth || 800;
    const h = viewport.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderOnce();
  };
  window.addEventListener('resize', resize);
  controls.addEventListener('change', renderOnce);

  // ---- panel ----
  panel.append(el('h1', '', `FitCast · манекен v${MODULE_VERSION}`));
  panel.append(el('p', 'pg-muted', `body-basic ${BODY_TEMPLATE_VERSION} (${BODY_TOPOLOGY_VERSION}) · процедурное тело, пропорции — канон, не мерки`));
  const views = el('div', 'pg-row');
  for (const v of ['front', 'back', 'left', 'right', 'threequarter', 'top', 'iso'] as BodyViewName[]) {
    const b = el('button', '', v);
    b.dataset.view = v;
    b.addEventListener('click', () => setView(v));
    views.append(b);
  }
  panel.append(views);
  const toggles = el('div', 'pg-row');
  toggles.append(
    toggle('wireframe', wire.visible, (on) => {
      wire.visible = on;
      renderOnce();
    }),
    toggle('flat', materials[0]!.flatShading, (on) => {
      setFlat(on);
      renderOnce();
    }),
    toggle('ориентиры/капсулы', overlay.visible, (on) => {
      overlay.visible = on;
      renderOnce();
    }),
    toggle('части цветом', partsOn, (on) => {
      mesh.material = on ? materials : materials.map(() => materials[0]!);
      renderOnce();
    }),
  );
  panel.append(toggles);

  // presets
  const presetRow = el('div', 'pg-row');
  presetRow.append(el('span', 'pg-muted', 'Пресеты пропорций:'));
  for (const pr of BODY_PRESETS) {
    const b = el('button', '', pr.label);
    b.dataset.preset = pr.id;
    b.addEventListener('click', () => applyParams({ ...defaultBodyParams(pr.sex), ...pr.params }, true));
    presetRow.append(b);
  }
  panel.append(presetRow);

  const clampBox = el('div', 'pg-clamp');
  panel.append(clampBox);
  const sliders = el('div', 'pg-sliders');
  panel.append(sliders);
  const inputs = new Map<string, HTMLInputElement>();
  const valueLabels = new Map<string, HTMLElement>();
  const fmt = (n: keyof BodyParams, v: number) => {
    const L = BODY_PARAM_LIMITS[n];
    if (L.unit === 'm') return `${(v * 100).toFixed(1)} см`;
    if (L.unit === 'rad') return `${((v * 180) / Math.PI).toFixed(0)}°`;
    if (L.unit === 'enum') return v >= 0.5 ? 'жен' : 'муж';
    return v.toFixed(3);
  };
  for (const n of BODY_PARAM_NAMES) {
    const L = BODY_PARAM_LIMITS[n];
    const row = el('label', 'pg-slider');
    const name = el('span', 'pg-slider-name', L.label);
    const val = el('span', 'pg-slider-val', '');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(L.min);
    input.max = String(L.max);
    input.step = String(L.step ?? (L.max - L.min) / 200);
    input.dataset.param = n;
    input.addEventListener('input', () => {
      const partial: Partial<BodyParams> = { [n]: Number(input.value) } as Partial<BodyParams>;
      if (n === 'sex') {
        // switching base proportions: load that sex's defaults, keep height
        const d = defaultBodyParams(Number(input.value) >= 0.5 ? 'female' : 'male');
        applyParams({ ...d, height: body.params.height }, true);
        return;
      }
      applyParams(partial, false);
    });
    row.append(name, input, val);
    sliders.append(row);
    inputs.set(n, input);
    valueLabels.set(n, val);
  }
  const info = el('pre', 'pg-report');
  panel.append(el('h2', '', 'Ориентиры (м) и проверки'));
  panel.append(info);
  const exportBtn = el('button', '', 'Экспорт JSON параметров');
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ template: 'body-basic', version: BODY_TEMPLATE_VERSION, params: body.params, clamped: body.clamped, heights: body.frame.heights }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'body-params.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  panel.append(exportBtn);

  let report: CheckReport = checkBodyMesh(body);
  const refreshPanel = () => {
    for (const n of BODY_PARAM_NAMES) {
      inputs.get(n)!.value = String(body.requested[n]);
      valueLabels.get(n)!.textContent = fmt(n, body.params[n]);
    }
    clampBox.innerHTML = '';
    if (body.clamped.length) {
      clampBox.append(el('strong', '', 'Анатомические ограничения применены:'));
      for (const c of body.clamped) clampBox.append(el('div', '', `${BODY_PARAM_LIMITS[c.name].label}: ${fmt(c.name, c.from)} → ${fmt(c.name, c.to)} — ${c.reason}`));
    } else clampBox.append(el('span', 'pg-muted', 'Все параметры приняты без ограничений.'));
    report = checkBodyMesh(body);
    const h = body.frame.heights;
    const lines = [
      `пол: ${bodySex(body.params)}  рост ${(body.params.height * 100).toFixed(0)} см  голова ${(body.frame.headUnit * 100).toFixed(1)} см (${body.params.headRatio.toFixed(2)} голов)`,
      `плечо ${(h.shoulder * 100).toFixed(1)}  основание шеи ${(h.neck_base * 100).toFixed(1)}  грудь ${(h.chest * 100).toFixed(1)}  талия ${(h.waist * 100).toFixed(1)}  бёдра ${(h.hip * 100).toFixed(1)}  пах ${(h.crotch * 100).toFixed(1)}  колено ${(h.knee * 100).toFixed(1)} см`,
      `вершин ${body.stats.vertices} · треугольников ${body.stats.triangles}`,
      ...report.results.map((r) => `${r.pass ? 'PASS' : r.level === 'warn' ? 'WARN' : 'FAIL'}  ${r.name} — ${r.detail}`),
    ];
    const topo = checkBodyFixedTopology(3);
    lines.push(`${topo.pass ? 'PASS' : 'FAIL'}  ${topo.name} — ${topo.detail}`);
    info.textContent = lines.join('\n');
    info.classList.toggle('pg-report-fail', !report.ok || !topo.pass);
  };
  const applyParams = (partial: Partial<BodyParams>, replace: boolean) => {
    if (replace) {
      const full = { ...defaultBodyParams(bodySex({ ...body.params, ...partial } as BodyParams)), ...partial } as BodyParams;
      body.requested = full;
      updateBody(body, {});
    } else updateBody(body, partial);
    wire.geometry.dispose();
    wire.geometry = new THREE.WireframeGeometry(body.geometry);
    rebuildOverlay();
    refreshPanel();
    renderOnce();
  };

  refreshPanel();
  resize();
  setView((q('view') as BodyViewName) ?? 'threequarter');
  requestAnimationFrame(() => {
    resize();
    setView((q('view') as BodyViewName) ?? 'threequarter');
  });

  return {
    dispose() {
      window.removeEventListener('resize', resize);
      controls.dispose();
      body.geometry.dispose();
      wire.geometry.dispose();
      for (const m of materials) m.dispose();
      renderer.dispose();
    },
    setView,
    setParams: (p) => applyParams(p, false),
    getParams: () => ({ ...body.params }),
    getReport: () => report,
    getMesh: () => body,
    renderOnce,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function toggle(label: string, initial: boolean, onChange: (on: boolean) => void): HTMLElement {
  const l = document.createElement('label');
  l.className = 'pg-toggle';
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = initial;
  i.addEventListener('change', () => onChange(i.checked));
  l.append(i, document.createTextNode(' ' + label));
  return l;
}
