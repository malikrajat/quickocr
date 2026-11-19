import assert from 'node:assert/strict';
import test from 'node:test';
import {
  errorToDiagnostic,
  isSensitiveKey,
  redactContext,
  redactText,
  sanitizeUrlForLog,
} from '../../src/core/redact.ts';

test('redacts authorization and bearer values', () => {
  const output = redactText('Authorization: Bearer super.secret.token');
  assert.ok(output.includes('[REDACTED]'));
  assert.ok(!output.includes('super.secret.token'));
  assert.ok(!redactText('Authorization: Bearer abc').includes('abc'));
});

test('does not treat ordinary bearer/basic phrases as credentials', () => {
  assert.equal(redactText('Bearer of bad news'), 'Bearer of bad news');
  assert.equal(redactText('Basic authentication'), 'Basic authentication');
});

test('redacts key/value secrets in plain text and JSON', () => {
  const output = redactText('{"password":"hunter2","x-api-key":"abc123","note":"Token expired","status":500}');
  assert.ok(!output.includes('hunter2'));
  assert.ok(!output.includes('abc123'));
  assert.ok(output.includes('Token expired'));
  assert.ok(output.includes('500'));
});

test('redacts common provider token formats and JWTs', () => {
  const openai = redactText(`key=sk-live-abcdefghijklmnopqrstuvwx`);
  const github = redactText('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  const jwt = redactText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz');
  assert.ok(!openai.includes('abcdefghijklmnopqrstuvwx'));
  assert.ok(!github.includes('ghp_'));
  assert.ok(!jwt.includes('eyJhbGciOiJIUzI1NiJ9'));
});

test('redacts private key blocks and URL credentials', () => {
  const key = redactText('-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----');
  assert.ok(key.includes('[REDACTED PRIVATE KEY]'));
  assert.ok(!key.includes('secret'));
  const url = redactText('https://user:pa55word@example.com/path');
  assert.ok(!url.includes('pa55word'));
});

test('does not over-redact ordinary words', () => {
  assert.equal(redactText('Token expired'), 'Token expired');
  assert.equal(redactText('Password reset failed'), 'Password reset failed');
  assert.equal(redactText('The author is here'), 'The author is here');
  assert.equal(redactText('status: 500'), 'status: 500');
  assert.equal(isSensitiveKey('monkey'), false);
  assert.equal(isSensitiveKey('my_api_key'), true);
  assert.equal(isSensitiveKey('authorization'), true);
});

test('removes query strings, fragments and credentials from logged URLs', () => {
  const url = sanitizeUrlForLog('https://user:pass@example.com/a/b?token=secret&x=1#frag');
  assert.equal(url, 'https://example.com/a/b');
});

test('redacts nested context values and sensitive keys', () => {
  const context = redactContext({
    authorization: 'Bearer abc',
    nested: { password: 'hunter2', status: 401 },
    path: '/checkout',
    count: 3,
    note: 'Token expired',
  });
  assert.equal(context.authorization, '[REDACTED]');
  assert.equal(context.path, '/checkout');
  assert.equal(context.count, 3);
  assert.equal(context.note, 'Token expired');
  assert.ok(!JSON.stringify(context).includes('hunter2'));
});

test('ignores prototype-polluting context keys', () => {
  const context = redactContext(JSON.parse('{"__proto__":{"polluted":true},"safe":1,"constructor":{"x":1}}'));
  assert.equal(context.safe, 1);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(context, '__proto__'), false);
  assert.equal(Object.hasOwn(context, 'constructor'), false);
});

test('turns thrown values into redacted diagnostics', () => {
  const diagnostic = errorToDiagnostic(new Error('failed with token=abc123'));
  assert.ok(diagnostic.message.includes('failed'));
  assert.ok(!diagnostic.message.includes('abc123'));
  assert.ok(diagnostic.details?.includes('Error'));
});
