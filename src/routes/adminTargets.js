import express from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { query } from '../db.js';
import { parsePasteInput, parseTargetsCsv } from '../lib/csv.js';
import {
  createTarget,
  deleteTarget,
  importTargets,
  listAdminTargets,
  targetToApi,
  updateTarget,
} from '../services/targets.js';
import { getSettings } from '../services/settings.js';

export const adminTargetsRouter = express.Router();
adminTargetsRouter.use(requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

function numericId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('شناسه دامنه معتبر نیست.');
  return id;
}

function trimResult(result) {
  const limit = 200;
  return {
    total: result.total,
    addedCount: result.added.length,
    duplicateCount: result.duplicates.length,
    invalidCount: result.invalid.length,
    truncated: result.truncated,
    added: result.added.slice(0, limit),
    duplicates: result.duplicates.slice(0, limit),
    invalid: result.invalid.slice(0, limit),
  };
}

adminTargetsRouter.get('/targets', async (req, res) => {
  res.json(await listAdminTargets());
});

adminTargetsRouter.post('/targets', async (req, res) => {
  const row = await createTarget(req.body || {});
  const settings = await getSettings();
  res.status(201).json({ target: targetToApi(row, settings) });
});

adminTargetsRouter.patch('/targets/:id', async (req, res) => {
  const row = await updateTarget(numericId(req.params.id), req.body || {});
  const settings = await getSettings();
  res.json({ target: targetToApi(row, settings) });
});

adminTargetsRouter.delete('/targets/:id', async (req, res) => {
  await deleteTarget(numericId(req.params.id));
  res.json({ ok: true });
});

adminTargetsRouter.post('/targets/import', async (req, res) => {
  const text = String(req.body?.text ?? '');
  if (!text.trim()) throw new ValidationError('لیست دامنه‌ها خالی است.');
  const format = String(req.body?.format || 'auto');
  let entries;
  if (format === 'csv' || (format === 'auto' && /^\s*"?[^,\n]*url[^,\n]*"?\s*,/i.test(text))) {
    entries = parseTargetsCsv(text);
  } else {
    entries = parsePasteInput(text);
  }
  if (!entries.length) throw new ValidationError('هیچ دامنه‌ای در ورودی پیدا نشد.');
  const result = await importTargets(entries, {
    category: req.body?.category,
    tags: req.body?.tags,
    allowPrivate: req.body?.allowPrivate,
  });
  res.json(trimResult(result));
});

adminTargetsRouter.post('/targets/import-csv', upload.single('file'), async (req, res) => {
  if (!req.file) throw new ValidationError('فایل CSV ارسال نشده است.');
  const text = req.file.buffer.toString('utf8');
  const entries = parseTargetsCsv(text);
  if (!entries.length) throw new ValidationError('هیچ ردیف معتبری در فایل CSV پیدا نشد.');
  const result = await importTargets(entries, {
    category: req.body?.category,
    tags: req.body?.tags,
    allowPrivate: req.body?.allowPrivate,
  });
  res.json(trimResult(result));
});

adminTargetsRouter.get('/targets/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM targets WHERE id = $1', [numericId(req.params.id)]);
  if (!rows[0]) throw new NotFoundError('دامنه مورد نظر یافت نشد.');
  const settings = await getSettings();
  res.json({ target: targetToApi(rows[0], settings) });
});
