import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const output = join(root, `log-lens-${pkg.version}.zip`);

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('No built extension found. Run "pnpm build" first.');
  process.exit(1);
}

if (existsSync(output)) rmSync(output, { force: true });

try {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Compress-Archive -Path '${dist}\\*' -DestinationPath '${output}' -Force`],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('zip', ['-r', '-q', output, '.'], { cwd: dist, stdio: 'inherit' });
  }
  console.log(`Packaged ${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`);
} catch (error) {
  console.error('Failed to create the ZIP:', error instanceof Error ? error.message : error);
  process.exit(1);
}
