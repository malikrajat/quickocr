import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { normalizeSettings } from '../src/core/settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = join(root, 'dist');
const imagesDir = join(root, 'docs', 'images');

const now = Date.now();
const entries = [
  {
    id: 'doc-1',
    timestamp: now - 18_000,
    level: 'error',
    source: 'extension',
    message: 'Checkout request failed: HTTP 500 from /api/orders',
    details:
      'Error: Checkout request failed\n    at submitOrder (src/checkout.ts:184:11)\n    at async onSubmit (src/checkout.ts:92:5)',
    context: { mechanism: 'client-page', page: 'options', route: '/checkout', status: 500, durationMs: 812 },
    url: 'https://shop.example.com/checkout',
    fingerprint: '9e2a1f88',
  },
  {
    id: 'doc-2',
    timestamp: now - 74_000,
    level: 'error',
    source: 'network',
    message: 'POST https://api.example.com/v1/payments returned HTTP 502',
    details: 'Gateway returned an invalid upstream response.',
    context: { method: 'POST', status: 502, durationMs: 2418, requestUrl: 'https://api.example.com/v1/payments' },
    url: 'https://shop.example.com/checkout',
    fingerprint: 'b13d99ac',
  },
  {
    id: 'doc-3',
    timestamp: now - 9 * 60_000,
    level: 'warn',
    source: 'page',
    message: 'Unhandled rejection: request aborted by navigation',
    context: { reasonType: 'AbortError' },
    url: 'https://shop.example.com/cart',
    fingerprint: 'c01aa244',
  },
  {
    id: 'doc-4',
    timestamp: now - 26 * 60_000,
    level: 'error',
    source: 'api',
    message: 'Partner extension reported a webhook validation failure',
    details: 'ValidationError: signature header did not match',
    context: { mechanism: 'external-api', senderId: 'partner-extension', status: 401 },
    url: 'https://app.example.com/webhooks',
    fingerprint: '44fe8b10',
  },
  {
    id: 'doc-5',
    timestamp: now - 51 * 60_000,
    level: 'fatal',
    source: 'extension',
    message: 'Service worker could not persist the ring buffer',
    details: 'QuotaExceededError: chrome.storage.local quota exceeded',
    context: { mechanism: 'error', code: 'QUOTA_EXCEEDED' },
    url: 'chrome-extension://loglens/service-worker.js',
    fingerprint: '70bd2c13',
  },
];

const settings = normalizeSettings({
  autoOpen: 'on-error',
  notifyOnError: true,
  emailRecipient: 'team@example.com',
  autoSend: {
    enabled: false,
    endpoint: '',
    mode: 'scheduled',
    intervalMinutes: 30,
    minLevel: 'error',
    retryCount: 3,
    retryDelaySeconds: 30,
    batchSize: 50,
    consentAt: null,
  },
  externalApi: {
    approvedExtensions: ['abcdefghijklmnopabcdefghijklmnop'],
    approvedOrigins: ['https://app.example.com'],
    allowAllExtensions: false,
  },
});

async function main() {
  await mkdir(imagesDir, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), 'log-lens-docs-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.LOG_LENS_CHANNEL ?? 'chromium',
    headless: process.env.HEADLESS === '1' || Boolean(process.env.CI),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;

    await worker.evaluate(
      async ({ settingsValue, entryValues }) => {
        await chrome.storage.local.set({
          ll_settings: settingsValue,
          ll_logs: entryValues,
          ll_state: {
            installedAt: Date.now() - 86_400_000,
            lastErrorAt: Date.now() - 18_000,
            lastOpenAt: Date.now() - 120_000,
            lastNotifyAt: Date.now() - 120_000,
            lastAutoSendAt: null,
            lastAutoSendStatus: 'idle',
            lastAutoSendError: null,
            lastScheduledQueuedAt: Date.now() - 30 * 60_000,
            lastScheduledCoveredThrough: Date.now() - 31 * 60_000,
            pendingRetryAt: null,
          },
        });
      },
      { settingsValue: settings, entryValues: entries },
    );

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 430, height: 660 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('#latest-list .popup-entry');
    await popup.screenshot({ path: join(imagesDir, 'popup.png') });
    await popup.close();

    const logs = await context.newPage();
    await logs.setViewportSize({ width: 1280, height: 900 });
    await logs.goto(`chrome-extension://${extensionId}/logs.html?source=docs`);
    await logs.waitForSelector('.log-entry');
    await logs.locator('.log-head').first().click();
    await logs.screenshot({ path: join(imagesDir, 'logs-panel.png') });
    await logs.close();

    const options = await context.newPage();
    await options.setViewportSize({ width: 1100, height: 1000 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForSelector('#settings-form');
    await options.screenshot({ path: join(imagesDir, 'options.png') });
    await options.locator('#autosend-enabled').check();
    await options.locator('#autosend-consent').check();
    await options.locator('#autosend-endpoint').fill('https://logs.example.com/ingest');
    await options.locator('#autosend-fields').scrollIntoViewIfNeeded();
    await options.waitForTimeout(350);
    await options.screenshot({ path: join(imagesDir, 'auto-send.png') });
    await options.locator('#api-title').scrollIntoViewIfNeeded();
    await options.screenshot({ path: join(imagesDir, 'public-api.png') });
    await options.close();

    console.log(`Wrote documentation images to ${imagesDir}`);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
