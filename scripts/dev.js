/**
 * Watch build for both bundles.
 *
 * `vite build --watch` only watches a single config, and the content script has
 * to be built separately (it must stay a classic-script bundle), so both
 * watchers are started here from the Vite API.
 *
 * Static files (manifest, icons, Tesseract runtime) are only copied by
 * `pnpm build`; run that once before starting the watcher.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function watch(configFile) {
  await build({
    root,
    configFile: resolve(root, configFile),
    build: { watch: {} },
  });
}

console.log('Watching src/ - press Ctrl+C to stop.');
await watch('vite.config.ts');
await watch('vite.content.config.ts');
await watch('vite.offscreen.config.ts');
