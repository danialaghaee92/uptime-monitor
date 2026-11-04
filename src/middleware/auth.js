import { findSession, SESSION_COOKIE } from '../security/sessions.js';
import { parseCookies } from '../security/cookies.js';
import { timingSafeEqualText } from '../security/tokens.js';

function parseSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] || null;
}

export async function loadSession(req, res, next) {
  try {
    const token = parseSessionToken(req);
    req.auth = token ? await findSession(token) : null;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: 'unauthorized', message: 'ابتدا وارد سامانه شوید.' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: 'unauthorized', message: 'ابتدا وارد سامانه شوید.' });
  }
  if (req.auth.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'این عملیات فقط برای ادمین مجاز است.' });
  }
  next();
}

export function requireCsrf(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: 'unauthorized', message: 'ابتدا وارد سامانه شوید.' });
  }
  const sent = req.get('x-csrf-token');
  if (!timingSafeEqualText(sent, req.auth.csrfToken)) {
    return res.status(403).json({ error: 'csrf_failed', message: 'توکن امنیتی نامعتبر است؛ صفحه را تازه کنید.' });
  }
  next();
}

export function requirePageAuth(req, res, next) {
  if (!req.auth) {
    const nextPath = encodeURIComponent(req.originalUrl || '/dashboard');
    return res.redirect(302, `/login?next=${nextPath}`);
  }
  next();
}

export function requirePageAdmin(req, res, next) {
  if (!req.auth) return res.redirect(302, '/login?next=%2Fadmin');
  if (req.auth.role !== 'admin') return res.redirect(302, '/dashboard');
  next();
}
