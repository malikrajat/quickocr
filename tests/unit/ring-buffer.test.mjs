import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendEntries,
  countLevels,
  createLogEntry,
  entriesToCsv,
  entriesToText,
  filterEntries,
  pruneLogs,
} from '../../src/core/ring-buffer.ts';

function entry(overrides) {
  return createLogEntry({
    level: 'error',
    source: 'extension',
    message: 'Something failed',
    ...overrides,
  });
}

test('creates sanitised entries with stable fields', () => {
  const item = createLogEntry({
    level: 'warn',
    source: 'page',
    message: 'Authorization: Bearer supersecret',
    details: 'api_key=abc123',
    context: { authorization: 'Bearer xyz', status: 500 },
    url: 'https://example.com/checkout?token=secret',
  });
  assert.equal(item.level, 'warn');
  assert.equal(item.source, 'page');
  assert.equal(item.url, 'https://example.com/checkout');
  assert.equal(item.context.authorization, '[REDACTED]');
  assert.equal(item.context.status, 500);
  assert.ok(!JSON.stringify(item).includes('supersecret'));
  assert.ok(!JSON.stringify(item).includes('abc123'));
  assert.equal(typeof item.fingerprint, 'string');
  assert.equal(item.fingerprint.length, 8);
});

test('invalid levels and sources fall back safely', () => {
  const item = createLogEntry({ level: 'nope', source: 'nope', message: 'x' });
  assert.equal(item.level, 'error');
  assert.equal(item.source, 'extension');
});

test('truncates oversized text', () => {
  const item = entry({ message: 'x'.repeat(10_000), details: 'y'.repeat(20_000) });
  assert.ok(item.message.length <= 4001);
  assert.ok(item.details.length <= 12_001);
});

test('prunes by retention and maximum', () => {
  const now = Date.now();
  const entries = [
    entry({ timestamp: now - 10 * 24 * 60 * 60 * 1000, message: 'old' }),
    entry({ timestamp: now - 2 * 24 * 60 * 60 * 1000, message: 'middle' }),
    entry({ timestamp: now - 1000, message: 'new' }),
  ];
  const pruned = pruneLogs(entries, { retentionDays: 7, maxEntries: 2 }, now);
  assert.equal(pruned.length, 2);
  assert.deepEqual(
    pruned.map((item) => item.message),
    ['middle', 'new'],
  );
});

test('applies the byte budget to the oldest entries', () => {
  const now = Date.now();
  const many = Array.from({ length: 6 }, (_, index) => ({
    id: `id-${index}`,
    timestamp: now - index,
    level: 'error',
    source: 'extension',
    message: 'x',
    details: 'z'.repeat(1_000_000),
    fingerprint: 'abcdef12',
  }));
  const pruned = pruneLogs(many, { retentionDays: 7, maxEntries: 100 }, now);
  assert.ok(pruned.length < many.length);
  assert.ok(pruned.length >= 1);
});

test('appendEntries trims to the ring buffer', () => {
  const now = Date.now();
  const result = appendEntries(
    [entry({ timestamp: now - 2000 })],
    [entry({ timestamp: now })],
    {
      retentionDays: 7,
      maxEntries: 1,
    },
    now,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].timestamp, now);
});

test('counts levels including failures', () => {
  const counts = countLevels([
    entry({ level: 'error' }),
    entry({ level: 'fatal' }),
    entry({ level: 'warn' }),
    entry({ level: 'info' }),
  ]);
  assert.equal(counts.total, 4);
  assert.equal(counts.failures, 2);
  assert.equal(counts.byLevel.warn, 1);
});

test('filters by query, level, source and time range', () => {
  const now = Date.now();
  const entries = [
    entry({ timestamp: now - 1000, level: 'error', source: 'page', message: 'Checkout exploded' }),
    entry({ timestamp: now - 2 * 60 * 60 * 1000, level: 'warn', source: 'network', message: 'HTTP 404' }),
    entry({ timestamp: now - 3 * 24 * 60 * 60 * 1000, level: 'error', source: 'extension', message: 'Old failure' }),
  ];
  assert.equal(
    filterEntries(entries, { query: 'checkout', level: 'all', source: 'all', timeRange: 'all' }, now).length,
    1,
  );
  assert.equal(filterEntries(entries, { query: '', level: 'error', source: 'page', timeRange: 'all' }, now).length, 1);
  assert.equal(filterEntries(entries, { query: '', level: 'all', source: 'network', timeRange: 'all' }, now).length, 1);
  assert.equal(filterEntries(entries, { query: '', level: 'all', source: 'all', timeRange: '1h' }, now).length, 1);
  assert.equal(filterEntries(entries, { query: '', level: 'all', source: 'all', timeRange: '24h' }, now).length, 2);
});

test('serialises text and CSV safely', () => {
  const item = entry({ message: 'He said "hi", ok', details: 'line 1\nline 2', url: 'https://example.com/x' });
  const text = entriesToText([item]);
  assert.ok(text.includes('ERROR'));
  assert.ok(text.includes('https://example.com/x'));
  const csv = entriesToCsv([item]);
  assert.ok(csv.includes('""hi""'));
  assert.ok(csv.startsWith('"timestamp","level","source"'));
  const formula = entriesToCsv([entry({ message: '=HYPERLINK("https://evil.test")' })]);
  assert.ok(formula.includes('"\'=HYPERLINK'));
});
