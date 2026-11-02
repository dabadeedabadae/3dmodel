/**
 * Entry point of the standalone dev page. Error handling lives here:
 *  - WebGL unavailable -> readable message instead of a blank page
 *  - uncaught errors / rejections -> red banner with the message
 *  - `window.__pg` exposes readiness + handles for scripts/render.mjs
 */

import './ui/styles.css';
import { startApp, type AppHandle } from './ui/app';

declare global {
  interface Window {
    __pg?: { ready: boolean; error: string | null; app: AppHandle | null };
  }
}

window.__pg = { ready: false, error: null, app: null };

function banner(message: string) {
  let b = document.getElementById('pg-error');
  if (!b) {
    b = document.createElement('div');
    b.id = 'pg-error';
    document.body.prepend(b);
  }
  b.textContent = message;
  window.__pg!.error = message;
}

window.addEventListener('error', (e) => banner(`Error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => banner(`Unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`));

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function boot() {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  if (!webglAvailable()) {
    root.innerHTML = '<div class="pg-nowebgl"><h1>WebGL is not available</h1><p>The 3D preview needs WebGL. Enable hardware acceleration or try another browser. The rest of FitCast does not depend on this page.</p></div>';
    banner('WebGL unavailable');
    window.__pg!.ready = true;
    return;
  }
  try {
    const app = startApp(root);
    window.__pg!.app = app;
    window.addEventListener('beforeunload', () => app.dispose());
    // mark ready after two frames so the first render is on screen
    requestAnimationFrame(() => requestAnimationFrame(() => (window.__pg!.ready = true)));
  } catch (err) {
    banner(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    window.__pg!.ready = true;
    throw err;
  }
}

boot();
