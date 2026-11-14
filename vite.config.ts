import { URL, fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { cspPlugin } from './config/csp.ts';
import { licenceFilesPlugin } from './config/licences.ts';
import { manifest } from './config/manifest.ts';

// `base: './'` keeps every asset URL relative, so the built app runs from any sub-path
// (GitHub Pages project site, a personal site folder, or a plain static file server).
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    // The Content Security Policy <meta>, and the build check that no other origin is named.
    cspPlugin(),
    // LICENSE, NOTICE and THIRD-PARTY-NOTICES.md travel with the built app.
    licenceFilesPlugin(),
    // Offline: a generated service worker (Workbox generateSW) that precaches every built file.
    VitePWA({
      // 'prompt', never 'autoUpdate': a new version waits until the user chooses Reload, so the
      // code is never swapped under an open tree (see src/pwa/update-watcher.ts).
      registerType: 'prompt',
      // The app registers the worker itself; nothing is injected into index.html (no inline script).
      injectRegister: false,
      manifest,
      // The icons are already matched by the glob below: do not list them twice.
      includeManifestIcons: false,
      workbox: {
        // Everything the build emits, fonts included: after the first visit no request needs the network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
