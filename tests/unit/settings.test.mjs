import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from '../../src/core/settings.ts';

test('defaults capture only failures and keep auto-send off', () => {
  const settings = normalizeSettings(undefined);
  assert.deepEqual(settings.levels, ['error', 'fatal']);
  assert.equal(settings.captureExtensionErrors, true);
  assert.equal(settings.captureUnhandledRejections, true);
  assert.equal(settings.capturePageErrors, false);
  assert.equal(settings.captureNetworkFailures, false);
  assert.equal(settings.autoOpen, 'on-error');
  assert.equal(settings.maxEntries, 500);
  assert.equal(settings.retentionDays, 7);
  assert.equal(settings.autoSend.enabled, false);
  assert.equal(settings.autoSend.consentAt, null);
  assert.deepEqual(settings.externalApi.approvedExtensions, []);
  assert.deepEqual(settings.externalApi.approvedOrigins, []);
});

test('normalizes invalid levels, numbers and enums', () => {
  const settings = normalizeSettings({
    levels: ['warn', 'nope', 'error'],
    maxEntries: 99999,
    retentionDays: 0,
    networkFailureMinStatus: 999,
    autoOpen: 'sometimes',
    emailRecipient: 'not-an-email',
  });
  assert.deepEqual(settings.levels, ['warn', 'error']);
  assert.equal(settings.maxEntries, 2000);
  assert.equal(settings.retentionDays, 1);
  assert.equal(settings.networkFailureMinStatus, 599);
  assert.equal(settings.autoOpen, DEFAULT_SETTINGS.autoOpen);
  assert.equal(settings.emailRecipient, '');
});

test('empty levels fall back to the failure defaults', () => {
  assert.deepEqual(normalizeSettings({ levels: [] }).levels, ['error', 'fatal']);
  assert.deepEqual(normalizeSettings({ levels: ['invalid'] }).levels, ['error', 'fatal']);
});

test('auto-send requires consent and a valid HTTPS endpoint', () => {
  const valid = normalizeSettings({
    autoSend: {
      enabled: true,
      endpoint: 'https://logs.example.com/ingest',
      consentAt: 1700000000000,
      mode: 'scheduled',
      intervalMinutes: 30,
      minLevel: 'warn',
      retryCount: 4,
      retryDelaySeconds: 60,
      batchSize: 30,
    },
  });
  assert.equal(valid.autoSend.enabled, true);
  assert.equal(valid.autoSend.mode, 'scheduled');
  assert.equal(valid.autoSend.intervalMinutes, 30);
  assert.equal(valid.autoSend.minLevel, 'warn');

  const noConsent = normalizeSettings({
    autoSend: { enabled: true, endpoint: 'https://logs.example.com/ingest' },
  });
  assert.equal(noConsent.autoSend.enabled, false);

  const http = normalizeSettings({
    autoSend: { enabled: true, endpoint: 'http://logs.example.com/ingest', consentAt: 1 },
  });
  assert.equal(http.autoSend.enabled, false);
  assert.equal(http.autoSend.endpoint, 'http://logs.example.com/ingest');
});

test('normalizes extension ids and approved origins', () => {
  const settings = normalizeSettings({
    externalApi: {
      approvedExtensions: ['a'.repeat(32), 'A'.repeat(32), 'z'.repeat(32), 'short'],
      approvedOrigins: ['https://Example.com/path', 'https://example.com', 'http://localhost:3000', 'http://evil.test'],
    },
  });
  assert.deepEqual(settings.externalApi.approvedExtensions, ['a'.repeat(32)]);
  assert.deepEqual(settings.externalApi.approvedOrigins, ['http://localhost:3000', 'https://example.com']);
});

test('validateSettings reports an auto-send endpoint problem', () => {
  const settings = normalizeSettings({
    autoSend: { enabled: true, endpoint: 'https://logs.example.com/ingest', consentAt: 1 },
  });
  settings.autoSend.endpoint = 'http://insecure.example.com';
  const issues = validateSettings(settings);
  assert.ok(issues.some((issue) => issue.field === 'autoSend.endpoint'));
});
