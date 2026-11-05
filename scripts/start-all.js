import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertBaseConfig } from '../src/config.js';
import { ping, closePool } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';
import { createApp } from '../src/server.js';
import { ensureInitialAdmin } from '../src/services/auth.js';
import { startMonitorWorker } from '../src/services/monitorWorker.js';

// اجرای وب و کارگر در یک پروسه برای کاهش مصرف RAM در پلن‌های کوچک PaaS.
// migration در یک پروسه کوتاه‌عمر اجرا می‌شود و بعد خارج می‌شود.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logger = createLogger(config.logLevel, 'app');

const migrate = spawnSync(process.execPath, [path.join(root, 'scripts', 'migrate.js')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

if (migrate.status !== 0) {
  console.error('[app] اجرای migration ناموفق بود؛ برنامه بالا نمی‌آید.');
  process.exit(migrate.status ?? 1);
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

  const worker = startMonitorWorker();
  logger.info('✅ کارگر پایش در همان پروسه شروع به کار کرد.');

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`دریافت ${signal}؛ خاموش شدن...`);
    await worker.stop();
    server.close(async () => {
      await closePool().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error('unhandledRejection:', err?.message || err));
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException:', err?.stack || err);
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
