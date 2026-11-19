import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRetry,
  computeRetryDelayMs,
  entriesForAutoSend,
  isNetworkFailure,
  levelForHttpStatus,
  needsImmediateSend,
  scheduledTickDue,
  shouldAutoOpen,
  shouldAutoSend,
  shouldCapture,
  shouldNotify,
} from '../../src/core/policy.ts';
import { normalizeSettings } from '../../src/core/settings.ts';

const defaults = normalizeSettings(undefined);

test('captures only error and fatal by default', () => {
  assert.equal(shouldCapture(defaults, { kind: 'extension', level: 'error' }), true);
  assert.equal(shouldCapture(defaults, { kind: 'extension', level: 'fatal' }), true);
  assert.equal(shouldCapture(defaults, { kind: 'extension', level: 'warn' }), false);
  assert.equal(shouldCapture(defaults, { kind: 'extension', level: 'info' }), false);
});

test('page, network and API capture respect toggles and levels', () => {
  assert.equal(shouldCapture(defaults, { kind: 'page', level: 'error' }), false);
  assert.equal(shouldCapture(defaults, { kind: 'network', level: 'error' }), false);
  assert.equal(shouldCapture(defaults, { kind: 'api', level: 'error' }), true);
  const configured = normalizeSettings({
    levels: ['warn', 'error'],
    capturePageErrors: true,
    captureNetworkFailures: true,
  });
  assert.equal(shouldCapture(configured, { kind: 'page', level: 'warn' }), true);
  assert.equal(shouldCapture(configured, { kind: 'network', level: 'warn' }), true);
  assert.equal(shouldCapture(configured, { kind: 'network', level: 'debug' }), false);
});

test('auto-open honours never, on-error, always and the cooldown', () => {
  const now = Date.now();
  assert.equal(shouldAutoOpen('never', 'fatal', null, now, 30_000), false);
  assert.equal(shouldAutoOpen('on-error', 'warn', null, now, 30_000), false);
  assert.equal(shouldAutoOpen('on-error', 'error', null, now, 30_000), true);
  assert.equal(shouldAutoOpen('on-error', 'error', now - 1000, now, 30_000), false);
  assert.equal(shouldAutoOpen('always', 'warn', null, now, 30_000), true);
});

test('notifications only fire for failures and respect cooldown', () => {
  const now = Date.now();
  assert.equal(shouldNotify(defaults, 'warn', null, now, 30_000), false);
  assert.equal(shouldNotify(defaults, 'error', null, now, 30_000), true);
  assert.equal(shouldNotify(defaults, 'error', now - 1000, now, 30_000), false);
  assert.equal(shouldNotify(normalizeSettings({ notifyOnError: false }), 'fatal', null, now, 30_000), false);
});

test('auto-send is opt-in and filtered by minimum level', () => {
  assert.equal(shouldAutoSend(defaults, 'fatal'), false);
  const enabled = normalizeSettings({
    autoSend: { enabled: true, endpoint: 'https://logs.example.com/ingest', consentAt: 1, minLevel: 'warn' },
  });
  assert.equal(shouldAutoSend(enabled, 'warn'), true);
  assert.equal(shouldAutoSend(enabled, 'info'), false);
  const entries = [{ level: 'warn' }, { level: 'info' }, { level: 'error' }];
  assert.equal(entriesForAutoSend(enabled, entries).length, 2);
  assert.equal(needsImmediateSend(enabled, [{ level: 'error' }]), true);
  assert.equal(needsImmediateSend(defaults, [{ level: 'error' }]), false);
});

test('reads the HTTP failure threshold and levels', () => {
  assert.equal(isNetworkFailure(0, 400), true);
  assert.equal(isNetworkFailure(399, 400), false);
  assert.equal(isNetworkFailure(400, 400), true);
  assert.equal(isNetworkFailure(500, 400), true);
  assert.equal(levelForHttpStatus(0), 'error');
  assert.equal(levelForHttpStatus(404), 'warn');
  assert.equal(levelForHttpStatus(500), 'error');
  assert.equal(levelForHttpStatus(200), 'info');
});

test('retry backoff doubles and caps at fifteen minutes', () => {
  assert.equal(computeRetryDelayMs(1, 30), 30_000);
  assert.equal(computeRetryDelayMs(2, 30), 60_000);
  assert.equal(computeRetryDelayMs(5, 30), 480_000);
  assert.equal(computeRetryDelayMs(10, 30), 900_000);
  assert.equal(canRetry(3, 3), true);
  assert.equal(canRetry(4, 3), false);
});

test('scheduled ticks respect the configured interval', () => {
  const scheduled = normalizeSettings({
    autoSend: {
      enabled: true,
      endpoint: 'https://logs.example.com/ingest',
      consentAt: 1,
      mode: 'scheduled',
      intervalMinutes: 15,
    },
  });
  const now = Date.now();
  assert.equal(scheduledTickDue(scheduled, null, now), true);
  assert.equal(scheduledTickDue(scheduled, now - 1000, now), false);
  assert.equal(scheduledTickDue(scheduled, now - 16 * 60 * 1000, now), true);
});
