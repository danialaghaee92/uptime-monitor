import { query } from '../db.js';
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { mapLimit, sleep } from '../lib/utils.js';
import { checkUptime } from './uptimeChecker.js';
import { checkSsl } from './sslChecker.js';
import { applyUptimeCheck } from './uptimeState.js';
import { applySslCheck } from './sslState.js';
import { dispatchPendingNotifications } from './notificationDispatcher.js';
import { getSettings } from './settings.js';

const logger = createLogger(config.logLevel, 'worker');

async function claimUptimeJobs() {
  const result = await query(
    `WITH due AS (
       SELECT id FROM targets
       WHERE is_active AND uptime_enabled AND (uptime_next_check_at IS NULL OR uptime_next_check_at <= now())
       ORDER BY uptime_next_check_at ASC NULLS FIRST
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE targets t
     SET uptime_next_check_at = now() + make_interval(secs => t.uptime_interval_seconds)
     FROM due
     WHERE t.id = due.id
     RETURNING t.*`,
    [config.workerBatchSize],
  );
  return result.rows;
}

async function claimSslJobs() {
  const result = await query(
    `WITH due AS (
       SELECT id FROM targets
       WHERE is_active AND ssl_enabled AND (ssl_next_check_at IS NULL OR ssl_next_check_at <= now())
       ORDER BY ssl_next_check_at ASC NULLS FIRST
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE targets t
     SET ssl_next_check_at = now() + make_interval(
       secs => COALESCE(
         t.ssl_interval_seconds,
         (SELECT COALESCE((s.value #>> '{}')::int, 300) FROM settings s WHERE s.key = 'global_ssl_interval_seconds'),
         300
       )
     )
     FROM due
     WHERE t.id = due.id
     RETURNING t.*`,
    [config.workerBatchSize],
  );
  return result.rows;
}

async function runUptimeBatch() {
  const jobs = await claimUptimeJobs();
  if (!jobs.length) return 0;
  logger.debug(`${jobs.length} بررسی uptime در صف اجرا`);
  await mapLimit(jobs, config.workerConcurrency, async (target) => {
    try {
      const result = await checkUptime(target);
      const applied = await applyUptimeCheck(target, result);
      if (applied.skipped) return;
      if (applied.alertCreated) {
        logger.info(`هشدار ${applied.alertKind} برای ${target.display_name} ثبت شد.`);
      }
      if (config.logLevel === 'debug') {
        logger.debug(
          `${target.display_name}: ${result.ok ? 'OK' : 'FAIL'} ${result.statusCode ?? '-'} ${result.responseMs}ms`,
        );
      }
    } catch (err) {
      logger.error(`بررسی uptime ${target.display_name} شکست خورد:`, err.message);
    }
  });
  return jobs.length;
}

async function runSslBatch() {
  const jobs = await claimSslJobs();
  if (!jobs.length) return 0;
  logger.debug(`${jobs.length} بررسی SSL در صف اجرا`);
  await mapLimit(jobs, config.workerConcurrency, async (target) => {
    try {
      const result = await checkSsl(target);
      const applied = await applySslCheck(target, result);
      if (applied.skipped) return;
      if (applied.alertsCreated) {
        logger.info(`${applied.alertsCreated} هشدار SSL برای ${target.display_name} ثبت شد.`);
      }
      if (config.logLevel === 'debug') {
        logger.debug(
          `${target.display_name}: SSL ${result.status} days=${result.daysLeft ?? '-'} ${result.tlsVersion || ''}`,
        );
      }
    } catch (err) {
      logger.error(`بررسی SSL ${target.display_name} شکست خورد:`, err.message);
    }
  });
  return jobs.length;
}

async function runCleanup() {
  try {
    const settings = await getSettings();
    const days = Number(settings.history_retention_days) || 0;
    if (days > 0) {
      const uptime = await query(
        `DELETE FROM uptime_checks WHERE checked_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      );
      const ssl = await query(
        `DELETE FROM ssl_checks WHERE checked_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      );
      if (uptime.rowCount || ssl.rowCount) {
        logger.info(`پاک‌سازی تاریخچه: ${uptime.rowCount} رکورد uptime و ${ssl.rowCount} رکورد SSL حذف شد.`);
      }
    }
    await query('DELETE FROM sessions WHERE expires_at <= now()');
    await query(`DELETE FROM notifications WHERE status IN ('sent', 'failed') AND created_at < now() - interval '30 days'`);
    await query(
      `DELETE FROM alert_events ae WHERE ae.created_at < now() - interval '180 days'
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.event_id = ae.id AND n.status = 'pending')`,
    );
  } catch (err) {
    logger.error('خطا در پاک‌سازی دوره‌ای:', err.message);
  }
}

export function startMonitorWorker() {
  let stopped = false;
  let wake = null;
  const stoppedPromise = new Promise((resolve) => {
    wake = resolve;
  });

  // خواب قابل قطع: هنگام SIGTERM بدون منتظر ماندن تا پایان بازه طولانی برمی‌گردد.
  const wait = (ms) => Promise.race([sleep(ms), stoppedPromise]);

  async function uptimeLoop() {
    while (!stopped) {
      try {
        const count = await runUptimeBatch();
        if (!count) await wait(1000);
      } catch (err) {
        logger.error('خطا در حلقه uptime:', err.message);
        await wait(3000);
      }
    }
  }

  async function sslLoop() {
    while (!stopped) {
      try {
        const count = await runSslBatch();
        if (!count) await wait(1000);
      } catch (err) {
        logger.error('خطا در حلقه SSL:', err.message);
        await wait(3000);
      }
    }
  }

  async function notificationLoop() {
    while (!stopped) {
      try {
        const result = await dispatchPendingNotifications(20);
        if (!result.processed) await wait(2000);
      } catch (err) {
        logger.error('خطا در ارسال هشدارها:', err.message);
        await wait(5000);
      }
    }
  }

  async function cleanupLoop() {
    await wait(10_000);
    while (!stopped) {
      await runCleanup();
      await wait(60 * 60 * 1000);
    }
  }

  const loops = [uptimeLoop(), sslLoop(), notificationLoop(), cleanupLoop()];

  return {
    async stop() {
      stopped = true;
      wake?.();
      await Promise.allSettled(loops);
    },
  };
}
