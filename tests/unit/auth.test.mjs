import assert from 'node:assert/strict';
import test from 'node:test';
import { decideExternalSender } from '../../src/core/auth.ts';

const api = {
  approvedExtensions: ['a'.repeat(32)],
  approvedOrigins: ['https://app.example.com'],
  allowAllExtensions: false,
};

test('approves listed extensions and the receiving extension itself', () => {
  assert.equal(decideExternalSender(api, { id: 'a'.repeat(32) }, 'own').allowed, true);
  assert.equal(decideExternalSender(api, { id: 'own' }, 'own').reason, 'approved-extension');
  assert.equal(decideExternalSender(api, { id: 'b'.repeat(32) }, 'own').allowed, false);
});

test('can allow every installed extension', () => {
  const decision = decideExternalSender({ ...api, allowAllExtensions: true }, { id: 'b'.repeat(32) }, 'own');
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'all-extensions');
});

test('requires explicit approval for web origins', () => {
  assert.equal(
    decideExternalSender(api, { origin: 'https://app.example.com', id: 'b'.repeat(32) }, 'own').allowed,
    true,
  );
  assert.equal(decideExternalSender(api, { origin: 'https://evil.example', id: 'b'.repeat(32) }, 'own').allowed, false);
  assert.equal(
    decideExternalSender(api, { origin: 'http://app.example.com', id: 'b'.repeat(32) }, 'own').allowed,
    false,
  );
  assert.equal(decideExternalSender(api, { url: 'https://app.example.com/page' }, 'own').reason, 'approved-origin');
});

test('a web page cannot bypass origin approval with the receiver id', () => {
  assert.equal(decideExternalSender(api, { origin: 'https://evil.example', id: 'own' }, 'own').allowed, false);
  assert.equal(decideExternalSender(api, { url: 'https://evil.example/page', id: 'own' }, 'own').allowed, false);
  assert.equal(
    decideExternalSender(api, { origin: 'https://app.example.com', id: 'own' }, 'own').reason,
    'approved-origin',
  );
});

test('rejects senders without an id or origin', () => {
  assert.equal(decideExternalSender(api, {}, 'own').reason, 'missing-sender');
});
