-- 001_init.sql — ساختار اولیه سامانه پایش دامنه و SSL
-- همه زمان‌ها با timestamptz (UTC) ذخیره می‌شوند.

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  csrf_token  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS targets (
  id                          BIGSERIAL PRIMARY KEY,
  url                         TEXT NOT NULL,
  url_key                     TEXT NOT NULL UNIQUE,
  hostname                    TEXT NOT NULL,
  port                        INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  display_name                TEXT NOT NULL,
  category                    TEXT NOT NULL DEFAULT 'عمومی',
  tags                        TEXT[] NOT NULL DEFAULT '{}',
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  allow_private               BOOLEAN NOT NULL DEFAULT FALSE,

  uptime_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  uptime_interval_seconds     INTEGER NOT NULL DEFAULT 60 CHECK (uptime_interval_seconds BETWEEN 10 AND 86400),
  timeout_seconds             INTEGER NOT NULL DEFAULT 10 CHECK (timeout_seconds BETWEEN 1 AND 120),
  degraded_threshold_ms       INTEGER NOT NULL DEFAULT 3000 CHECK (degraded_threshold_ms BETWEEN 100 AND 600000),
  failure_threshold           INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 20),
  accepted_status_codes       TEXT NOT NULL DEFAULT '200-399',

  ssl_enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
  ssl_interval_seconds        INTEGER CHECK (ssl_interval_seconds IS NULL OR ssl_interval_seconds BETWEEN 60 AND 604800),

  uptime_status               TEXT NOT NULL DEFAULT 'unknown' CHECK (uptime_status IN ('unknown', 'up', 'degraded', 'down')),
  consecutive_failures        INTEGER NOT NULL DEFAULT 0,
  consecutive_successes       INTEGER NOT NULL DEFAULT 0,
  down_since                  TIMESTAMPTZ,
  last_checked_at             TIMESTAMPTZ,
  last_status_code            INTEGER,
  last_response_ms            INTEGER,
  last_error                  TEXT,
  last_state_change_at        TIMESTAMPTZ,
  uptime_next_check_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  ssl_status                  TEXT NOT NULL DEFAULT 'unknown' CHECK (ssl_status IN ('unknown', 'ok', 'expiring', 'invalid')),
  ssl_expires_at              TIMESTAMPTZ,
  ssl_days_left               INTEGER,
  ssl_issuer                  TEXT,
  ssl_error                   TEXT,
  ssl_tls_version             TEXT,
  ssl_last_checked_at         TIMESTAMPTZ,
  ssl_state_change_at         TIMESTAMPTZ,
  ssl_next_check_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS targets_uptime_due_idx ON targets(uptime_next_check_at) WHERE is_active AND uptime_enabled;
CREATE INDEX IF NOT EXISTS targets_ssl_due_idx ON targets(ssl_next_check_at) WHERE is_active AND ssl_enabled;
CREATE INDEX IF NOT EXISTS targets_category_idx ON targets(category);

CREATE TABLE IF NOT EXISTS uptime_checks (
  id            BIGSERIAL PRIMARY KEY,
  target_id     BIGINT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok            BOOLEAN NOT NULL,
  status_code   INTEGER,
  response_ms   INTEGER,
  error_type    TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS uptime_checks_target_time_idx ON uptime_checks(target_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS uptime_checks_time_idx ON uptime_checks(checked_at);

CREATE TABLE IF NOT EXISTS ssl_checks (
  id            BIGSERIAL PRIMARY KEY,
  target_id     BIGINT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok            BOOLEAN NOT NULL,
  status        TEXT NOT NULL,
  expires_at    TIMESTAMPTZ,
  days_left     INTEGER,
  issuer        TEXT,
  tls_version   TEXT,
  error_type    TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS ssl_checks_target_time_idx ON ssl_checks(target_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS ssl_checks_time_idx ON ssl_checks(checked_at);

CREATE TABLE IF NOT EXISTS alert_events (
  id          BIGSERIAL PRIMARY KEY,
  target_id   BIGINT REFERENCES targets(id) ON DELETE CASCADE,
  dedupe_key  TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_events_time_idx ON alert_events(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  event_id        BIGINT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, channel)
);
CREATE INDEX IF NOT EXISTS notifications_due_idx ON notifications(next_attempt_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('global_ssl_interval_seconds',     '300'::jsonb),
  ('default_uptime_interval_seconds', '60'::jsonb),
  ('default_timeout_seconds',         '10'::jsonb),
  ('default_failure_threshold',       '3'::jsonb),
  ('default_degraded_threshold_ms',   '3000'::jsonb),
  ('default_accepted_status_codes',   '"200-399"'::jsonb),
  ('history_retention_days',          '90'::jsonb),
  ('allow_private_targets',           'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
