import { config, assertBaseConfig } from '../src/config.js';
import { ensureInitialAdmin } from '../src/services/auth.js';
import { closePool } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';

const logger = createLogger(config.logLevel, 'seed-admin');
const force = process.argv.includes('--force');

async function main() {
  assertBaseConfig();
  if (!config.adminPassword) {
    throw new Error('برای ساخت ادمین، ADMIN_PASSWORD را در .env تنظیم کنید.');
  }
  const result = await ensureInitialAdmin({ forcePassword: force, silent: false });
  if (result.created) logger.info('ادمین اولیه با موفقیت ساخته شد.');
  else if (result.updated) logger.info('رمز ادمین به‌روزرسانی شد.');
  else if (result.reason === 'exists') logger.info('کاربر از قبل وجود دارد؛ برای بازنشانی رمز از --force استفاده کنید.');
  await closePool();
}

main().catch(async (err) => {
  logger.error(err.message);
  await closePool().catch(() => {});
  process.exit(1);
});
