import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium, expect, type Page, test, type Worker } from '@playwright/test';
import { normalizeSettings } from '../../src/core/settings.ts';
import type { LogEntry, LogLensSettings } from '../../src/core/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = resolve(root, 'dist');

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let userDataDir: string;

function makeEntry(index: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `e2e-entry-${index}`,
    timestamp: Date.now() - index * 1000,
    level: 'error',
    source: 'extension',
    message: `E2E failure ${index}`,
    details: `Error: E2E failure ${index}\n    at test (chrome-extension://e2e/test.js:1:1)`,
    context: { mechanism: 'e2e', status: 500 + index },
    url: 'https://example.com/checkout',
    fingerprint: `e2e${index.toString().padStart(5, '0')}`,
    ...overrides,
  };
}

function testSettings(overrides: Partial<LogLensSettings> = {}): LogLensSettings {
  return normalizeSettings({
    autoOpen: 'never',
    notifyOnError: false,
    ...overrides,
  });
}

async function resetStorage(settings: LogLensSettings = testSettings(), entries: LogEntry[] = []): Promise<void> {
  await worker.evaluate(
    async ({ settingsValue, entryValues }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        ll_settings: settingsValue,
        ll_logs: entryValues,
      });
    },
    { settingsValue: settings, entryValues: entries },
  );
}

async function openLogsPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/logs.html?source=e2e`);
  await page.waitForSelector('#log-shell');
  return page;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'log-lens-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.LOG_LENS_CHANNEL ?? 'chromium',
    headless: process.env.HEADLESS === '1' || Boolean(process.env.CI),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
  });
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  worker = serviceWorker;
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetStorage();
});

test('loads the Manifest V3 extension at version 1.1.0', async () => {
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.version).toBe('1.1.0');
  expect(manifest.side_panel?.default_path).toBe('logs.html');
});

test('renders seeded logs and filters them in the viewer', async () => {
  await resetStorage(testSettings(), [
    makeEntry(1, { message: 'Checkout failed', level: 'error' }),
    makeEntry(2, {
      message: 'Network request failed',
      level: 'error',
      source: 'network',
      url: 'https://example.com/api',
    }),
  ]);
  const page = await openLogsPage();
  try {
    await expect(page.locator('#stat-total')).toHaveText('2');
    await expect(page.locator('.log-entry')).toHaveCount(2);
    await page.locator('#search-input').fill('checkout');
    await expect(page.locator('.log-entry')).toHaveCount(1);
    await expect(page.locator('.log-message')).toContainText('Checkout failed');
    await page.locator('#reset-filters').click();
    await expect(page.locator('.log-entry')).toHaveCount(2);
  } finally {
    await page.close();
  }
});

test('shows the popup summary and latest failure', async () => {
  await resetStorage(testSettings(), [makeEntry(1, { message: 'Popup visible failure' })]);
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#stat-errors')).toHaveText('1');
    await expect(page.locator('#latest-list .popup-entry')).toHaveCount(1);
    await expect(page.locator('.popup-entry-message')).toContainText('Popup visible failure');
  } finally {
    await page.close();
  }
});

test('options page keeps page capture and auto-send off by default', async () => {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#mode-pill')).toHaveText('Local only');
    await expect(page.locator('#capture-page')).not.toBeChecked();
    await expect(page.locator('#capture-network')).not.toBeChecked();
    await expect(page.locator('#autosend-enabled')).not.toBeChecked();
    await expect(page.locator('#autosend-consent')).not.toBeChecked();
  } finally {
    await page.close();
  }
});

test('captures a client error into the ring buffer and updates the badge', async () => {
  await resetStorage();
  const page = await openLogsPage();
  try {
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: 'LL_CAPTURE_CLIENT_ERROR',
        payload: { message: 'E2E captured extension failure', page: 'e2e' },
      });
    });
    await expect.poll(async () => worker.evaluate(() => chrome.action.getBadgeText({}))).toBe('1');
    await expect(page.locator('.log-entry')).toHaveCount(1);
    await expect(page.locator('.log-message')).toContainText('E2E captured extension failure');
  } finally {
    await page.close();
  }
});

test('MAIN-world capture reports page errors and network failures without secrets', async () => {
  const page = await context.newPage();
  try {
    await page.route('https://example.test/**', async (route) => {
      if (route.request().url().includes('/fail')) {
        await route.fulfill({ status: 500, contentType: 'text/plain', body: 'upstream failed' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>MAIN world test</h1></body></html>',
      });
    });
    await page.goto('https://example.test/');
    await page.evaluate(() => {
      const target = window as unknown as { __logLensEvents: unknown[] };
      target.__logLensEvents = [];
      window.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { source?: string; type?: string; event?: unknown } | null;
        if (data?.source === 'loglens-main' && data.type === 'event' && data.event) {
          target.__logLensEvents.push(data.event);
        }
      });
    });
    await page.addScriptTag({ path: join(root, 'dist', 'page-capture-main.js') });
    await page.evaluate(() => {
      window.postMessage(
        {
          source: 'loglens-isolated',
          type: 'config',
          config: {
            capturePageErrors: true,
            captureNetworkFailures: true,
            networkFailureMinStatus: 400,
            levels: ['error', 'warn'],
          },
        },
        '*',
      );
    });

    await page.evaluate(() => {
      window.setTimeout(() => {
        throw new Error('MAIN page boom token=abc123');
      }, 0);
    });
    await page.evaluate(async () => {
      try {
        await fetch('https://example.test/fail?token=supersecret', {
          method: 'POST',
          headers: { 'X-Secret': 'header-secret' },
          body: 'password=hunter2',
        });
      } catch {
        // The response is a 500, not a network exception.
      }
    });

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const target = window as unknown as { __logLensEvents: Array<{ kind?: string }> };
          return target.__logLensEvents.map((event) => event.kind);
        }),
      )
      .toEqual(expect.arrayContaining(['page-error', 'network']));

    const events = await page.evaluate(() => {
      const target = window as unknown as { __logLensEvents: Array<Record<string, unknown>> };
      return target.__logLensEvents;
    });
    const pageError = events.find((event) => event.kind === 'page-error');
    const network = events.find((event) => event.kind === 'network');
    expect(pageError?.message).toContain('MAIN page boom');
    expect(network?.context).toMatchObject({ method: 'POST', status: 500 });
    expect(network?.context).toMatchObject({ requestUrl: 'https://example.test/fail' });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('supersecret');
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('"headers"');
    expect(serialized).not.toContain('"body"');
  } finally {
    await page.close();
  }
});

test('captures the log panel as a PNG and previews the auto-send payload', async () => {
  await resetStorage(testSettings(), [makeEntry(1, { message: 'Panel capture failure' })]);
  const page = await openLogsPage();
  try {
    await expect(page.locator('.log-entry')).toHaveCount(1);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#capture-panel').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^log-lens-panel-\d+\.png$/);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    if (downloadPath) {
      const bytes = readFileSync(downloadPath);
      expect(bytes.length).toBeGreaterThan(1000);
      expect(bytes.readUInt32BE(0)).toBe(0x89504e47);
    }

    await page.locator('#preview-send').click();
    await expect(page.locator('#preview-dialog')).toHaveAttribute('open', '');
    await expect(page.locator('#preview-payload')).toContainText('"schema": "loglens/v1"');
    await expect(page.locator('#preview-payload')).toContainText('Panel capture failure');
  } finally {
    await page.close();
  }
});

test('clears logs from the viewer after confirmation', async () => {
  await resetStorage(testSettings(), [makeEntry(1, { message: 'Clear me' })]);
  const page = await openLogsPage();
  try {
    await expect(page.locator('.log-entry')).toHaveCount(1);
    await page.locator('#clear-logs').click();
    await expect(page.locator('#clear-dialog')).toHaveAttribute('open', '');
    await page.locator('#clear-confirm').click();
    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('.log-entry')).toHaveCount(0);
    const stored = await worker.evaluate(async () => chrome.storage.local.get('ll_logs'));
    expect(stored.ll_logs).toEqual([]);
  } finally {
    await page.close();
  }
});
