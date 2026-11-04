import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from '../src/db.js';
import { assertBaseConfig } from '../src/config.js';
import { createLogger } from '../src/lib/logger.js';

const logger = createLogger('info', 'migrate');
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', 'migrations');
const LOCK_ID = 727272;

export async function runMigrations() {
  assertBaseConfig();
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((row) => row.filename),
    );

    const files = (await fs.readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      if (applied.has(filename)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
      logger.info(`اجرای migration: ${filename}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        logger.info(`✅ ${filename} اعمال شد.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`اجرای ${filename} ناموفق بود: ${err.message}`);
      }
    }
    logger.info('همه migrationها به‌روز هستند.');
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runMigrations()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error(err.message);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
