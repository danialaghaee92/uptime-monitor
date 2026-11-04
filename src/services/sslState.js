import { withTransaction } from '../db.js';
import {
  buildSslExpiryAlert,
  buildSslProblemAlert,
  enqueueAlert,
  selectExpiryThreshold,
} from './alerts.js';

/**
 * اعمال نتیجه بررسی SSL. وضعیت SSL کاملاً مستقل از وضعیت uptime ذخیره می‌شود.
 * هشدار مشکل/بازیابی فقط در تغییر وضعیت و هشدار انقضا یک‌بار برای هر آستانه ارسال می‌شود.
 */
export async function applySslCheck(target, result) {
  return withTransaction(async (client) => {
    const now = new Date();
    const previousStatus = target.ssl_status;
    const newStatus = result.status || 'invalid';
    let stateChangedAt = target.ssl_state_change_at ? new Date(target.ssl_state_change_at) : null;
    const events = [];

    if (newStatus !== previousStatus) stateChangedAt = now;

    if (newStatus === 'invalid' && previousStatus !== 'invalid') {
      events.push(buildSslProblemAlert(target, result, { recovery: false, stateChangedAt: now }));
    } else if (previousStatus === 'invalid' && newStatus !== 'invalid') {
      events.push(buildSslProblemAlert(target, result, { recovery: true, stateChangedAt: now }));
    }

    if (newStatus !== 'invalid' && Number.isInteger(result.daysLeft)) {
      const threshold = selectExpiryThreshold(result.daysLeft);
      if (threshold) events.push(buildSslExpiryAlert(target, result, threshold, now));
    }

    const updated = await client.query(
      `UPDATE targets SET
         ssl_status = $2,
         ssl_expires_at = $3,
         ssl_days_left = $4,
         ssl_issuer = $5,
         ssl_error = $6,
         ssl_tls_version = $7,
         ssl_last_checked_at = $8,
         ssl_state_change_at = $9,
         updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        target.id,
        newStatus,
        result.expiresAt ? new Date(result.expiresAt) : null,
        Number.isInteger(result.daysLeft) ? result.daysLeft : null,
        result.issuer || null,
        result.errorMessage || null,
        result.tlsVersion || null,
        now,
        stateChangedAt,
      ],
    );
    if (!updated.rowCount) return { skipped: true };

    await client.query(
      `INSERT INTO ssl_checks (target_id, checked_at, ok, status, expires_at, days_left, issuer, tls_version, error_type, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        target.id,
        now,
        result.ok === true,
        newStatus,
        result.expiresAt ? new Date(result.expiresAt) : null,
        Number.isInteger(result.daysLeft) ? result.daysLeft : null,
        result.issuer || null,
        result.tlsVersion || null,
        result.errorType || null,
        result.errorMessage || null,
      ],
    );

    let alertsCreated = 0;
    for (const event of events) {
      if (await enqueueAlert(client, event)) alertsCreated += 1;
    }

    return {
      skipped: false,
      status: newStatus,
      previousStatus,
      alertsCreated,
    };
  });
}
