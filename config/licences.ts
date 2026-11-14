/*
 * Ships the licence texts with the app: LICENSE, NOTICE and THIRD-PARTY-NOTICES.md are copied into
 * the build output, so the copyright notices of the bundled third-party code and font travel with
 * every copy of dist/ (their licences ask for that; minifying strips them from the code itself).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Plugin } from 'vite';

export const LICENCE_FILES = ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md'];

export function licenceFilesPlugin(): Plugin {
  let root = '.';
  return {
    name: 'ombuto-ost:licence-files',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      for (const fileName of LICENCE_FILES) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(root, fileName), 'utf8') });
      }
    },
  };
}
