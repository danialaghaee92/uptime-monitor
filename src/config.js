import 'dotenv/config';

function envInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`مقدار ${name} باید عددی بین ${min} و ${max} باشد.`);
  }
  return value;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function envStr(name, fallback = '') {
  const raw = process.env[name];
  return raw === undefined ? fallback : String(raw).trim();
}

const logLevel = envStr('LOG_LEVEL', 'info').toLowerCase();

export const config = {
  env: envStr('NODE_ENV', 'development'),
  port: envInt('PORT', 3000, 1, 65535),
  baseUrl: envStr('APP_BASE_URL', 'http://localhost:3000'),
  timezone: envStr('APP_TIMEZONE', 'Asia/Tehran') || 'Asia/Tehran',

  databaseUrl: envStr('DATABASE_URL'),
  databaseSsl: envBool('DATABASE_SSL', false),
  pgPoolMax: envInt('PG_POOL_MAX', 20, 1, 200),

  sessionTtlHours: envInt('SESSION_TTL_HOURS', 12, 1, 24 * 30),
  sessionCookieSecure: envBool('SESSION_COOKIE_SECURE', false),
  trustProxy: envBool('TRUST_PROXY', false),

  adminUsername: envStr('ADMIN_USERNAME', 'admin'),
  adminPassword: envStr('ADMIN_PASSWORD'),
  seedAdminOnStart: envBool('SEED_ADMIN_ON_START', true),

  workerBatchSize: envInt('WORKER_BATCH_SIZE', 50, 1, 500),
  workerConcurrency: envInt('WORKER_CONCURRENCY', 50, 1, 200),

  logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info',

  smtp: {
    host: envStr('SMTP_HOST'),
    port: envInt('SMTP_PORT', 587, 1, 65535),
    secure: envBool('SMTP_SECURE', false),
    user: envStr('SMTP_USER'),
    pass: envStr('SMTP_PASS'),
    from: envStr('SMTP_FROM'),
    to: envStr('ALERT_EMAIL_TO'),
  },

  telegram: {
    botToken: envStr('TELEGRAM_BOT_TOKEN'),
    chatId: envStr('TELEGRAM_CHAT_ID'),
  },

  webhook: {
    url: envStr('WEBHOOK_URL'),
    secret: envStr('WEBHOOK_SECRET'),
  },
};

export function assertBaseConfig() {
  if (!config.databaseUrl) {
    throw new Error('متغیر محیطی DATABASE_URL تنظیم نشده است.');
  }
}

export function enabledAlertChannels() {
  const channels = [];
  if (config.smtp.host && config.smtp.from && config.smtp.to) channels.push('email');
  if (config.telegram.botToken && config.telegram.chatId) channels.push('telegram');
  if (config.webhook.url) channels.push('webhook');
  return channels;
}
