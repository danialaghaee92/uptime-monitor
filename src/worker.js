import { config, assertBaseConfig } from './config.js';
import { ping, closePool } from './db.js';
import { createLogger } from './lib/logger.js';
import { startMonitorWorker } from './services/monitorWorker.js';

const logger = createLogger(config.logLevel, 'worker-main');

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
  if (!ready) throw new Error('اتصال به PostgreSQL برقرار نشد.');

  const worker = startMonitorWorker();
  logger.info('✅ کارگر پایش شروع به کار کرد.');

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`دریافت ${signal}؛ توقف کارگر...`);
    await worker.stop();
    await closePool().catch(() => {});
    process.exit(0);
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
