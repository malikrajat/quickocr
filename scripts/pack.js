// Pack the built extension for the Chrome Web Store.
//
// Exposed as `pnpm zip`, not `pnpm pack`: the latter is a built-in pnpm command
// that creates an npm tarball instead of the Web Store archive.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const outputZip = join(root, 'quickocr.zip');

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error('Error: no built extension found. Run "pnpm build" first.');
  process.exit(1);
}

try {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${distDir}\\*' -DestinationPath '${outputZip}' -Force`],
    { stdio: 'inherit' },
  );
  console.log(`Extension packed: ${outputZip}`);
} catch (error) {
  console.error('Failed to create zip:', error instanceof Error ? error.message : error);
  process.exit(1);
}
