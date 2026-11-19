import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmailParts,
  buildExportDocument,
  buildMailtoUrl,
  buildSendPayload,
  exportJson,
  fileBaseName,
} from '../../src/core/payload.ts';

function entry(overrides = {}) {
  return {
    id: 'entry-1',
    timestamp: 1700000000000,
    level: 'error',
    source: 'extension',
    message: 'Authorization: Bearer abc123',
    details: 'stack line',
    context: { password: 'hunter2', status: 500 },
    fingerprint: 'abcdef12',
    ...overrides,
  };
}

test('builds a redacted versioned send payload without settings or endpoints', () => {
  const payload = buildSendPayload([entry()], 'immediate', 1700000001000);
  const json = JSON.stringify(payload);
  assert.equal(payload.schema, 'loglens/v1');
  assert.equal(payload.count, 1);
  assert.equal(payload.reason, 'immediate');
  assert.ok(!json.includes('abc123'));
  assert.ok(!json.includes('hunter2'));
  assert.ok(!json.includes('endpoint'));
  assert.ok(json.includes('stack line'));
});

test('builds an export document with explicit privacy flags', () => {
  const document = buildExportDocument([entry()], 1700000001000);
  assert.equal(document.schema, 'loglens/export/v1');
  assert.equal(document.count, 1);
  assert.equal(document.privacy.redacted, true);
  assert.equal(document.privacy.cookiesCaptured, false);
  assert.equal(document.privacy.pageContentCaptured, false);
  const parsed = JSON.parse(exportJson([entry()], 1700000001000));
  assert.equal(parsed.entries.length, 1);
});

test('builds email parts and a mailto URL', () => {
  const parts = buildEmailParts([entry()], 'team@example.com', 1700000001000);
  assert.equal(parts.to, 'team@example.com');
  assert.ok(parts.subject.includes('Log Lens'));
  assert.ok(parts.body.includes('Log Lens error report'));
  assert.ok(!parts.body.includes('abc123'));
  const url = buildMailtoUrl(parts);
  assert.ok(url.startsWith('mailto:team%40example.com?'));
  assert.ok(url.includes('subject='));
  assert.ok(url.includes('body='));
});

test('file names are sortable and filesystem safe', () => {
  const name = fileBaseName(1700000001000);
  assert.match(name, /^log-lens-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
});
