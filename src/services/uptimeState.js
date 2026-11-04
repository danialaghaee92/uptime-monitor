import { withTransaction } from '../db.js';
import { buildUptimeAlert, enqueueAlert } from './alerts.js';

/**
 * اعمال نتیجه یک بررسی uptime روی دامنه و ثبت رویداد/تاریخچه در یک تراکنش.
 * هشدار فقط هنگام تغییر وضعیت (Down یا بازگشت) ساخته می‌شود.
 */
export async function applyUptimeCheck(target, result) {
  return withTransaction(async (client) => {
    const now = new Date();
    const previousStatus = target.uptime_status;
    let status = previousStatus;
    let failures = target.consecutive_failures;
    let successes = target.consecutive_successes;
    let downSince = target.down_since ? new Date(target.down_since) : null;
    let stateChangedAt = target.last_state_change_at ? new Date(target.last_state_change_at) : null;
    let alertEvent = null;

    if (result.ok) {
      successes += 1;
      failures = 0;
      const nextStatus = result.responseMs >= target.degraded_threshold_ms ? 'degraded' : 'up';
      if (previousStatus === 'down') {
        alertEvent = buildUptimeAlert(
          target,
          { kind: 'recovery', result: { ...result, status: nextStatus }, downSince },
        );
        downSince = null;
      }
      if (nextStatus !== previousStatus) stateChangedAt = now;
      status = nextStatus;
    } else {
      successes = 0;
      failures += 1;
      if (previousStatus !== 'down' && failures >= target.failure_threshold) {
        status = 'down';
        downSince = now;
        stateChangedAt = now;
        alertEvent = buildUptimeAlert(target, { kind: 'down', result: { ...result, status: 'down' }, downSince });
      } else if (previousStatus === 'down') {
        status = 'down';
      }
    }

    const updated = await client.query(
      `UPDATE targets SET
         uptime_status = $2,
         consecutive_failures = $3,
         consecutive_successes = $4,
         down_since = $5,
         last_checked_at = $6,
         last_status_code = $7,
         last_response_ms = $8,
         last_error = $9,
         last_state_change_at = $10,
         updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        target.id,
        status,
        failures,
        successes,
        downSince,
        now,
        result.statusCode ?? null,
        result.responseMs ?? null,
        result.ok ? null : result.errorMessage || result.errorType || 'خطای نامشخص',
        stateChangedAt,
      ],
    );
    if (!updated.rowCount) return { skipped: true };

    await client.query(
      `INSERT INTO uptime_checks (target_id, checked_at, ok, status_code, response_ms, error_type, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        target.id,
        now,
        result.ok,
        result.statusCode ?? null,
        result.responseMs ?? null,
        result.errorType || null,
        result.errorMessage || null,
      ],
    );

    let alertCreated = false;
    if (alertEvent) alertCreated = await enqueueAlert(client, alertEvent);

    return {
      skipped: false,
      status,
      previousStatus,
      alertCreated,
      alertKind: alertEvent?.kind || null,
    };
  });
}
