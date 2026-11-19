import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
    return null;
  }
}

function requireFile(relative) {
  const file = join(dist, relative.replace(/^\//, ''));
  if (!existsSync(file)) {
    fail(`Missing dist/${relative}`);
    return false;
  }
  if (statSync(file).size === 0) fail(`dist/${relative} is empty`);
  return true;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function checkHtml(relative) {
  if (!requireFile(relative)) return;
  const html = readFileSync(join(dist, relative), 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    if (!reference || reference.startsWith('#') || reference.startsWith('mailto:')) continue;
    if (/^https?:\/\//i.test(reference)) {
      fail(`${relative} loads remote content: ${reference}`);
      continue;
    }
    if (!reference.startsWith('/')) continue;
    requireFile(reference);
  }
  if (/\beval\s*\(/.test(html) || /new\s+Function\s*\(/.test(html)) fail(`${relative} contains remote-code patterns`);
}

const manifest = readJson(join(dist, 'manifest.json'));
const pkg = readJson(join(root, 'package.json'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest.json must use Manifest V3');
  if (manifest.version !== '1.1.0') fail(`manifest version is ${manifest.version}, expected 1.1.0`);
  if (pkg?.version !== manifest.version) fail('package.json and manifest.json versions differ');
  if (!changelog.includes(`## [${manifest.version}]`)) fail('CHANGELOG.md has no entry for the current version');
  if ((manifest.description ?? '').length > 132) fail('manifest description exceeds 132 characters');
  if ((manifest.name ?? '').length > 75) fail('manifest name exceeds 75 characters');
  for (const permission of ['storage', 'alarms', 'notifications', 'sidePanel', 'scripting', 'activeTab']) {
    if (!manifest.permissions?.includes(permission)) fail(`manifest is missing the ${permission} permission`);
  }
  if (!manifest.optional_host_permissions?.includes('https://*/*')) {
    fail('manifest must declare optional HTTPS host access for page capture and auto-send');
  }
  if (manifest.background?.service_worker !== 'service-worker.js') fail('unexpected service worker path');
  if (manifest.side_panel?.default_path !== 'logs.html') fail('side_panel.default_path must be logs.html');
  if (manifest.action?.default_popup !== 'popup.html') fail('action.default_popup must be popup.html');
  if (manifest.options_ui?.page !== 'options.html') fail('options_ui.page must be options.html');
  if (!manifest.commands?.['open-logs']) fail('manifest is missing the open-logs command');
  if (!manifest.externally_connectable?.ids?.includes('*'))
    fail('externally_connectable.ids must allow extension messages');
  if (!manifest.content_security_policy?.extension_pages?.includes("script-src 'self'")) {
    fail('extension CSP must restrict scripts to self');
  }
  if (/unsafe-eval|unsafe-inline/.test(manifest.content_security_policy?.extension_pages ?? '')) {
    fail('extension CSP must not allow unsafe-eval or unsafe-inline');
  }
  for (const icon of Object.values(manifest.icons ?? {})) requireFile(icon);
  checkHtml('popup.html');
  checkHtml('logs.html');
  checkHtml('options.html');
  requireFile(manifest.background.service_worker);
  requireFile('page-capture.js');
  requireFile('page-capture-main.js');
  requireFile('privacy_policy.html');
}

const scripts = [
  ...walk(join(dist, 'assets')),
  join(dist, 'service-worker.js'),
  join(dist, 'page-capture.js'),
  join(dist, 'page-capture-main.js'),
].filter((file) => existsSync(file) && extname(file) === '.js');

for (const file of scripts) {
  const source = readFileSync(file, 'utf8');
  const relative = file.slice(dist.length + 1);
  if (/\beval\s*\(/.test(source)) fail(`${relative} contains eval()`);
  if (/new\s+Function\s*\(/.test(source)) fail(`${relative} contains new Function()`);
  for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const specifier = match[1];
    const target = resolve(dirname(file), specifier);
    if (!existsSync(target)) fail(`${relative} imports a missing file: ${specifier}`);
  }
}

const contentScripts = ['page-capture.js', 'page-capture-main.js'];
for (const name of contentScripts) {
  const contentScriptPath = join(dist, name);
  if (!existsSync(contentScriptPath)) continue;
  const content = readFileSync(contentScriptPath, 'utf8');
  if (/^\s*import\s/m.test(content)) fail(`${name} must be a classic IIFE without top-level imports`);
}

const iconSizes = { 'icons/icon16.png': 16, 'icons/icon32.png': 32, 'icons/icon48.png': 48, 'icons/icon128.png': 128 };
for (const [relative, expected] of Object.entries(iconSizes)) {
  const file = join(dist, relative);
  if (!existsSync(file)) {
    fail(`Missing ${relative}`);
    continue;
  }
  const bytes = readFileSync(file);
  if (bytes.readUInt32BE(0) !== 0x89504e47) fail(`${relative} is not a PNG`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== expected || height !== expected)
    fail(`${relative} is ${width}x${height}, expected ${expected}x${expected}`);
}

const all = walk(dist);
const totalBytes = all.reduce((sum, file) => sum + statSync(file).size, 0);
if (all.length === 0) fail('dist/ is empty');

if (errors.length > 0) {
  console.error('dist verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `dist/ verified: ${all.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB, manifest v${manifest.version}`,
);
