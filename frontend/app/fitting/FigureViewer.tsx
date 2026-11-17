'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { deform, type Weights } from '../../lib/figure/deform';
import { PART, type Figure } from '../../lib/figure/figure';
import { mapPhotoToTop, type PhotoAnchors } from '../../lib/figure/photoMap';

export type View = 'front' | 'threequarter' | 'side' | 'back';
export interface Palette { skin: string; top: string; bottom: string; shoes: string }
/** A photographed garment for the upper shell: the photo is the texture, anchors place it (I-51). */
export interface Print { textureUrl: string; anchors: PhotoAnchors }

interface Props {
  figure: Figure;
  weights: Weights;
  heightCm: number;
  palette: Palette;
  view: View;
  /** bumps when the user presses a view button, so the same view can be re-applied */
  viewNonce: number;
  print?: Print | null;
}

const VIEW_DIR: Record<View, [number, number]> = {
  front: [0, 1], threequarter: [0.65, 0.76], side: [1, 0], back: [0, -1],
};

/**
 * Studio render of the dressed figure (same light set-up as the 3D module's viewer): soft key shadow on a
 * shadow-only floor, filmic tone mapping, flat-shaded faceted surface. Positions are re-derived from the
 * canonical base on every slider change; GPU resources are released on unmount.
 */
export default function FigureViewer({ figure, weights, heightCm, palette, view, viewNonce, print }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    controls: OrbitControls; geometry: THREE.BufferGeometry; colors: THREE.BufferAttribute; render: () => void;
    positions: Float32Array;
    photo: null | { mesh: THREE.Mesh; corners: Uint32Array; texture: THREE.Texture };
  } | null>(null);

  // one-time scene set-up
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(figure.base), 3));
    geometry.setIndex(new THREE.BufferAttribute(figure.index, 1));
    const colors = new THREE.BufferAttribute(new Float32Array(figure.base.length), 3);
    geometry.setAttribute('color', colors);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.68, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const floorGeo = new THREE.PlaneGeometry(8, 8);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.16 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0ad, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1.6, 2.6, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.bias = -0.0006;
    Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 2.4, bottom: -0.3, near: 0.5, far: 8 });
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6f0, 0.55); fill.position.set(-1.8, 1.2, -1.4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(-0.6, 1.6, -2.4); scene.add(rim);

    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 2.2;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.55;

    let frame = 0;
    const render = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { controls.update(); renderer.render(scene, camera); });
    };
    controls.addEventListener('change', render);
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    ctx.current = { renderer, scene, camera, controls, geometry, colors, render, positions: new Float32Array(figure.base), photo: null };
    resize();

    return () => {
      cancelAnimationFrame(frame);
      const ph = ctx.current?.photo;
      if (ph) { ph.mesh.geometry.dispose(); (ph.mesh.material as THREE.Material).dispose(); ph.texture.dispose(); }
      ro.disconnect();
      controls.dispose();
      geometry.dispose(); material.dispose(); floorGeo.dispose(); floorMat.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctx.current = null;
    };
  }, [figure]);

  // shape: re-derive from the canonical base
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const p = deform(figure, weights, { mode: 'keep_girths', height_cm: heightCm });
    (c.geometry.attributes.position as THREE.BufferAttribute).copyArray(p).needsUpdate = true;
    c.geometry.computeVertexNormals();
    c.geometry.computeBoundingSphere();
    c.positions = p;
    if (c.photo) fillPhotoPositions(c.photo, p);
    c.render();
  }, [figure, weights, heightCm]);

  // colours per shell
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const byPart = [palette.skin, palette.skin, palette.top, palette.bottom, palette.shoes].map((hex) => new THREE.Color(hex));
    const arr = c.colors.array as Float32Array;
    for (let i = 0; i < figure.part.length; i++) {
      const col = byPart[figure.part[i]] ?? byPart[PART.head];
      arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b;
    }
    c.colors.needsUpdate = true;
    c.render();
  }, [figure, palette]);

  // photographed garment on the upper shell: photo triangles move to their own textured mesh
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    let cancelled = false;
    const clear = () => {
      if (!c.photo) return;
      c.scene.remove(c.photo.mesh);
      c.photo.mesh.geometry.dispose(); (c.photo.mesh.material as THREE.Material).dispose(); c.photo.texture.dispose();
      c.photo = null;
      c.geometry.setIndex(new THREE.BufferAttribute(figure.index, 1));
    };
    if (!print) { clear(); c.render(); return; }
    const mapping = mapPhotoToTop({ base: figure.base, index: figure.index, part: figure.part, topCode: PART.top, headCode: PART.head, armpit: figure.landmarks.armpit }, print.anchors);
    new THREE.TextureLoader().loadAsync(print.textureUrl).then((texture) => {
      if (cancelled || !ctx.current) { texture.dispose(); return; }
      clear();
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = c.renderer.capabilities.getMaxAnisotropy();
      const nT = mapping.photoTriangles.length;
      const corners = new Uint32Array(nT * 3);
      mapping.photoTriangles.forEach((t, j) => { for (let k = 0; k < 3; k++) corners[j * 3 + k] = figure.index[t * 3 + k]!; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nT * 9), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(mapping.uv, 2));
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texture, flatShading: true, roughness: 0.75, metalness: 0 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      c.photo = { mesh, corners, texture };
      fillPhotoPositions(c.photo, c.positions);
      // the base mesh keeps every triangle except the ones now drawn with the photo
      const drop = new Uint8Array(figure.index.length / 3);
      for (const t of mapping.photoTriangles) drop[t] = 1;
      const kept: number[] = [];
      for (let t = 0; t < drop.length; t++) if (!drop[t]) kept.push(figure.index[t * 3]!, figure.index[t * 3 + 1]!, figure.index[t * 3 + 2]!);
      c.geometry.setIndex(kept);
      c.scene.add(mesh);
      c.render();
    }).catch(() => { /* texture missing: the garment stays in its base colour */ });
    return () => { cancelled = true; };
  }, [figure, print]);

  // camera: preset views; the user can orbit freely in between
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const h = heightCm / 100;
    const [sx, sz] = VIEW_DIR[view];
    // fit both the height and the T-pose arm span (~1.1 × height) into the frame, whatever the aspect
    const halfV = Math.tan(THREE.MathUtils.degToRad(c.camera.fov / 2));
    const d = Math.max(4.4 * (h / 1.75), (0.6 * h) / (halfV * c.camera.aspect) + 0.4);
    c.controls.target.set(0, h * 0.52, 0);
    c.camera.position.set(sx * d, h * 0.62, sz * d);
    c.controls.update();
    c.render();
    // heightCm intentionally excluded: changing the slider must not snap the camera back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, viewNonce, figure]);

  return <div ref={host} className="fit-canvas" aria-label="3D-модель: перетащите, чтобы повернуть; колесо — приблизить" role="img" />;
}

function fillPhotoPositions(photo: { mesh: THREE.Mesh; corners: Uint32Array }, p: Float32Array) {
  const attr = photo.mesh.geometry.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < photo.corners.length; i++) {
    const v = photo.corners[i]!;
    arr[i * 3] = p[v * 3]!; arr[i * 3 + 1] = p[v * 3 + 1]!; arr[i * 3 + 2] = p[v * 3 + 2]!;
  }
  attr.needsUpdate = true;
  photo.mesh.geometry.computeVertexNormals();
  photo.mesh.geometry.computeBoundingSphere();
}
