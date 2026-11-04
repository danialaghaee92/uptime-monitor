import { query } from '../db.js';
import { getSettings } from './settings.js';

function percent(ok, total) {
  if (!total) return null;
  return Math.round((Number(ok) / Number(total)) * 1000) / 10;
}

async function getSparklines(targetIds) {
  if (!targetIds.length) return new Map();
  const result = await query(
    `SELECT t.id AS target_id, s.checked_at, s.response_ms, s.ok
     FROM targets t
     CROSS JOIN LATERAL (
       SELECT checked_at, response_ms, ok
       FROM uptime_checks
       WHERE target_id = t.id
       ORDER BY checked_at DESC
       LIMIT 30
     ) s
     WHERE t.id = ANY($1::bigint[])
     ORDER BY t.id, s.checked_at ASC`,
    [targetIds],
  );
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.target_id)) map.set(row.target_id, []);
    map.get(row.target_id).push({
      t: row.checked_at,
      ms: row.response_ms,
      ok: row.ok,
    });
  }
  return map;
}

export async function getUptimeDashboard() {
  const settings = await getSettings();
  const result = await query(
    `SELECT t.*,
            COALESCE(c.c24, 0) AS c24, COALESCE(c.ok24, 0) AS ok24,
            COALESCE(c.c7, 0)  AS c7,  COALESCE(c.ok7, 0)  AS ok7,
            COALESCE(c.c30, 0) AS c30, COALESCE(c.ok30, 0) AS ok30
     FROM targets t
     LEFT JOIN (
       SELECT target_id,
              COUNT(*) FILTER (WHERE checked_at > now() - interval '24 hours') AS c24,
              COUNT(*) FILTER (WHERE checked_at > now() - interval '24 hours' AND ok) AS ok24,
              COUNT(*) FILTER (WHERE checked_at > now() - interval '7 days') AS c7,
              COUNT(*) FILTER (WHERE checked_at > now() - interval '7 days' AND ok) AS ok7,
              COUNT(*) FILTER (WHERE checked_at > now() - interval '30 days') AS c30,
              COUNT(*) FILTER (WHERE checked_at > now() - interval '30 days' AND ok) AS ok30
       FROM uptime_checks
       WHERE checked_at > now() - interval '30 days'
       GROUP BY target_id
     ) c ON c.target_id = t.id
     WHERE t.is_active AND t.uptime_enabled
     ORDER BY t.display_name ASC`,
  );

  const rows = result.rows;
  const sparklines = await getSparklines(rows.map((row) => row.id));
  const summary = { total: rows.length, up: 0, degraded: 0, down: 0, unknown: 0 };

  const targets = rows.map((row) => {
    if (row.uptime_status in summary) summary[row.uptime_status] += 1;
    return {
      id: row.id,
      url: row.url,
      hostname: row.hostname,
      displayName: row.display_name,
      category: row.category,
      tags: row.tags || [],
      uptimeEnabled: row.uptime_enabled,
      sslEnabled: row.ssl_enabled,
      status: row.uptime_status,
      consecutiveFailures: row.consecutive_failures,
      failureThreshold: row.failure_threshold,
      statusCode: row.last_status_code,
      responseMs: row.last_response_ms,
      error: row.last_error,
      lastCheckedAt: row.last_checked_at,
      stateChangeAt: row.last_state_change_at,
      intervalSeconds: row.uptime_interval_seconds,
      timeoutSeconds: row.timeout_seconds,
      degradedThresholdMs: row.degraded_threshold_ms,
      uptime: {
        h24: percent(row.ok24, row.c24),
        d7: percent(row.ok7, row.c7),
        d30: percent(row.ok30, row.c30),
        checks24: Number(row.c24),
        checks7d: Number(row.c7),
        checks30d: Number(row.c30),
      },
      sparkline: sparklines.get(row.id) || [],
    };
  });

  return {
    summary,
    targets,
    generatedAt: new Date().toISOString(),
    settings: { defaultUptimeIntervalSeconds: settings.default_uptime_interval_seconds },
  };
}

export async function getSslDashboard() {
  const settings = await getSettings();
  const result = await query(
    `SELECT * FROM targets
     WHERE is_active AND ssl_enabled
     ORDER BY display_name ASC`,
  );

  const summary = { total: result.rows.length, ok: 0, expiring: 0, invalid: 0, unknown: 0 };
  const targets = result.rows.map((row) => {
    if (row.ssl_status in summary) summary[row.ssl_status] += 1;
    return {
      id: row.id,
      url: row.url,
      hostname: row.hostname,
      displayName: row.display_name,
      category: row.category,
      tags: row.tags || [],
      uptimeEnabled: row.uptime_enabled,
      sslEnabled: row.ssl_enabled,
      status: row.ssl_status,
      expiresAt: row.ssl_expires_at,
      daysLeft: row.ssl_days_left,
      issuer: row.ssl_issuer,
      error: row.ssl_error,
      tlsVersion: row.ssl_tls_version,
      lastCheckedAt: row.ssl_last_checked_at,
      stateChangeAt: row.ssl_state_change_at,
      intervalSeconds: row.ssl_interval_seconds ?? settings.global_ssl_interval_seconds,
      sslIntervalOverride: row.ssl_interval_seconds,
      port: row.port,
    };
  });

  return {
    summary,
    targets,
    generatedAt: new Date().toISOString(),
    settings: { globalSslIntervalSeconds: settings.global_ssl_interval_seconds },
  };
}
