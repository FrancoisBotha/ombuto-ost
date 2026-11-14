import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'happy-dom',
      exclude: ['**/node_modules/**', 'dist/**'],
      // The export reads the palette from the text of theme.css (`?raw`); other CSS stays skipped.
      css: { include: [/ost\/styles\/theme\.css/] },
      setupFiles: [fileURLToPath(new URL('./src/test-setup.ts', import.meta.url))],
    },
  }),
);
