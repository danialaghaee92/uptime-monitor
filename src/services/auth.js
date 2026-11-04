import { query } from '../db.js';
import { config } from '../config.js';
import { hashPassword, validatePasswordPolicy, verifyDummyPassword, verifyPassword } from '../security/passwords.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger(config.logLevel, 'auth');

export const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export async function findUserByUsername(username) {
  const result = await query('SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1', [String(username || '')]);
  return result.rows[0] || null;
}

/**
 * احراز هویت با قفل موقت حساب.
 * پیام خطا برای جلوگیری از افشای وجود/عدم وجود کاربر یکسان است.
 */
export async function authenticateUser(username, password, ip) {
  const user = await findUserByUsername(username);
  if (!user) {
    await verifyDummyPassword(password);
    return { ok: false, reason: 'invalid', message: 'نام کاربری یا رمز عبور نادرست است.' };
  }

  if (!user.is_active) {
    await verifyDummyPassword(password);
    return { ok: false, reason: 'inactive', message: 'این حساب غیرفعال است.' };
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000));
    return { ok: false, reason: 'locked', message: `حساب به‌دلیل تلاش‌های ناموفق موقتاً قفل است. ${minutes} دقیقه دیگر تلاش کنید.` };
  }

  const valid = await verifyPassword(user.password_hash, String(password ?? ''));
  if (!valid) {
    const result = await query(
      `UPDATE users
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END,
           updated_at = now()
       WHERE id = $1
       RETURNING failed_attempts, locked_until`,
      [user.id, MAX_FAILED_ATTEMPTS, String(LOCK_MINUTES)],
    );
    const row = result.rows[0];
    if (row && row.failed_attempts >= MAX_FAILED_ATTEMPTS) {
      logger.warn(`قفل موقت حساب «${user.username}» از IP ${ip || 'نامشخص'}`);
      return {
        ok: false,
        reason: 'locked',
        message: `تعداد تلاش‌های ناموفق زیاد بود؛ حساب برای ${LOCK_MINUTES} دقیقه قفل شد.`,
      };
    }
    return { ok: false, reason: 'invalid', message: 'نام کاربری یا رمز عبور نادرست است.' };
  }

  await query(
    `UPDATE users
     SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
     WHERE id = $1`,
    [user.id],
  );
  return {
    ok: true,
    user: { id: user.id, username: user.username, role: user.role },
  };
}

export async function ensureInitialAdmin({ forcePassword = false, silent = false } = {}) {
  const username = config.adminUsername;
  const password = config.adminPassword;

  if (!username || !USERNAME_RE.test(username)) {
    throw new Error('ADMIN_USERNAME نامعتبر است (۳ تا ۵۰ کاراکتر لاتین، رقم، نقطه، خط تیره یا زیرخط).');
  }
  if (!password) {
    if (!silent) logger.warn('ADMIN_PASSWORD تنظیم نشده است؛ ادمین اولیه ساخته نشد.');
    return { created: false, reason: 'no_password' };
  }
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    throw new Error(`ADMIN_PASSWORD نامعتبر است: ${policyError}`);
  }

  const existing = await findUserByUsername(username);
  if (existing) {
    if (forcePassword) {
      const hash = await hashPassword(password);
      await query(
        `UPDATE users SET password_hash = $2, role = 'admin', is_active = TRUE, failed_attempts = 0,
         locked_until = NULL, updated_at = now() WHERE id = $1`,
        [existing.id, hash],
      );
      await query('DELETE FROM sessions WHERE user_id = $1', [existing.id]);
      logger.info(`رمز ادمین «${username}» به‌روزرسانی شد.`);
      return { created: false, updated: true };
    }
    if (!silent) logger.info(`کاربر «${username}» از قبل وجود دارد؛ ادمین جدیدی ساخته نشد.`);
    return { created: false, reason: 'exists' };
  }

  const hash = await hashPassword(password);
  try {
    await query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ($1, $2, 'admin', TRUE)`,
      [username, hash],
    );
  } catch (err) {
    // اگر دو نمونه هم‌زمان بالا بیایند، یکی از آن‌ها برنده می‌شود.
    if (err.code === '23505') {
      if (!silent) logger.info(`کاربر «${username}» هم‌زمان توسط نمونه دیگری ساخته شد.`);
      return { created: false, reason: 'exists' };
    }
    throw err;
  }
  if (!silent) logger.info(`✅ ادمین اولیه «${username}» ساخته شد.`);
  return { created: true };
}
