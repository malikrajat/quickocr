import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suite = join(root, 'tests', 'unit');

function discover(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...discover(full));
    else if (entry.name.endsWith('.test.mjs')) files.push(full);
  }
  return files.sort();
}

const files = discover(suite);
if (files.length === 0) {
  console.error('No unit test files found in tests/unit.');
  process.exit(1);
}

let passed = 0;
let failed = 0;

const stream = run({ files, isolation: 'none', timeout: 120_000 });

for await (const event of stream) {
  const name = event.data?.name ?? '';
  if (event.type === 'test:pass' && !event.data?.skip) {
    passed += 1;
    if (!name.includes('.test.mjs')) console.log(`  ok   ${name}`);
  }
  if (event.type === 'test:fail') {
    failed += 1;
    const error = event.data?.details?.error;
    console.error(`  FAIL ${name}`);
    if (error?.message) console.error(`       ${error.message.split('\n')[0]}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed (${files.length} files)`);
process.exit(failed > 0 ? 1 : 0);
