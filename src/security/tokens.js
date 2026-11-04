import crypto from 'node:crypto';

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function timingSafeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
