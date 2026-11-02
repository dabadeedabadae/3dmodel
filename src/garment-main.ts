/** Entry for garment.html — the sequential photo pipeline (stages 05–07, checkpoint B). */
import './ui/styles.css';
import './pipeline/pipeline.css';
import { GarmentApp } from './pipeline/garmentApp';

declare global {
  interface Window {
    __pgp?: { ready: boolean; error: string | null; app: GarmentApp | null };
  }
}
window.__pgp = { ready: false, error: null, app: null };
function banner(message: string) {
  let b = document.getElementById('pg-error');
  if (!b) {
    b = document.createElement('div');
    b.id = 'pg-error';
    document.body.prepend(b);
  }
  b.textContent = message;
  window.__pgp!.error = message;
}
window.addEventListener('error', (e) => banner(`Error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => banner(`Unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`));
const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
const app = new GarmentApp(root);
window.__pgp.app = app;
window.addEventListener('beforeunload', () => app.dispose());
window.__pgp.ready = true;
