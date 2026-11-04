import { query } from '../db.js';
import { ValidationError, ConflictError, NotFoundError } from '../lib/errors.js';
import { clampText, mapLimit, parseTags } from '../lib/utils.js';
import { parseAcceptedStatusCodes } from '../lib/statusCodes.js';
import {
  assertSafeAddress,
  normalizeTargetUrl,
  TargetInputError,
} from './urlGuard.js';
import { getSettings } from './settings.js';

const DEFAULT_CATEGORY = 'عمومی';

function parseBool(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  throw new ValidationError(`${label} باید true یا false باشد.`);
}

function parseIntField(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ValidationError(`${label} باید عددی صحیح بین ${min} و ${max} باشد.`);
  }
  return number;
}

function validateSslInterval(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  return parseIntField(value, null, 60, 604800, 'بازه بررسی SSL');
}

function normalizeCategory(value) {
  const category = clampText(value, 80);
  return category || DEFAULT_CATEGORY;
}

function displayNameFor(info) {
  const defaultPort = info.protocol === 'https:' ? 443 : 80;
  return info.port === defaultPort ? info.hostname : `${info.hostname}:${info.port}`;
}

function toTargetRowValues(input, info, settings, existing = null) {
  const allowPrivate = parseBool(input.allowPrivate, existing?.allow_private ?? settings.allow_private_targets, 'اجازه آدرس خصوصی');
  const uptimeEnabled = parseBool(input.uptimeEnabled, existing?.uptime_enabled ?? true, 'فعال بودن پایش uptime');
  const sslEnabled = parseBool(input.sslEnabled, existing?.ssl_enabled ?? true, 'فعال بودن پایش SSL');
  if (!uptimeEnabled && !sslEnabled) {
    throw new ValidationError('حداقل یکی از پایش‌های uptime یا SSL باید فعال باشد.');
  }

  const uptimeInterval = parseIntField(
    input.uptimeIntervalSeconds,
    existing?.uptime_interval_seconds ?? settings.default_uptime_interval_seconds,
    existing ? 10 : 10,
    86400,
    'بازه بررسی uptime',
  );
  const timeout = parseIntField(
    input.timeoutSeconds,
    existing?.timeout_seconds ?? settings.default_timeout_seconds,
    1,
    120,
    'زمان انتظار (timeout)',
  );
  const degraded = parseIntField(
    input.degradedThresholdMs,
    existing?.degraded_threshold_ms ?? settings.default_degraded_threshold_ms,
    100,
    600000,
    'آستانه کندی',
  );
  const failureThreshold = parseIntField(
    input.failureThreshold,
    existing?.failure_threshold ?? settings.default_failure_threshold,
    1,
    20,
    'آستانه شکست متوالی',
  );

  let acceptedCodes = existing?.accepted_status_codes ?? settings.default_accepted_status_codes;
  if (input.acceptedStatusCodes !== undefined) {
    acceptedCodes = String(input.acceptedStatusCodes).trim();
  }
  parseAcceptedStatusCodes(acceptedCodes);

  let displayName = clampText(input.displayName, 120);
  if (!displayName) displayName = existing?.display_name || displayNameFor(info);

  let category = input.category === undefined ? existing?.category || DEFAULT_CATEGORY : normalizeCategory(input.category);
  let tags = input.tags === undefined ? existing?.tags || [] : parseTags(input.tags);

  return {
    url: info.url,
    urlKey: info.urlKey,
    hostname: info.hostname,
    port: info.port,
    displayName,
    category,
    tags,
    isActive: parseBool(input.isActive, existing?.is_active ?? true, 'فعال بودن دامنه'),
    allowPrivate,
    uptimeEnabled,
    uptimeInterval,
    timeout,
    degraded,
    failureThreshold,
    acceptedCodes,
    sslEnabled,
    sslInterval: validateSslInterval(input.sslIntervalSeconds, existing?.ssl_interval_seconds ?? null),
  };
}

function parseTargetUrl(raw) {
  try {
    return normalizeTargetUrl(raw);
  } catch (err) {
    if (err instanceof TargetInputError) {
      throw new ValidationError(err.message, { code: err.code });
    }
    throw err;
  }
}

async function guardAddress(info, allowPrivate, { requireResolution }) {
  try {
    return await assertSafeAddress(info, allowPrivate, { requireResolution });
  } catch (err) {
    if (err instanceof TargetInputError) {
      throw new ValidationError(err.message, { code: err.code });
    }
    throw err;
  }
}

async function insertTargetRow(values) {
  try {
    const result = await query(
      `INSERT INTO targets (
         url, url_key, hostname, port, display_name, category, tags, is_active, allow_private,
         uptime_enabled, uptime_interval_seconds, timeout_seconds, degraded_threshold_ms, failure_threshold, accepted_status_codes,
         ssl_enabled, ssl_interval_seconds,
         uptime_next_check_at, ssl_next_check_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,
         $16,$17,
         now(), now()
       )
       RETURNING *`,
      [
        values.url, values.urlKey, values.hostname, values.port, values.displayName, values.category, values.tags,
        values.isActive, values.allowPrivate,
        values.uptimeEnabled, values.uptimeInterval, values.timeout, values.degraded, values.failureThreshold, values.acceptedCodes,
        values.sslEnabled, values.sslInterval,
      ],
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError('این دامنه/آدرس قبلاً ثبت شده است.', 'duplicate_target');
    }
    throw err;
  }
}

export async function createTarget(input) {
  const settings = await getSettings();
  const info = parseTargetUrl(input.url);
  const values = toTargetRowValues(input, info, settings);
  await guardAddress(info, values.allowPrivate, { requireResolution: false });
  return insertTargetRow(values);
}

export async function updateTarget(id, input) {
  const existingResult = await query('SELECT * FROM targets WHERE id = $1', [id]);
  const existing = existingResult.rows[0];
  if (!existing) throw new NotFoundError('دامنه مورد نظر یافت نشد.');

  const settings = await getSettings();
  let info = {
    url: existing.url,
    urlKey: existing.url_key,
    hostname: existing.hostname,
    port: existing.port,
    protocol: existing.url.startsWith('https:') ? 'https:' : 'http:',
  };

  let urlChanged = false;
  if (input.url !== undefined) {
    info = parseTargetUrl(input.url);
    urlChanged = info.urlKey !== existing.url_key;
  }

  const values = toTargetRowValues(input, info, settings, existing);
  const allowPrivateChanged = values.allowPrivate !== existing.allow_private;
  if (urlChanged || allowPrivateChanged) {
    await guardAddress(info, values.allowPrivate, { requireResolution: false });
  }

  const resetUptime =
    urlChanged ||
    values.uptimeInterval !== existing.uptime_interval_seconds ||
    values.uptimeEnabled !== existing.uptime_enabled ||
    values.isActive !== existing.is_active ||
    values.allowPrivate !== existing.allow_private;
  const resetSsl =
    urlChanged ||
    values.sslInterval !== existing.ssl_interval_seconds ||
    values.sslEnabled !== existing.ssl_enabled ||
    values.isActive !== existing.is_active ||
    values.allowPrivate !== existing.allow_private;

  try {
    const result = await query(
      `UPDATE targets SET
         url = $2, url_key = $3, hostname = $4, port = $5, display_name = $6, category = $7, tags = $8,
         is_active = $9, allow_private = $10,
         uptime_enabled = $11, uptime_interval_seconds = $12, timeout_seconds = $13,
         degraded_threshold_ms = $14, failure_threshold = $15, accepted_status_codes = $16,
         ssl_enabled = $17, ssl_interval_seconds = $18,
         uptime_next_check_at = CASE WHEN $19 THEN now() ELSE uptime_next_check_at END,
         ssl_next_check_at = CASE WHEN $20 THEN now() ELSE ssl_next_check_at END,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id, values.url, values.urlKey, values.hostname, values.port, values.displayName, values.category, values.tags,
        values.isActive, values.allowPrivate,
        values.uptimeEnabled, values.uptimeInterval, values.timeout,
        values.degraded, values.failureThreshold, values.acceptedCodes,
        values.sslEnabled, values.sslInterval,
        resetUptime, resetSsl,
      ],
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError('دامنه/آدرس دیگری با همین نشانی ثبت شده است.', 'duplicate_target');
    }
    throw err;
  }
}

export async function deleteTarget(id) {
  const result = await query('DELETE FROM targets WHERE id = $1 RETURNING id', [id]);
  if (!result.rowCount) throw new NotFoundError('دامنه مورد نظر یافت نشد.');
}

export async function getTarget(id) {
  const result = await query('SELECT * FROM targets WHERE id = $1', [id]);
  if (!result.rows[0]) throw new NotFoundError('دامنه مورد نظر یافت نشد.');
  return result.rows[0];
}

export async function listAdminTargets() {
  const settings = await getSettings();
  const result = await query('SELECT * FROM targets ORDER BY is_active DESC, display_name ASC');
  return {
    settings,
    targets: result.rows.map((row) => targetToApi(row, settings)),
  };
}

export function targetToApi(row, settings) {
  const globalSslInterval = settings?.global_ssl_interval_seconds ?? 300;
  return {
    id: row.id,
    url: row.url,
    hostname: row.hostname,
    port: row.port,
    displayName: row.display_name,
    category: row.category,
    tags: row.tags || [],
    isActive: row.is_active,
    allowPrivate: row.allow_private,

    uptimeEnabled: row.uptime_enabled,
    uptimeIntervalSeconds: row.uptime_interval_seconds,
    timeoutSeconds: row.timeout_seconds,
    degradedThresholdMs: row.degraded_threshold_ms,
    failureThreshold: row.failure_threshold,
    acceptedStatusCodes: row.accepted_status_codes,

    sslEnabled: row.ssl_enabled,
    sslIntervalSeconds: row.ssl_interval_seconds,
    effectiveSslIntervalSeconds: row.ssl_interval_seconds ?? globalSslInterval,

    uptimeStatus: row.uptime_status,
    consecutiveFailures: row.consecutive_failures,
    downSince: row.down_since,
    lastCheckedAt: row.last_checked_at,
    lastStatusCode: row.last_status_code,
    lastResponseMs: row.last_response_ms,
    lastError: row.last_error,
    lastStateChangeAt: row.last_state_change_at,
    uptimeNextCheckAt: row.uptime_next_check_at,

    sslStatus: row.ssl_status,
    sslExpiresAt: row.ssl_expires_at,
    sslDaysLeft: row.ssl_days_left,
    sslIssuer: row.ssl_issuer,
    sslError: row.ssl_error,
    sslTlsVersion: row.ssl_tls_version,
    sslLastCheckedAt: row.ssl_last_checked_at,
    sslStateChangeAt: row.ssl_state_change_at,
    sslNextCheckAt: row.ssl_next_check_at,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function entryAllowPrivate(entry, fallback) {
  if (entry.allowPrivate === undefined || entry.allowPrivate === '') return fallback;
  return parseBool(entry.allowPrivate, fallback, 'اجازه آدرس خصوصی');
}

/**
 * افزودن گروهی. ورودی‌ها از paste یا CSV می‌آیند و همه اعتبارسنجی می‌شوند.
 */
export async function importTargets(entries, options = {}) {
  const settings = await getSettings();
  const defaults = {
    category: normalizeCategory(options.category || ''),
    tags: parseTags(options.tags || ''),
    allowPrivate: parseBool(options.allowPrivate, settings.allow_private_targets, 'اجازه آدرس خصوصی'),
  };

  const limited = entries.slice(0, 2000);
  const seen = new Set();
  const added = [];
  const duplicates = [];
  const invalid = [];

  await mapLimit(limited, 10, async (entry) => {
    const line = entry.line;
    const rawUrl = String(entry.url || '').trim();
    if (!rawUrl) {
      invalid.push({ line, url: '', reason: 'آدرس خالی است.' });
      return;
    }

    let info;
    try {
      info = normalizeTargetUrl(rawUrl);
    } catch (err) {
      invalid.push({ line, url: rawUrl, reason: err.message });
      return;
    }

    if (seen.has(info.urlKey)) {
      duplicates.push({ line, url: info.url, reason: 'تکراری در فایل ورودی' });
      return;
    }
    seen.add(info.urlKey);

    const allowPrivate = entryAllowPrivate(entry, defaults.allowPrivate);
    try {
      await assertSafeAddress(info, allowPrivate, { requireResolution: false });
    } catch (err) {
      invalid.push({ line, url: info.url, reason: err.message });
      return;
    }

    try {
      // از همان settings و اطلاعات resolve‌شده استفاده می‌کنیم تا برای هر ردیف
      // درخواست تکراری به دیتابیس/DNS ارسال نشود.
      const values = toTargetRowValues(
        {
          url: info.url,
          displayName: entry.name,
          category: entry.category || defaults.category,
          tags: entry.tags || defaults.tags,
          allowPrivate,
        },
        info,
        settings,
      );
      const row = await insertTargetRow(values);
      added.push({ id: row.id, url: row.url, displayName: row.display_name });
    } catch (err) {
      if (err instanceof ConflictError) {
        duplicates.push({ line, url: info.url, reason: 'قبلاً در سامانه ثبت شده است.' });
      } else if (err instanceof ValidationError) {
        invalid.push({ line, url: info.url, reason: err.message });
      } else {
        invalid.push({ line, url: info.url, reason: 'خطا در ذخیره‌سازی.' });
      }
    }
  });

  return {
    total: limited.length,
    added,
    duplicates,
    invalid,
    truncated: entries.length > limited.length,
  };
}
