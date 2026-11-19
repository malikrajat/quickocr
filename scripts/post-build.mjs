import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run "pnpm install" and "pnpm icons" first.`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`  ${to.slice(dist.length + 1)}  ${(statSync(to).size / 1024).toFixed(1)} kB`);
}

console.log('Copying static extension files into dist/');
copy(join(root, 'manifest.json'), join(dist, 'manifest.json'));
copy(join(root, 'privacy_policy.html'), join(dist, 'privacy_policy.html'));

const iconsDir = join(root, 'icons');
for (const icon of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) {
  copy(join(iconsDir, icon), join(dist, 'icons', icon));
}

const requiredRuntime = [
  'service-worker.js',
  'page-capture.js',
  'page-capture-main.js',
  'popup.html',
  'logs.html',
  'options.html',
];
for (const file of requiredRuntime) {
  if (!existsSync(join(dist, file))) {
    throw new Error(`Missing ${file} in dist/. The Vite build did not finish correctly.`);
  }
}

const assets = join(dist, 'assets');
if (existsSync(assets)) {
  console.log(`  assets/ contains ${readdirSync(assets).length} file(s)`);
}

console.log('\nStatic copy complete. Load the unpacked extension from:');
console.log(`  ${dist}`);
