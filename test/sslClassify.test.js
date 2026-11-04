import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCertificate } from '../src/services/sslChecker.js';
import { selectExpiryThreshold } from '../src/services/alerts.js';

const now = new Date('2026-11-04T12:00:00.000Z');

function certificate({ days = 120, san = 'DNS:example.com' } = {}) {
  const validTo = new Date(now.getTime() + days * 86_400_000).toUTCString();
  return {
    subject: { CN: 'example.com' },
    issuer: { O: 'Test CA', CN: 'Test CA' },
    subjectaltname: san,
    valid_from: new Date(now.getTime() - 86_400_000).toUTCString(),
    valid_to: validTo,
  };
}

test('valid certificate is ok and gets issuer and days', () => {
  const result = classifyCertificate({
    hostname: 'example.com',
    cert: certificate(),
    authorized: true,
    authorizationError: null,
    protocol: 'TLSv1.3',
    now,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.daysLeft, 120);
  assert.equal(result.issuer, 'Test CA');
  assert.equal(result.tlsVersion, 'TLSv1.3');
});

test('certificate expiring within 30 days is expiring', () => {
  const result = classifyCertificate({
    hostname: 'example.com',
    cert: certificate({ days: 20 }),
    authorized: true,
    protocol: 'TLSv1.3',
    now,
  });
  assert.equal(result.status, 'expiring');
  assert.equal(result.daysLeft, 20);
});

test('expired certificate is invalid', () => {
  const result = classifyCertificate({
    hostname: 'example.com',
    cert: certificate({ days: -2 }),
    authorized: true,
    protocol: 'TLSv1.3',
    now,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.errorType, 'expired');
});

test('hostname mismatch is invalid', () => {
  const result = classifyCertificate({
    hostname: 'other.example.com',
    cert: certificate(),
    authorized: true,
    protocol: 'TLSv1.3',
    now,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.errorType, 'hostname_mismatch');
});

test('self-signed chain is invalid', () => {
  const result = classifyCertificate({
    hostname: 'example.com',
    cert: certificate(),
    authorized: false,
    authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    protocol: 'TLSv1.3',
    now,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.errorType, 'self_signed');
});

test('untrusted chain is invalid', () => {
  const result = classifyCertificate({
    hostname: 'example.com',
    cert: certificate(),
    authorized: false,
    authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    protocol: 'TLSv1.3',
    now,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.errorType, 'untrusted_chain');
});

test('old TLS version is flagged as expiring warning', () => {
  const result = classifyCertificate({
    hostname: 'example.com',
    cert: certificate({ days: 100 }),
    authorized: true,
    protocol: 'TLSv1.0',
    now,
  });
  assert.equal(result.status, 'expiring');
  assert.ok(result.issues.includes('tls_old'));
});

test('expiry threshold picks the nearest crossed threshold', () => {
  assert.equal(selectExpiryThreshold(31), null);
  assert.equal(selectExpiryThreshold(30), 30);
  assert.equal(selectExpiryThreshold(20), 30);
  assert.equal(selectExpiryThreshold(14), 14);
  assert.equal(selectExpiryThreshold(10), 14);
  assert.equal(selectExpiryThreshold(7), 7);
  assert.equal(selectExpiryThreshold(3), 7);
  assert.equal(selectExpiryThreshold(1), 1);
  assert.equal(selectExpiryThreshold(0), 1);
  assert.equal(selectExpiryThreshold(-1), null);
});
