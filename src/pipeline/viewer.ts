/**
 * Stage 12 viewer — the garment alone (no body). Rotate / zoom (OrbitControls),
 * fixed views front / back / three-quarter, texture toggle original vs pixel.
 * Pixel texture: NearestFilter magnification + mipmaps (no shimmer at distance).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildTShirt, updateTShirt, type TShirtMesh } from '../templates/tshirt/buildTShirt';
import type { TShirtParams } from '../templates/tshirt/params';

export type GarmentView = 'front' | 'back' | 'threequarter' | 'threequarter_back' | 'left' | 'right';

export class GarmentViewer {
  readonly root: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private shirt: TShirtMesh;
  private material: THREE.MeshStandardMaterial;
  private texOriginal: THREE.DataTexture | null = null;
  private texPixel: THREE.DataTexture | null = null;
  private mode: 'original' | 'pixel' | 'none' = 'none';
  private raf = 0;

  constructor(params: Partial<TShirtParams>, size = { w: 520, h: 520 }) {
    this.root = document.createElement('div');
    this.root.className = 'pg-viewer';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(size.w, size.h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#eef0f4', 1);
    this.renderer.domElement.style.width = `${size.w}px`;
    this.renderer.domElement.style.height = `${size.h}px`;
    this.root.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(30, size.w / size.h, 0.05, 50);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8bcc8', 1.0));
    const key = new THREE.DirectionalLight('#ffffff', 1.4);
    key.position.set(2, 4, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 0.5);
    fill.position.set(-3, 1, -4);
    this.scene.add(fill);
    this.shirt = buildTShirt(params);
    this.material = new THREE.MeshStandardMaterial({ color: '#d7d9de', roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    // all five island groups use the same material
    const mesh = new THREE.Mesh(this.shirt.geometry, [this.material, this.material, this.material, this.material, this.material]);
    this.scene.add(mesh);
    this.setView('front');
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  setParams(params: Partial<TShirtParams>): void {
    updateTShirt(this.shirt, params);
  }

  private makeTexture(data: Uint8ClampedArray, size: number, pixel: boolean): THREE.DataTexture {
    const t = new THREE.DataTexture(new Uint8Array(data.buffer.slice(0)), size, size, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = true; // atlas row 0 = v=1 (image-like)
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = pixel ? THREE.NearestFilter : THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  setTextures(original: { data: Uint8ClampedArray; size: number } | null, pixel: { data: Uint8ClampedArray; size: number } | null): void {
    this.texOriginal?.dispose();
    this.texPixel?.dispose();
    this.texOriginal = original ? this.makeTexture(original.data, original.size, false) : null;
    this.texPixel = pixel ? this.makeTexture(pixel.data, pixel.size, true) : null;
    this.setMode(this.mode === 'none' ? (this.texPixel ? 'pixel' : 'original') : this.mode);
  }

  setMode(mode: 'original' | 'pixel' | 'none'): void {
    this.mode = mode;
    const t = mode === 'original' ? this.texOriginal : mode === 'pixel' ? this.texPixel : null;
    this.material.map = t;
    this.material.color.set(t ? '#ffffff' : '#d7d9de');
    this.material.needsUpdate = true;
  }
  getMode() {
    return this.mode;
  }

  setView(view: GarmentView): void {
    this.shirt.geometry.computeBoundingBox();
    const bb = this.shirt.geometry.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    const s = bb.getSize(new THREE.Vector3());
    const dist = Math.max(s.x, s.y, s.z) * 2.3;
    const pos: Record<GarmentView, [number, number, number]> = {
      front: [0, 0, dist],
      back: [0, 0, -dist],
      threequarter: [dist * 0.7, dist * 0.3, dist * 0.7],
      threequarter_back: [-dist * 0.7, dist * 0.3, -dist * 0.7],
      left: [dist, 0, 0],
      right: [-dist, 0, 0],
    };
    const p = pos[view];
    this.camera.position.set(c.x + p[0], c.y + p[1], c.z + p[2]);
    this.controls.target.copy(c);
    this.controls.update();
  }

  /** PNG data URL of the current frame (preserveDrawingBuffer on). */
  snapshot(): string {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.shirt.geometry.dispose();
    this.material.dispose();
    this.texOriginal?.dispose();
    this.texPixel?.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
