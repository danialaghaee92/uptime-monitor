import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export const BCRYPT_ROUNDS = 12;

let dummyHashPromise = null;

export function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.';
  }
  if (password.length > 200) {
    return 'رمز عبور نمی‌تواند بیش از ۲۰۰ کاراکتر باشد.';
  }
  if (!/[A-Za-z]/.test(password)) {
    return 'رمز عبور باید حداقل یک حرف لاتین داشته باشد.';
  }
  if (!/[0-9]/.test(password)) {
    return 'رمز عبور باید حداقل یک رقم داشته باشد.';
  }
  return null;
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(hash, password) {
  return bcrypt.compare(password, hash);
}

// برای یکسان‌سازی زمان پاسخ وقتی نام کاربری وجود ندارد.
export async function verifyDummyPassword(password) {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(crypto.randomBytes(18).toString('hex'), BCRYPT_ROUNDS);
  }
  const hash = await dummyHashPromise;
  await bcrypt.compare(String(password ?? ''), hash);
  return false;
}
