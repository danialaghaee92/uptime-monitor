import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordPolicy, hashPassword, verifyPassword } from '../src/security/passwords.js';

test('password policy rejects weak passwords', () => {
  assert.ok(validatePasswordPolicy('short1'));
  assert.ok(validatePasswordPolicy('alllettersonly'));
  assert.ok(validatePasswordPolicy('1234567890'));
  assert.equal(validatePasswordPolicy('StrongPass123'), null);
});

test('password hash verifies', async () => {
  const hash = await hashPassword('StrongPass123');
  assert.equal(await verifyPassword(hash, 'StrongPass123'), true);
  assert.equal(await verifyPassword(hash, 'WrongPass123'), false);
});
