/// <reference types="vitest/config" />
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

const shared = fileURLToPath(new URL('../shared', import.meta.url));
// `npm run dev` serves the page with hot reload and forwards the live data to a running dashboard server
// (`npm run demo` or `npm start` in the repository root, on port 3000 unless DASHBOARD says otherwise).
const dashboard = process.env.DASHBOARD || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {alias: {'@shared': shared}},
  server: {
    fs: {allow: ['..']},
    proxy: {
      '/api': dashboard,
      '/ws': {target: dashboard.replace(/^http/, 'ws'), ws: true},
    },
  },
  build: {outDir: 'dist', emptyOutDir: true, sourcemap: true, target: 'es2022'},
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
  },
});
