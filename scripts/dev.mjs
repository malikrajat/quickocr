import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [];

function run(label, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`${label} exited with ${code}`);
  });
  children.push(child);
}

run('pages', [vite, 'build', '--watch']);
run('content-script', [vite, 'build', '--config', 'vite.content.config.ts', '--watch']);
run('main-world', [vite, 'build', '--config', 'vite.mainworld.config.ts', '--watch']);

setTimeout(() => {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'post-build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) console.error('Static copy failed; run "pnpm build" once first.');
}, 1600);

function stop() {
  for (const child of children) child.kill();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Watching extension sources. Press Ctrl+C to stop.');
