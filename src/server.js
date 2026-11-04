import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config, assertBaseConfig } from './config.js';
import { closePool, ping } from './db.js';
import { createLogger } from './lib/logger.js';
import { toPublicError } from './lib/errors.js';
import { loadSession, requireCsrf, requirePageAdmin, requirePageAuth } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminTargetsRouter } from './routes/adminTargets.js';
import { adminUsersRouter } from './routes/adminUsers.js';
import { adminSettingsRouter } from './routes/adminSettings.js';
import { ensureInitialAdmin } from './services/auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const logger = createLogger(config.logLevel, 'server');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use('/assets', express.static(path.join(publicDir, 'assets'), { maxAge: '1h', index: false }));
  app.get('/favicon.svg', (req, res) => res.sendFile(path.join(publicDir, 'favicon.svg')));

  app.get('/healthz', async (req, res) => {
    try {
      await ping();
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use(loadSession);

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'login' });
  app.use('/api/auth/login', loginLimiter);

  // همه درخواست‌های تغییردهنده API نیازمند CSRF هستند (به‌جز login که توکن pre-csrf دارد).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path === '/auth/login') return next();
    return requireCsrf(req, res, next);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/admin', adminTargetsRouter);
  app.use('/api/admin', adminUsersRouter);
  app.use('/api/admin', adminSettingsRouter);

  app.get('/', (req, res) => res.redirect(302, req.auth ? '/dashboard' : '/login'));

  app.get('/login', (req, res) => {
    if (req.auth) return res.redirect(302, '/dashboard');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'login.html'));
  });

  app.get('/dashboard', requirePageAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'dashboard.html'));
  });

  app.get('/ssl', requirePageAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'ssl.html'));
  });

  app.get('/admin', requirePageAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'not_found', message: 'مسیر API یافت نشد.' });
    }
    res.status(404).sendFile(path.join(publicDir, '404.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'file_too_large', message: 'حجم فایل بیش از حد مجاز (۲ مگابایت) است.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'body_too_large', message: 'حجم درخواست بیش از حد مجاز است.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'بدنه درخواست JSON معتبر نیست.' });
    }
    if (err?.name === 'MulterError') {
      return res.status(400).json({ error: 'upload_error', message: 'خطا در دریافت فایل.' });
    }

    const { status, body } = toPublicError(err);
    if (status >= 500) {
      logger.error(`${req.method} ${req.originalUrl} → ${status}:`, err?.stack || err);
    } else {
      logger.warn(`${req.method} ${req.originalUrl} → ${status}: ${err.message}`);
    }
    if (res.headersSent) return next(err);
    return res.status(status).json(body);
  });

  return app;
}

async function main() {
  assertBaseConfig();

  let ready = false;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await ping();
      ready = true;
      break;
    } catch (err) {
      logger.warn(`اتصال به دیتابیس (تلاش ${attempt}/15) ناموفق: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (!ready) throw new Error('اتصال به PostgreSQL برقرار نشد. DATABASE_URL را بررسی کنید.');

  if (config.seedAdminOnStart) {
    await ensureInitialAdmin();
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`✅ سامانه دیده‌بان روی پورت ${config.port} بالا آمد (${config.baseUrl}).`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`دریافت ${signal}؛ خاموش شدن...`);
    server.close(async () => {
      await closePool().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    logger.error(err.message);
    process.exit(1);
  });
}
