import { query } from '../db.js';
import { createLogger } from '../lib/logger.js';
import { config } from '../config.js';
import { getEnabledChannels, sendViaChannel } from './notifiers.js';

const logger = createLogger(config.logLevel, 'notifications');

const BACKOFF_MINUTES = [1, 5, 15, 60, 180];

export async function claimPendingNotifications(limit = 20) {
  const claimed = await query(
    `WITH due AS (
       SELECT id FROM notifications
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY next_attempt_at ASC, id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE notifications n
     SET attempts = n.attempts + 1,
         next_attempt_at = now() + interval '1 minute'
     FROM due
     WHERE n.id = due.id
     RETURNING n.*`,
    [limit],
  );
  if (!claimed.rows.length) return [];

  const eventIds = [...new Set(claimed.rows.map((row) => row.event_id))];
  const events = await query('SELECT * FROM alert_events WHERE id = ANY($1::bigint[])', [eventIds]);
  const byId = new Map(events.rows.map((row) => [row.id, row]));
  return claimed.rows
    .map((row) => ({ notification: row, event: byId.get(row.event_id) }))
    .filter((item) => item.event);
}

async function markSent(notificationId) {
  await query(
    `UPDATE notifications SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1`,
    [notificationId],
  );
}

async function markFailed(notificationId, error, { final = false, attempts }) {
  const message = String(error?.message || error || 'خطای نامشخص').slice(0, 1000);
  if (final) {
    await query(
      `UPDATE notifications SET status = 'failed', last_error = $2 WHERE id = $1`,
      [notificationId, message],
    );
    return;
  }
  const minutes = BACKOFF_MINUTES[Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)];
  await query(
    `UPDATE notifications
     SET last_error = $2, next_attempt_at = now() + ($3 || ' minutes')::interval
     WHERE id = $1`,
    [notificationId, message, String(minutes)],
  );
}

export async function dispatchPendingNotifications(limit = 20) {
  const jobs = await claimPendingNotifications(limit);
  if (!jobs.length) return { processed: 0, sent: 0, failed: 0, retried: 0 };

  const enabled = new Set(getEnabledChannels());
  const result = { processed: jobs.length, sent: 0, failed: 0, retried: 0 };

  for (const { notification, event } of jobs) {
    if (!enabled.has(notification.channel)) {
      await markFailed(notification.id, new Error('این کانال در متغیرهای محیطی فعال نیست.'), { final: true, attempts: notification.attempts });
      result.failed += 1;
      continue;
    }

    try {
      await sendViaChannel(notification.channel, event);
      await markSent(notification.id);
      result.sent += 1;
    } catch (err) {
      const final = notification.attempts >= notification.max_attempts;
      await markFailed(notification.id, err, { final, attempts: notification.attempts });
      if (final) {
        result.failed += 1;
        logger.error(`ارسال هشدار ${event.id} از کانال ${notification.channel} پس از ${notification.attempts} تلاش شکست خورد: ${err.message}`);
      } else {
        result.retried += 1;
        logger.warn(`ارسال هشدار ${event.id} از کانال ${notification.channel} ناموفق بود؛ تلاش بعدی: ${err.message}`);
      }
    }
  }

  return result;
}
