import express from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { ValidationError } from '../lib/errors.js';
import { parseCookies } from '../security/cookies.js';
import { randomToken, timingSafeEqualText } from '../security/tokens.js';
import {
  PRE_CSRF_COOKIE,
  clearSessionCookie,
  cookieOptions,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  deleteUserSessions,
  setSessionCookie,
} from '../security/sessions.js';
import { authenticateUser } from '../services/auth.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../security/passwords.js';
import { requireAuth } from '../middleware/auth.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger(config.logLevel, 'auth-routes');
export const authRouter = express.Router();

authRouter.get('/csrf', (req, res) => {
  const token = randomToken(24);
  res.cookie(PRE_CSRF_COOKIE, token, cookieOptions({ httpOnly: false, maxAge: 60 * 60 * 1000 }));
  res.json({ token });
});

authRouter.post('/login', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const preToken = cookies[PRE_CSRF_COOKIE];
  const sentToken = req.get('x-csrf-token');
  if (!preToken || !timingSafeEqualText(sentToken, preToken)) {
    return res.status(403).json({ error: 'csrf_failed', message: 'توکن امنیتی نامعتبر است؛ صفحه را تازه کنید.' });
  }

  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password || username.length > 100 || password.length > 200) {
    return res.status(400).json({ error: 'validation_error', message: 'نام کاربری و رمز عبور را وارد کنید.' });
  }

  const result = await authenticateUser(username, password, req.ip);
  if (!result.ok) {
    const status = result.reason === 'locked' ? 423 : result.reason === 'inactive' ? 403 : 401;
    return res.status(status).json({ error: result.reason, message: result.message });
  }

  const session = await createSession(result.user.id, req.ip, req.get('user-agent'));
  setSessionCookie(res, session.token);
  res.clearCookie(PRE_CSRF_COOKIE, cookieOptions({ httpOnly: false }));
  await deleteExpiredSessions().catch(() => {});
  logger.info(`ورود موفق «${result.user.username}» از IP ${req.ip}`);

  return res.json({
    user: result.user,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await deleteSession(req.auth.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: { id: req.auth.userId, username: req.auth.username, role: req.auth.role },
    csrfToken: req.auth.csrfToken,
    expiresAt: req.auth.expiresAt,
    timezone: config.timezone,
    appName: 'دیده‌بان',
  });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) throw new ValidationError(policyError);

  const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.auth.userId]);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(user.password_hash, currentPassword))) {
    return res.status(400).json({ error: 'invalid_password', message: 'رمز عبور فعلی نادرست است.' });
  }

  const hash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.auth.userId, hash]);
  await deleteUserSessions(req.auth.userId, req.auth.sessionId);
  logger.info(`رمز عبور «${req.auth.username}» تغییر کرد.`);
  res.json({ ok: true, message: 'رمز عبور تغییر کرد. سایر نشست‌ها بسته شدند.' });
});
