import { query } from '../db.js';
import { ValidationError } from '../lib/errors.js';

export const SETTING_DEFS = {
  global_ssl_interval_seconds: { type: 'int', min: 60, max: 604800, default: 300 },
  default_uptime_interval_seconds: { type: 'int', min: 10, max: 86400, default: 60 },
  default_timeout_seconds: { type: 'int', min: 1, max: 120, default: 10 },
  default_failure_threshold: { type: 'int', min: 1, max: 20, default: 3 },
  default_degraded_threshold_ms: { type: 'int', min: 100, max: 600000, default: 3000 },
  default_accepted_status_codes: { type: 'string', maxLength: 200, default: '200-399' },
  history_retention_days: { type: 'int', min: 0, max: 3650, default: 90 },
  allow_private_targets: { type: 'bool', default: false },
};

const KEY_ALIASES = {
  globalSslIntervalSeconds: 'global_ssl_interval_seconds',
  defaultUptimeIntervalSeconds: 'default_uptime_interval_seconds',
  defaultTimeoutSeconds: 'default_timeout_seconds',
  defaultFailureThreshold: 'default_failure_threshold',
  defaultDegradedThresholdMs: 'default_degraded_threshold_ms',
  defaultAcceptedStatusCodes: 'default_accepted_status_codes',
  historyRetentionDays: 'history_retention_days',
  allowPrivateTargets: 'allow_private_targets',
};

export function canonicalSettingKey(key) {
  return KEY_ALIASES[key] || key;
}

export async function getSettings(client = null) {
  const runner = client ? (text, params) => client.query(text, params) : query;
  const result = await runner('SELECT key, value FROM settings');
  const values = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) values[key] = def.default;
  for (const row of result.rows) {
    if (row.key in values) values[row.key] = row.value;
  }
  return values;
}

export function toApiSettings(settings) {
  return {
    globalSslIntervalSeconds: settings.global_ssl_interval_seconds,
    defaultUptimeIntervalSeconds: settings.default_uptime_interval_seconds,
    defaultTimeoutSeconds: settings.default_timeout_seconds,
    defaultFailureThreshold: settings.default_failure_threshold,
    defaultDegradedThresholdMs: settings.default_degraded_threshold_ms,
    defaultAcceptedStatusCodes: settings.default_accepted_status_codes,
    historyRetentionDays: settings.history_retention_days,
    allowPrivateTargets: settings.allow_private_targets,
  };
}

export function validateSettingValue(key, raw) {
  const def = SETTING_DEFS[key];
  if (!def) throw new ValidationError(`تنظیم ناشناخته: ${key}`);
  if (def.type === 'bool') {
    if (typeof raw !== 'boolean') throw new ValidationError(`${key} باید true یا false باشد.`);
    return raw;
  }
  if (def.type === 'int') {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < def.min || value > def.max) {
      throw new ValidationError(`${key} باید عددی بین ${def.min} و ${def.max} باشد.`);
    }
    return value;
  }
  const value = String(raw ?? '').trim();
  if (!value || value.length > def.maxLength) {
    throw new ValidationError(`${key} نامعتبر است.`);
  }
  return value;
}

export async function updateSettings(patch, client = null) {
  const runner = client ? (text, params) => client.query(text, params) : query;
  const entries = [];
  for (const [keyRaw, raw] of Object.entries(patch || {})) {
    const key = canonicalSettingKey(keyRaw);
    if (!SETTING_DEFS[key]) throw new ValidationError(`تنظیم ناشناخته: ${keyRaw}`);
    entries.push([key, validateSettingValue(key, raw)]);
  }
  if (!entries.length) throw new ValidationError('هیچ تنظیمی برای ذخیره ارسال نشده است.');

  for (const [key, value] of entries) {
    await runner(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
  return getSettings(client);
}
