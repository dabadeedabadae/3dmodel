/**
 * Dev page for stages 01–03: scene with a test object, the TEST mannequin,
 * the hand-built T-shirt with parameter sliders, four fixed views, UV checker
 * and the in-browser geometry check report.
 *
 * URL parameters (used by scripts/render.mjs):
 *   view=front|back|left|right|iso   checker=1   wire=1   flat=1
 *   mannequin=0|1   testobject=0|1   uv=1 (show the 2D UV layout instead of 3D)
 *   params=<url-encoded JSON of partial TShirtParams>
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MODULE_VERSION } from '../domain/versions';
import { TestMannequinAdapter } from '../fitting/TestMannequinAdapter';
import { createCheckerTexture, drawUVLayout } from '../image/uvChecker';
import { checkFixedTopology, checkTShirtMesh, type CheckReport } from '../templates/checks';
import { buildTShirt, updateTShirt, type TShirtMesh } from '../templates/tshirt/buildTShirt';
import { TSHIRT_PARAM_LIMITS, TSHIRT_PARAM_NAMES, clampTShirtParams, defaultTShirtParams, type TShirtParams } from '../templates/tshirt/params';

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'iso' | 'top' | 'threequarter' | 'threequarter_back';

export interface AppHandle {
  dispose(): void;
  setView(view: ViewName): void;
  setParams(p: Partial<TShirtParams>): void;
  getParams(): TShirtParams;
  getReport(): CheckReport;
  renderOnce(): void;
  uvLayoutDataURL(): string;
  checkerDataURL(): string;
}

const PANEL_COLORS = ['#d7d9de', '#d7d9de', '#d7d9de', '#d7d9de', '#d7d9de']; // neutral; one material per island group

export function startApp(root: HTMLElement): AppHandle {
  const url = new URL(window.location.href);
  const q = (k: string) => url.searchParams.get(k);
  const flag = (k: string, def: boolean) => {
    const v = q(k);
    return v === null ? def : v === '1' || v === 'true';
  };

  // --- DOM ------------------------------------------------------------------
  root.innerHTML = '';
  const viewport = el('div', 'pg-viewport');
  const panel = el('aside', 'pg-panel');
  const uvCanvas = document.createElement('canvas');
  uvCanvas.className = 'pg-uv';
  root.append(viewport, panel, uvCanvas);

  // --- renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#f4f5f7', 1);
  viewport.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;

  scene.add(new THREE.HemisphereLight('#ffffff', '#b8bcc8', 1.1));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#ffffff', 0.5);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const grid = new THREE.GridHelper(4, 16, '#b7bbc6', '#d9dce3');
  scene.add(grid);

  // stage 01 test object (reference cube + axes)
  const testObject = new THREE.Group();
  testObject.name = 'stage01-test-object';
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: '#4f7cff', roughness: 0.6 }));
  cube.position.set(-1.2, 0.15, 0.8);
  testObject.add(cube, new THREE.AxesHelper(0.6));
  testObject.visible = flag('testobject', true);
  scene.add(testObject);

  // TEST mannequin
  const mannequin = new TestMannequinAdapter();
  const mannequinObj = mannequin.createDisplayObject();
  mannequinObj.visible = flag('mannequin', true);
  scene.add(mannequinObj);

  // T-shirt
  let params: TShirtParams = defaultTShirtParams();
  const pq = q('params');
  if (pq) {
    try {
      params = { ...params, ...(JSON.parse(pq) as Partial<TShirtParams>) };
    } catch (e) {
      console.warn('bad params query', e);
    }
  }
  const shirt: TShirtMesh = buildTShirt(params);
  params = shirt.params;
  const materials = PANEL_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  const shirtMesh = new THREE.Mesh(shirt.geometry, materials);
  shirtMesh.name = 'tshirt-basic';
  const shirtGroup = new THREE.Group();
  shirtGroup.add(shirtMesh);
  scene.add(shirtGroup);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(shirt.geometry), new THREE.LineBasicMaterial({ color: '#1f2430', transparent: true, opacity: 0.55 }));
  wire.visible = flag('wire', false);
  shirtGroup.add(wire);

  const checker = createCheckerTexture(shirt.islands, { size: 1024 });
  let checkerOn = false;
  const setChecker = (on: boolean) => {
    checkerOn = on;
    for (const m of materials) {
      m.map = on ? checker.texture : null;
      m.color.set(on ? '#ffffff' : '#d7d9de');
      m.needsUpdate = true;
    }
  };
  setChecker(flag('checker', false));
  const setFlat = (on: boolean) => {
    for (const m of materials) {
      m.flatShading = on;
      m.needsUpdate = true;
    }
  };
  setFlat(flag('flat', false));

  // place the canonical shirt on the TEST mannequin: shoulder line at the torso top.
  // This is placement for viewing only — NOT fitting (stage 04).
  const placeShirt = () => {
    const neck = mannequin.getLandmark('neck_base').position;
    shirtGroup.position.set(0, mannequinObj.visible ? neck[1] + 0.12 : 1.0, 0);
  };
  placeShirt();

  // --- checks (in-browser) -------------------------------------------------
  let report = checkTShirtMesh(shirt, { stretchTolerance: 1.5 });
  const fixedTopo = checkFixedTopology(6);

  // --- views ---------------------------------------------------------------
  const target = new THREE.Vector3();
  const frame = () => {
    const bb = new THREE.Box3().setFromObject(mannequinObj.visible ? mannequinObj : shirtGroup);
    bb.union(new THREE.Box3().setFromObject(shirtGroup));
    bb.getCenter(target);
    return bb;
  };
  const setView = (view: ViewName) => {
    const bb = frame();
    const size = bb.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.9 + 0.5;
    const y = target.y;
    switch (view) {
      case 'front':
        camera.position.set(0, y, dist);
        break;
      case 'back':
        camera.position.set(0, y, -dist);
        break;
      case 'left':
        camera.position.set(-dist, y, 0);
        break;
      case 'right':
        camera.position.set(dist, y, 0);
        break;
      case 'top':
        camera.position.set(0, y + dist, 0.001);
        break;
      case 'threequarter':
        camera.position.set(dist * 0.6, y + dist * 0.45, dist * 0.6);
        break;
      case 'threequarter_back':
        camera.position.set(-dist * 0.6, y + dist * 0.45, -dist * 0.6);
        break;
      default:
        camera.position.set(dist * 0.65, y + dist * 0.18, dist * 0.75);
    }
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
  const renderOnce = () => renderer.render(scene, camera);
  window.addEventListener('resize', resize);
  controls.addEventListener('change', renderOnce);

  // --- panel ---------------------------------------------------------------
  const title = el('h1', '', `FitCast · photo-garments v${MODULE_VERSION}`);
  const sub = el('p', 'pg-muted', 'Stages 01–03 · hand-built T-shirt · TEST mannequin (not the FitCast body)');
  panel.append(title, sub);

  const viewsRow = el('div', 'pg-row');
  for (const v of ['front', 'back', 'left', 'right', 'iso', 'top', 'threequarter', 'threequarter_back'] as ViewName[]) {
    const b = el('button', '', v);
    b.addEventListener('click', () => setView(v));
    viewsRow.appendChild(b);
  }
  panel.append(el('h2', '', 'Views'), viewsRow);

  const toggles = el('div', 'pg-row');
  toggles.append(
    toggle('UV checker', checkerOn, (on) => {
      setChecker(on);
      renderOnce();
    }),
    toggle('Wireframe', wire.visible, (on) => {
      wire.visible = on;
      renderOnce();
    }),
    toggle('Flat shading', flag('flat', false), (on) => {
      setFlat(on);
      renderOnce();
    }),
    toggle('TEST mannequin', mannequinObj.visible, (on) => {
      mannequinObj.visible = on;
      placeShirt();
      renderOnce();
    }),
    toggle('Test object', testObject.visible, (on) => {
      testObject.visible = on;
      renderOnce();
    }),
  );
  panel.append(el('h2', '', 'Display'), toggles);

  panel.append(el('h2', '', 'T-shirt parameters (canonical units)'));
  const sliders = new Map<keyof TShirtParams, HTMLInputElement>();
  const clampBox = el('div', 'pg-clamp');
  const showClamps = (requested: Partial<TShirtParams>) => {
    const { clamped } = clampTShirtParams(requested);
    clampBox.innerHTML = '';
    if (!clamped.length) {
      clampBox.textContent = 'No parameter was clamped.';
      return;
    }
    clampBox.appendChild(el('div', '', 'Clamped (derived rules, see DECISIONS D-05/D-08):'));
    for (const c of clamped) clampBox.appendChild(el('div', '', `${c.name}: requested ${c.requested.toFixed(3)} → applied ${c.applied.toFixed(3)}`));
  };
  const requestedParams: Partial<TShirtParams> = { ...params };
  const applyParams = (partial: Partial<TShirtParams>) => {
    Object.assign(requestedParams, partial);
    updateTShirt(shirt, { ...requestedParams });
    params = shirt.params;
    showClamps(requestedParams);
    wire.geometry.dispose();
    wire.geometry = new THREE.WireframeGeometry(shirt.geometry);
    for (const [k, input] of sliders) {
      input.value = String(params[k]);
      (input.nextElementSibling as HTMLElement).textContent = params[k].toFixed(3);
    }
    report = checkTShirtMesh(shirt, { stretchTolerance: 1.5 });
    renderReport();
    renderOnce();
  };
  for (const k of TSHIRT_PARAM_NAMES) {
    const lim = TSHIRT_PARAM_LIMITS[k];
    const row = el('label', 'pg-slider');
    const name = el('span', '', lim.label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(lim.min);
    input.max = String(lim.max);
    input.step = String(lim.step);
    input.value = String(params[k]);
    const val = el('output', '', params[k].toFixed(3));
    input.addEventListener('input', () => applyParams({ [k]: Number(input.value) } as Partial<TShirtParams>));
    row.append(name, input, val);
    sliders.set(k, input);
    panel.appendChild(row);
  }
  const resetBtn = el('button', '', 'Reset to canonical');
  resetBtn.addEventListener('click', () => applyParams(defaultTShirtParams()));
  panel.append(resetBtn, clampBox);
  showClamps(pq ? (JSON.parse(pq) as Partial<TShirtParams>) : {});

  // TEST mannequin params
  panel.append(el('h2', '', 'TEST mannequin params (not in FitCast Body)'));
  for (const spec of mannequin.getParamSpec()) {
    const row = el('label', 'pg-slider');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = '0.01';
    input.value = String(mannequin.getParams()[spec.name]);
    const val = el('output', '', Number(input.value).toFixed(2));
    input.addEventListener('input', () => {
      mannequin.setParams({ [spec.name]: Number(input.value) });
      val.textContent = Number(input.value).toFixed(2);
      placeShirt();
      renderOnce();
    });
    row.append(el('span', '', spec.label), input, val);
    panel.appendChild(row);
  }

  // report
  panel.append(el('h2', '', 'Geometry checks (in-browser)'));
  const reportBox = el('div', 'pg-report');
  panel.appendChild(reportBox);
  const renderReport = () => {
    reportBox.innerHTML = '';
    const head = el('div', report.ok ? 'pg-ok' : 'pg-fail', `${report.ok ? 'PASS' : 'FAIL'} · ${shirt.topologyVersion} · ${report.summary.vertices} verts (${report.summary.logicalVertices} logical) · ${report.summary.triangles} tris · openings ${JSON.stringify(report.summary.boundaryLoops)}`);
    reportBox.appendChild(head);
    for (const r of [...report.results, fixedTopo]) {
      const line = el('div', r.pass ? 'pg-line-ok' : r.level === 'warn' ? 'pg-line-warn' : 'pg-line-fail', `${r.pass ? '✓' : r.level === 'warn' ? '⚠' : '✗'} ${r.name} — ${r.detail}`);
      reportBox.appendChild(line);
    }
  };
  renderReport();

  // exports
  const exportsRow = el('div', 'pg-row');
  const dl = (name: string, dataUrl: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    a.click();
  };
  const uvLayoutDataURL = () => {
    drawUVLayout(uvCanvas, shirt.geometry, shirt.islands, 1024);
    return uvCanvas.toDataURL('image/png');
  };
  const checkerDataURL = () => checker.canvas.toDataURL('image/png');
  const b1 = el('button', '', 'Download UV layout PNG');
  b1.addEventListener('click', () => dl('tshirt-uv-layout.png', uvLayoutDataURL()));
  const b2 = el('button', '', 'Download checker PNG');
  b2.addEventListener('click', () => dl('tshirt-uv-checker.png', checkerDataURL()));
  const b3 = el('button', '', 'Download params+meta JSON');
  b3.addEventListener('click', () => {
    const meta = {
      templateId: shirt.templateId,
      templateVersion: shirt.templateVersion,
      topologyVersion: shirt.topologyVersion,
      params,
      islands: shirt.islands.map((i) => ({ name: i.name, materialIndex: i.materialIndex, triangles: i.indexCount / 3, uvRect: i.uvRect })),
      rings: shirt.rings.map((r) => ({ name: r.name, size: r.logical.length, isOpening: r.isOpening })),
      seams: shirt.seams.map((s) => s.name),
      stats: shirt.stats,
      uvScale: shirt.uvScale,
      avatar: { id: mannequin.id, version: mannequin.version, kind: mannequin.kind },
    };
    dl('tshirt-meta.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(meta, null, 2)));
  });
  exportsRow.append(b1, b2, b3);
  panel.append(el('h2', '', 'Export'), exportsRow);

  // UV-only mode for renders
  if (flag('uv', false)) {
    root.classList.add('pg-uv-mode');
    uvLayoutDataURL();
  }

  // --- boot ------------------------------------------------------------------
  resize();
  setView((q('view') as ViewName) ?? 'iso');
  // a second resize after layout settles (fonts/panel width)
  requestAnimationFrame(() => {
    resize();
    setView((q('view') as ViewName) ?? 'iso');
  });

  const handle: AppHandle = {
    dispose() {
      window.removeEventListener('resize', resize);
      controls.dispose();
      shirt.geometry.dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      for (const m of materials) m.dispose();
      checker.texture.dispose();
      cube.geometry.dispose();
      (cube.material as THREE.Material).dispose();
      mannequin.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
    setView,
    setParams: applyParams,
    getParams: () => ({ ...params }),
    getReport: () => report,
    renderOnce,
    uvLayoutDataURL,
    checkerDataURL,
  };
  return handle;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function toggle(label: string, initial: boolean, onChange: (on: boolean) => void): HTMLElement {
  const l = el('label', 'pg-toggle');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.addEventListener('change', () => onChange(input.checked));
  l.append(input, el('span', '', label));
  return l;
}
