import { formatDuration, formatGregorian, formatJalali } from '../lib/time.js';
import { getEnabledChannels } from './notifiers.js';

export const EXPIRY_THRESHOLDS = [1, 7, 14, 30];

const STATUS_LABELS = {
  up: 'Up',
  degraded: 'Degraded (کند)',
  down: 'Down',
  unknown: 'نامشخص',
  ok: 'سالم',
  expiring: 'در خطر',
  invalid: 'خراب',
};

function targetLines(target) {
  return [
    `دامنه: ${target.display_name} (${target.url})`,
    `دسته: ${target.category || 'عمومی'}`,
  ];
}

export function selectExpiryThreshold(daysLeft) {
  if (!Number.isInteger(daysLeft) || daysLeft < 0) return null;
  return EXPIRY_THRESHOLDS.find((threshold) => daysLeft <= threshold) || null;
}

export function buildUptimeAlert(target, { kind, result, downSince }) {
  const when = result.checkedAt || new Date();
  const isDown = kind === 'down';
  const statusLabel = STATUS_LABELS[result.status] || result.status;
  const title = isDown ? `🔴 قطعی: ${target.display_name}` : `✅ بازگشت: ${target.display_name}`;

  const lines = [
    ...targetLines(target),
    `نوع رویداد: ${isDown ? 'قطعی سرویس' : 'بازگشت سرویس'}`,
    `وضعیت جدید: ${statusLabel}`,
    `زمان (شمسی): ${formatJalali(when)}`,
    `زمان (میلادی): ${formatGregorian(when)}`,
    `کد وضعیت HTTP: ${result.statusCode ?? '—'}`,
    `زمان پاسخ: ${result.responseMs != null ? `${result.responseMs} میلی‌ثانیه` : '—'}`,
  ];

  if (isDown) {
    lines.push(`شکست‌های متوالی: ${target.failure_threshold} بار`);
    lines.push(`علت: ${result.errorMessage || result.errorType || 'نامشخص'}`);
  } else if (downSince) {
    lines.push(`مدت قطعی: ${formatDuration(when.getTime() - new Date(downSince).getTime())}`);
  }

  return {
    kind: isDown ? 'uptime_down' : 'uptime_recovery',
    severity: isDown ? 'critical' : 'info',
    title,
    body: lines.join('\n'),
    meta: {
      targetId: target.id,
      hostname: target.hostname,
      url: target.url,
      status: result.status,
      statusCode: result.statusCode,
      responseMs: result.responseMs,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      downSince: downSince ? new Date(downSince).toISOString() : null,
    },
    dedupeKey: isDown
      ? `uptime_down:${target.id}:${new Date(downSince || when).toISOString()}`
      : `uptime_recovery:${target.id}:${new Date(downSince || when).toISOString()}`,
  };
}

export function buildSslProblemAlert(target, result, { recovery = false, stateChangedAt = new Date() } = {}) {
  const when = result.checkedAt || new Date();
  const title = recovery
    ? `✅ رفع مشکل SSL: ${target.display_name}`
    : `⚠️ مشکل SSL: ${target.display_name}`;

  const lines = [
    ...targetLines(target),
    `نوع رویداد: ${recovery ? 'رفع مشکل SSL' : 'مشکل گواهی SSL'}`,
    `وضعیت: ${STATUS_LABELS[result.status] || result.status}`,
    `زمان (شمسی): ${formatJalali(when)}`,
    `زمان (میلادی): ${formatGregorian(when)}`,
    `تاریخ انقضا: ${result.expiresAt ? formatJalali(result.expiresAt, false) : '—'}`,
    `روز باقی‌مانده: ${result.daysLeft ?? '—'}`,
    `صادرکننده: ${result.issuer || '—'}`,
    `نسخه TLS: ${result.tlsVersion || '—'}`,
  ];
  if (!recovery) lines.push(`خطا: ${result.errorMessage || result.errorType || 'نامشخص'}`);

  return {
    kind: recovery ? 'ssl_recovery' : 'ssl_problem',
    severity: recovery ? 'info' : 'critical',
    title,
    body: lines.join('\n'),
    meta: {
      targetId: target.id,
      hostname: target.hostname,
      url: target.url,
      status: result.status,
      errorType: result.errorType,
      daysLeft: result.daysLeft,
      expiresAt: result.expiresAt ? new Date(result.expiresAt).toISOString() : null,
    },
    dedupeKey: `${recovery ? 'ssl_recovery' : 'ssl_problem'}:${target.id}:${new Date(stateChangedAt).toISOString()}`,
  };
}

export function buildSslExpiryAlert(target, result, threshold, checkedAt = new Date()) {
  const title = `⏳ هشدار انقضای SSL: ${target.display_name} (${threshold} روز)`;
  const lines = [
    ...targetLines(target),
    `نوع رویداد: نزدیک شدن به انقضای گواهی SSL`,
    `آستانه: ${threshold} روز مانده`,
    `روز باقی‌مانده: ${result.daysLeft}`,
    `تاریخ انقضا: ${result.expiresAt ? formatJalali(result.expiresAt, false) : '—'}`,
    `صادرکننده: ${result.issuer || '—'}`,
    `زمان بررسی: ${formatJalali(checkedAt)}`,
  ];

  return {
    kind: 'ssl_expiry',
    severity: threshold <= 7 ? 'critical' : 'warning',
    title,
    body: lines.join('\n'),
    meta: {
      targetId: target.id,
      hostname: target.hostname,
      url: target.url,
      daysLeft: result.daysLeft,
      threshold,
      expiresAt: result.expiresAt ? new Date(result.expiresAt).toISOString() : null,
    },
    dedupeKey: `ssl_expiry:${target.id}:${result.expiresAt ? new Date(result.expiresAt).toISOString() : 'unknown'}:${threshold}`,
  };
}

/**
 * ثبت رویداد و ایجاد صف ارسال برای همه کانال‌های فعال.
 * کلید یکتا از ارسال هشدار تکراری جلوگیری می‌کند.
 */
export async function enqueueAlert(client, event) {
  const inserted = await client.query(
    `INSERT INTO alert_events (target_id, dedupe_key, kind, severity, title, body, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      event.meta?.targetId ?? null,
      event.dedupeKey,
      event.kind,
      event.severity,
      event.title,
      event.body,
      JSON.stringify(event.meta || {}),
    ],
  );
  if (!inserted.rowCount) return false;

  const eventId = inserted.rows[0].id;
  const channels = getEnabledChannels();
  for (const channel of channels) {
    await client.query(
      `INSERT INTO notifications (event_id, channel)
       VALUES ($1, $2)
       ON CONFLICT (event_id, channel) DO NOTHING`,
      [eventId, channel],
    );
  }
  return true;
}
