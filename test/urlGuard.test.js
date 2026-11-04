import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIp, normalizeTargetUrl, TargetInputError } from '../src/services/urlGuard.js';
import { parseAcceptedStatusCodes, isStatusAccepted } from '../src/lib/statusCodes.js';

test('normalizeTargetUrl adds https and normalizes key', () => {
  const info = normalizeTargetUrl('Example.com/');
  assert.equal(info.url, 'https://example.com');
  assert.equal(info.urlKey, 'https://example.com');
  assert.equal(info.hostname, 'example.com');
  assert.equal(info.port, 443);
  assert.equal(info.protocol, 'https:');
});

test('normalizeTargetUrl keeps path, query and custom port', () => {
  const info = normalizeTargetUrl('http://example.com:8080/health?x=1#section');
  assert.equal(info.url, 'http://example.com:8080/health?x=1');
  assert.equal(info.urlKey, 'http://example.com:8080/health?x=1');
  assert.equal(info.port, 8080);
});

test('normalizeTargetUrl rejects credentials and non-http schemes', () => {
  assert.throws(() => normalizeTargetUrl('https://user:pass@example.com'), TargetInputError);
  assert.throws(() => normalizeTargetUrl('ftp://example.com'), TargetInputError);
  assert.throws(() => normalizeTargetUrl(''), TargetInputError);
});

test('normalizeTargetUrl rejects invalid host characters', () => {
  assert.throws(() => normalizeTargetUrl('https://exa_mple.com'), TargetInputError);
});

test('isPublicIp distinguishes public and private ranges', () => {
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('1.1.1.1'), true);
  assert.equal(isPublicIp('10.1.2.3'), false);
  assert.equal(isPublicIp('127.0.0.1'), false);
  assert.equal(isPublicIp('192.168.1.5'), false);
  assert.equal(isPublicIp('172.16.0.1'), false);
  assert.equal(isPublicIp('169.254.1.1'), false);
  assert.equal(isPublicIp('100.64.0.1'), false);
  assert.equal(isPublicIp('::1'), false);
  assert.equal(isPublicIp('fe80::1'), false);
  assert.equal(isPublicIp('2001:4860:4860::8888'), true);
});

test('status code ranges parse and match', () => {
  const ranges = parseAcceptedStatusCodes('200-399, 401, 418');
  assert.equal(isStatusAccepted(200, ranges), true);
  assert.equal(isStatusAccepted(399, ranges), true);
  assert.equal(isStatusAccepted(400, ranges), false);
  assert.equal(isStatusAccepted(401, ranges), true);
  assert.equal(isStatusAccepted(418, ranges), true);
});

test('invalid status code ranges are rejected', () => {
  assert.throws(() => parseAcceptedStatusCodes(''));
  assert.throws(() => parseAcceptedStatusCodes('99-200'));
  assert.throws(() => parseAcceptedStatusCodes('200-100'));
  assert.throws(() => parseAcceptedStatusCodes('abc'));
});
