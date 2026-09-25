/**
 * Copies everything Rollup does not emit: the manifest, icons, HTML pages and
 * the Tesseract runtime (worker, WASM core and the English model).
 *
 * All of it ships inside the package. The extension never downloads executable
 * code at runtime, which is what Chrome Web Store policy requires.
 */

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const require = createRequire(import.meta.url);

const LANG_CODE = 'eng';
const LANG_URL = `https://tessdata.projectnaptha.com/4.0.0/${LANG_CODE}.traineddata.gz`;
const cacheFile = join(root, 'scripts', '.cache', `${LANG_CODE}.traineddata.gz`);

function copy(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Missing ${from}. Run "pnpm install" before building.`);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  const relative = to.slice(dist.length + 1);
  console.log(`  ${relative}  ${(statSync(to).size / 1024).toFixed(0)} kB`);
}

async function ensureLanguageModel() {
  const to = join(dist, 'tesseract', 'lang-data', `${LANG_CODE}.traineddata.gz`);
  if (existsSync(cacheFile) && statSync(cacheFile).size > 0) {
    copy(cacheFile, to);
    return;
  }

  console.log(`  downloading ${LANG_CODE}.traineddata.gz from tessdata.projectnaptha.com ...`);
  const response = await fetch(LANG_URL);
  if (!response.ok) {
    throw new Error(`Could not download the English model (HTTP ${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('The downloaded English model is empty.');
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, bytes);
  copy(cacheFile, to);
}

console.log('Copying static files into dist/');

copy(join(root, 'manifest.json'), join(dist, 'manifest.json'));
copy(join(root, 'privacy_policy.html'), join(dist, 'privacy_policy.html'));
copy(join(root, 'src', 'settings', 'settings.html'), join(dist, 'settings.html'));
copy(join(root, 'src', 'offscreen.html'), join(dist, 'offscreen.html'));

for (const icon of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) {
  copy(join(root, 'icons', icon), join(dist, 'icons', icon));
}

// Tesseract runtime. These paths are the ones src/lib/engine.ts asks for, so
// they must stay in step: workerPath, corePath and langPath.
const tesseractDist = join(dirname(require.resolve('tesseract.js/package.json')), 'dist');
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));

copy(join(tesseractDist, 'worker.min.js'), join(dist, 'tesseract', 'worker.min.js'));
copy(
  join(coreDir, 'tesseract-core-simd-lstm.wasm.js'),
  join(dist, 'tesseract', 'core', 'tesseract-core-simd-lstm.wasm.js'),
);
copy(join(coreDir, 'tesseract-core-simd-lstm.wasm'), join(dist, 'tesseract', 'core', 'tesseract-core-simd-lstm.wasm'));
copy(join(coreDir, 'LICENSE'), join(dist, 'tesseract', 'core', 'LICENSE'));

await ensureLanguageModel();

console.log('\nBuild complete. Load the unpacked extension from:');
console.log(`  ${dist}`);
