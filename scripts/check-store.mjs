/**
 * Chrome Web Store readiness check.
 *
 *   node scripts/check-store.mjs        # checks the built extension in dist/
 *
 * Everything here mirrors a rule that Chrome or the Web Store actually
 * enforces: manifest keys Chrome accepts, the name/description lengths the
 * store dashboard allows, the icon sizes it requires, the files the manifest
 * points at, and the "no remote code" rule. Run by `pnpm build`, so a package
 * that cannot be published fails the build instead of the review.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const problems = [];
const warnings = [];
const notes = [];

const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);
const info = (message) => notes.push(message);
const read = (path) => readFileSync(path, 'utf8');

/**
 * Manifest keys Chrome documents for Manifest V3. An unknown key is a warning
 * rather than a failure: Chrome ignores it, but the store review may ask about
 * it, and it usually means a typo.
 */
const MANIFEST_KEYS = new Set([
  'action',
  'background',
  'chrome_settings_overrides',
  'chrome_url_overrides',
  'commands',
  'content_scripts',
  'content_security_policy',
  'cross_origin_embedder_policy',
  'cross_origin_opener_policy',
  'declarative_net_request',
  'default_locale',
  'description',
  'devtools_page',
  'event_rules',
  'externally_connectable',
  'file_browser_handlers',
  'file_handlers',
  'homepage_url',
  'host_permissions',
  'icons',
  'import',
  'incognito',
  'input_components',
  'key',
  'manifest_version',
  'minimum_chrome_version',
  'name',
  'oauth2',
  'omnibox',
  'optional_host_permissions',
  'optional_permissions',
  'options_page',
  'options_ui',
  'permissions',
  'requirements',
  'sandbox',
  'short_name',
  'side_panel',
  'storage',
  'tts_engine',
  'update_url',
  'version',
  'version_name',
  'web_accessible_resources',
]);

const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json is missing. Run "pnpm build" first.');
  process.exit(1);
}

const manifest = JSON.parse(read(manifestPath));
const pkg = JSON.parse(read(join(root, 'package.json')));

// ---- manifest basics -------------------------------------------------------
if (manifest.manifest_version !== 3) fail('manifest_version must be 3 (the store no longer accepts Manifest V2).');
if (!manifest.name) fail('name is required.');
if (manifest.name && manifest.name.length > 45) {
  fail(`name is ${manifest.name.length} characters; the store dashboard allows 45.`);
}
if (!manifest.description) fail('description is required.');
if (manifest.description && manifest.description.length > 132) {
  fail(`description is ${manifest.description.length} characters; Chrome shows at most 132.`);
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) {
  fail(`version "${manifest.version}" must be 1-4 dot-separated integers.`);
}
if (manifest.version !== pkg.version) {
  fail(`package.json version ${pkg.version} does not match the manifest version ${manifest.version}.`);
}
if (!manifest.minimum_chrome_version) {
  warn('minimum_chrome_version is missing; declaring it prevents installs on browsers the code cannot run in.');
}
if (!manifest.homepage_url) warn('homepage_url is missing; it is shown on the store listing.');
if (!manifest.short_name) warn('short_name is missing; Chrome uses it where the full name does not fit.');

for (const key of Object.keys(manifest)) {
  if (!MANIFEST_KEYS.has(key)) warn(`unrecognised manifest key "${key}" - Chrome ignores it.`);
}

// ---- icons -----------------------------------------------------------------
for (const size of ['16', '32', '48', '128']) {
  const file = manifest.icons?.[size];
  if (!file) {
    fail(`icons.${size} is missing; Chrome uses 16/32/48/128.`);
    continue;
  }
  const path = join(dist, file);
  if (!existsSync(path)) {
    fail(`icon ${file} does not exist in the package.`);
    continue;
  }
  const header = readFileSync(path).subarray(16, 24);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  if (width !== Number(size) || height !== Number(size)) {
    warn(`icon ${file} is ${width}x${height} but is declared as ${size}x${size}.`);
  }
}
const storeIcon = join(root, 'store', 'icon-128.png');
if (!existsSync(join(dist, 'icons', 'icon128.png'))) fail('icons/icon128.png is required by the store upload.');
if (!existsSync(storeIcon)) info('store/icon-128.png not present (optional copy of the 128px icon for the dashboard).');

// ---- files the manifest points at ------------------------------------------
const referenced = [
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  manifest.options_page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);
for (const file of new Set(referenced)) {
  if (!existsSync(join(dist, file))) fail(`manifest points at missing file: ${file}`);
}

for (const file of [
  'service-worker.js',
  'content-selection.js',
  'offscreen.html',
  'offscreen.js',
  'settings.html',
  'settings.js',
  'privacy_policy.html',
]) {
  if (!existsSync(join(dist, file))) fail(`the extension is incomplete: dist/${file} is missing.`);
}

// The OCR host must stay a classic script: Chrome does not run module scripts
// inside offscreen documents, and the content script is injected as classic too.
for (const file of ['content-selection.js', 'offscreen.js']) {
  const path = join(dist, file);
  if (!existsSync(path)) continue;
  const source = read(path);
  if (/^\s*(import|export)\s/m.test(source)) {
    fail(`${file} contains ES module syntax; it is loaded as a classic script.`);
  }
}

// ---- security rules --------------------------------------------------------
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (/'unsafe-inline'|'unsafe-eval'/.test(csp)) {
  fail(`extension_pages CSP is too permissive: ${csp}`);
}
if (/https?:\/\//.test(csp)) fail(`extension_pages CSP allows remote scripts: ${csp}`);
if (!/wasm-unsafe-eval/.test(csp)) warn('CSP does not allow wasm-unsafe-eval; the WASM core needs it.');

for (const page of ['settings.html', 'offscreen.html', 'privacy_policy.html']) {
  const path = join(dist, page);
  if (!existsSync(path)) continue;
  for (const match of read(path).matchAll(/<script[^>]*src=["']([^"']+)["']/gi)) {
    if (/^(https?:)?\/\//i.test(match[1])) fail(`${page} loads remote code (${match[1]}); the store forbids it.`);
  }
}

const war = manifest.web_accessible_resources ?? [];
const warAll = JSON.stringify(war).includes('<all_urls>');
if (warAll) warn('web_accessible_resources exposes files to <all_urls>; keep the list as small as possible.');

// ---- store listing assets --------------------------------------------------
const storeFiles = [
  'promo-small-tile-440x280.png',
  'screenshot-1-selection-1280x800.png',
  'screenshot-2-result-1280x800.png',
  'screenshot-3-settings-1280x800.png',
];
for (const file of storeFiles) {
  const path = join(root, 'store', file);
  if (!existsSync(path)) {
    warn(`store asset missing: store/${file}`);
    continue;
  }
  info(`store/${file} (${Math.round(statSync(path).size / 1024)} kB)`);
}
if (!existsSync(join(root, 'docs', 'store-listing.md')))
  warn('docs/store-listing.md is missing; it holds the listing copy and keywords.');
if (!existsSync(join(dist, 'privacy_policy.html')))
  warn('privacy_policy.html is not in the package; the store listing needs a policy URL.');

// ---- report ----------------------------------------------------------------
const permissions = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];
console.log(`QuickOCR ${manifest.version} - Chrome Web Store readiness`);
console.log(`  name        : ${manifest.name} (${manifest.name?.length ?? 0}/45)`);
console.log(`  description : ${manifest.description?.length ?? 0}/132`);
console.log(`  permissions : ${permissions.join(', ') || 'none'}`);
console.log(`  min chrome  : ${manifest.minimum_chrome_version ?? 'undeclared'}`);
console.log('');
for (const line of notes) console.log(`  ok    ${line}`);
for (const line of warnings) console.log(`  warn  ${line}`);
for (const line of problems) console.log(`  FAIL  ${line}`);
console.log('');

if (problems.length) {
  console.log(`${problems.length} blocking problem(s) - fix these before uploading to the Web Store.`);
  process.exit(1);
}
console.log(`Ready to upload.${warnings.length ? ` ${warnings.length} warning(s) to review.` : ''}`);
