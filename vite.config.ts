import { URL, fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// `base: './'` keeps every asset URL relative, so the built app runs from any sub-path
// (GitHub Pages project site, a personal site folder, or a plain static file server).
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
