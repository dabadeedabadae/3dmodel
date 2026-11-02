import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));

// Standalone dev page for the photo-garments module.
// Port 5174 avoids the Next.js frontend (3001) and the NestJS backend (3000).
export default defineConfig({
  base: './',
  server: { port: 5174, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { input: { index: path.resolve(here, 'index.html'), garment: path.resolve(here, 'garment.html') } },
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
