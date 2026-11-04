-- 002_indexes.sql — ایندکس‌های تکمیلی برای محاسبه Uptime و پاک‌سازی تاریخچه

-- محاسبه درصد Uptime در ۲۴ ساعت/۷ روز/۳۰ روز بدون مراجعه به جدول اصلی.
CREATE INDEX IF NOT EXISTS uptime_checks_target_time_ok_idx
  ON uptime_checks (target_id, checked_at DESC)
  INCLUDE (ok);

-- پاک‌سازی دوره‌ای تاریخچه بر اساس زمان.
CREATE INDEX IF NOT EXISTS uptime_checks_checked_at_brin_idx
  ON uptime_checks USING BRIN (checked_at)
  WITH (pages_per_range = 64);

CREATE INDEX IF NOT EXISTS ssl_checks_checked_at_brin_idx
  ON ssl_checks USING BRIN (checked_at)
  WITH (pages_per_range = 64);
