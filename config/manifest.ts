/*
 * The web app manifest: what the browser shows when the app is installed.
 *
 * Every address is relative (scope, start_url, icons), so the installed app works from whatever
 * folder it is served from. The colour is the Nocturne ground of src/ost/styles/theme.css
 * (config/manifest.spec.ts keeps the two, and index.html's theme-color, the same).
 */
import type { ManifestOptions } from 'vite-plugin-pwa';

/** `--ost-nocturne-ground`: the app's background, and so its splash and title-bar colour. */
export const APP_COLOUR = '#161826';

export const manifest: Partial<ManifestOptions> = {
  name: 'Ombuto OST',
  short_name: 'Ombuto OST',
  description: 'A local-first Opportunity Solution Tree editor. Your tree stays on this device.',
  lang: 'en',
  id: './',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: APP_COLOUR,
  theme_color: APP_COLOUR,
  icons: [
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
