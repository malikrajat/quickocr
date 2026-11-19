import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

test('manifest and package share the 1.1.0 version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.1.0');
  assert.equal(pkg.version, '1.1.0');
  assert.ok(changelog.includes('## [1.1.0]'));
});

test('manifest declares the required MV3 surfaces and permissions', () => {
  assert.equal(manifest.background.service_worker, 'service-worker.js');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.options_ui.page, 'options.html');
  assert.equal(manifest.options_ui.open_in_tab, true);
  assert.equal(manifest.side_panel.default_path, 'logs.html');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.permissions.includes('notifications'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
});

test('public API and shortcut are declared', () => {
  assert.ok(manifest.externally_connectable.matches.includes('https://*/*'));
  assert.ok(manifest.externally_connectable.ids.includes('*'));
  assert.equal(manifest.commands['open-logs'].suggested_key.default, 'Alt+Shift+L');
});

test('security policy forbids remote script and unsafe eval', () => {
  const policy = manifest.content_security_policy.extension_pages;
  assert.ok(policy.includes("script-src 'self'"));
  assert.ok(!policy.includes('unsafe-eval'));
  assert.ok(!policy.includes('unsafe-inline'));
  assert.ok(!JSON.stringify(manifest).includes('http://localhost/remote'));
});

test('store-facing text stays within limits', () => {
  assert.ok(manifest.name.length <= 75);
  assert.ok(manifest.description.length <= 132);
});

test('referenced entry files and icons exist', () => {
  for (const file of [
    'popup.html',
    'logs.html',
    'options.html',
    'privacy_policy.html',
    'src/background/service-worker.ts',
    'src/content/page-capture.ts',
    'src/content/page-capture-main.ts',
    'vite.mainworld.config.ts',
  ]) {
    assert.ok(existsSync(join(root, file)), `${file} should exist`);
  }
  for (const size of [16, 32, 48, 128]) {
    const file = join(root, 'icons', `icon${size}.png`);
    assert.ok(existsSync(file), `${file} should exist`);
    const bytes = readFileSync(file);
    assert.equal(bytes.readUInt32BE(0), 0x89504e47);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test('development scripts cover lint, typecheck, tests and packaging', () => {
  for (const script of ['build', 'lint', 'format:check', 'typecheck', 'test', 'test:e2e', 'zip', 'verify:dist']) {
    assert.equal(typeof pkg.scripts[script], 'string', `package.json should define ${script}`);
  }
  assert.ok(pkg.devDependencies['@playwright/test']);
  assert.ok(pkg.devDependencies.typescript);
  assert.ok(pkg.devDependencies['@biomejs/biome']);
  assert.equal(pkg.dependencies, undefined);
});
