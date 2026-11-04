import express from 'express';
import { query } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { hashPassword, validatePasswordPolicy } from '../security/passwords.js';
import { USERNAME_RE } from '../services/auth.js';
import { deleteUserSessions } from '../security/sessions.js';

export const adminUsersRouter = express.Router();
adminUsersRouter.use(requireAdmin);

function numericId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('شناسه کاربر معتبر نیست.');
  return id;
}

function validateUsername(value) {
  const username = String(value ?? '').trim();
  if (!USERNAME_RE.test(username)) {
    throw new ValidationError('نام کاربری باید ۳ تا ۵۰ کاراکتر و شامل حروف لاتین، رقم، نقطه، خط تیره یا زیرخط باشد.');
  }
  return username;
}

function validateRole(value) {
  if (!['admin', 'viewer'].includes(value)) throw new ValidationError('نقش کاربر باید admin یا viewer باشد.');
  return value;
}

function parseActive(value) {
  if (typeof value !== 'boolean') throw new ValidationError('وضعیت فعال بودن باید true یا false باشد.');
  return value;
}

async function activeAdminCount(client = null) {
  const runner = client ? (text, params) => client.query(text, params) : query;
  const result = await runner(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE`);
  return Number(result.rows[0]?.count || 0);
}

async function getUserRow(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!result.rows[0]) throw new NotFoundError('کاربر مورد نظر یافت نشد.');
  return result.rows[0];
}

function toApi(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
  };
}

adminUsersRouter.get('/users', async (req, res) => {
  const result = await query(
    `SELECT id, username, role, is_active, last_login_at, created_at, failed_attempts, locked_until
     FROM users ORDER BY role DESC, username ASC`,
  );
  res.json({ users: result.rows.map(toApi) });
});

adminUsersRouter.post('/users', async (req, res) => {
  const username = validateUsername(req.body?.username);
  const role = validateRole(req.body?.role);
  const isActive = req.body?.isActive === undefined ? true : parseActive(req.body.isActive);
  const password = String(req.body?.password ?? '');
  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new ValidationError(policyError);

  const hash = await hashPassword(password);
  try {
    const result = await query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, role, is_active, last_login_at, created_at, failed_attempts, locked_until`,
      [username, hash, role, isActive],
    );
    res.status(201).json({ user: toApi(result.rows[0]) });
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('این نام کاربری قبلاً ثبت شده است.', 'duplicate_username');
    throw err;
  }
});

adminUsersRouter.patch('/users/:id', async (req, res) => {
  const id = numericId(req.params.id);
  const user = await getUserRow(id);

  const updates = [];
  const values = [];
  let role = user.role;
  let isActive = user.is_active;

  if (req.body?.role !== undefined) {
    role = validateRole(req.body.role);
  }
  if (req.body?.isActive !== undefined) {
    isActive = parseActive(req.body.isActive);
  }
  if (req.body?.password !== undefined && req.body.password !== '') {
    const policyError = validatePasswordPolicy(String(req.body.password));
    if (policyError) throw new ValidationError(policyError);
    const hash = await hashPassword(String(req.body.password));
    values.push(hash);
    updates.push(`password_hash = $${values.length}`);
  }

  if (id === req.auth.userId && (role !== 'admin' || !isActive)) {
    throw new ValidationError('نمی‌توانید نقش یا وضعیت حساب خودتان را محدود کنید.');
  }

  const losingAdmin = user.role === 'admin' && user.is_active && (role !== 'admin' || !isActive);
  if (losingAdmin && (await activeAdminCount()) <= 1) {
    throw new ValidationError('حداقل یک ادمین فعال باید در سامانه باقی بماند.');
  }

  values.push(role, isActive, id);
  updates.push(`role = $${values.length - 2}`, `is_active = $${values.length - 1}`);
  const result = await query(
    `UPDATE users SET ${updates.join(', ')}, failed_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE id = $${values.length}
     RETURNING id, username, role, is_active, last_login_at, created_at, failed_attempts, locked_until`,
    values,
  );

  if (role !== user.role || isActive !== user.is_active || req.body?.password) {
    await deleteUserSessions(id);
  }
  res.json({ user: toApi(result.rows[0]) });
});

adminUsersRouter.delete('/users/:id', async (req, res) => {
  const id = numericId(req.params.id);
  if (id === req.auth.userId) throw new ValidationError('حذف حساب خودتان مجاز نیست.');
  const user = await getUserRow(id);
  if (user.role === 'admin' && user.is_active && (await activeAdminCount()) <= 1) {
    throw new ValidationError('حداقل یک ادمین فعال باید در سامانه باقی بماند.');
  }
  await query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true });
});
