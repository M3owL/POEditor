import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Source lives in ./app; the built site is published to the repository root.
 *
 * Reason: GitHub Pages on this repo serves from "main / (root)". Putting the
 * Vite template at the root instead would hand the browser a
 * <script src="/POEditor/assets/index-*.js"> that only exists after a build --
 * a blank page. This way the site works with no repository settings at all.
 *
 * Custom domain? Set VITE_BASE=/ .
 */
const BASE = process.env.VITE_BASE ?? '/POEditor/';

export default defineConfig({
  root: 'app',
  base: BASE,
  plugins: [react()],
  build: {
    outDir: path.resolve(repoRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5174,
    open: true,
  },
});
