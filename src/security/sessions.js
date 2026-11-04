import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { randomToken, sha256 } from './tokens.js';

export const SESSION_COOKIE = 'didehban_sid';
export const PRE_CSRF_COOKIE = 'didehban_csrf_pre';

const ttlMs = () => config.sessionTtlHours * 60 * 60 * 1000;

export function cookieOptions(extra = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.sessionCookieSecure,
    path: '/',
    ...extra,
  };
}

export async function createSession(userId, ip, userAgent) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + ttlMs());
  await query(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), userId, sha256(token), csrfToken, expiresAt, ip || null, (userAgent || '').slice(0, 500)],
  );
  return { token, csrfToken, expiresAt };
}

export async function findSession(token) {
  if (!token) return null;
  const result = await query(
    `SELECT s.id AS session_id, s.user_id, s.csrf_token, s.expires_at,
            u.username, u.role, u.is_active
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
     LIMIT 1`,
    [sha256(token)],
  );
  const row = result.rows[0];
  if (!row || !row.is_active) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

export async function deleteSession(sessionId) {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function deleteUserSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, exceptSessionId]);
  } else {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

export async function deleteExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at <= now()');
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, cookieOptions({ maxAge: ttlMs() }));
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
