import pg from 'pg';
import { config } from './config.js';
import { createLogger } from './lib/logger.js';

const { Pool, types } = pg;

// شناسه‌های BIGSERIAL و تعدادها را به number تبدیل می‌کنیم (مقادیر در محدوده امن هستند).
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  application_name: 'didehban',
});

const logger = createLogger(config.logLevel, 'db');

pool.on('error', (err) => {
  logger.error('خطای غیرمنتظره در pool دیتابیس:', err.message);
});

export function query(text, params = []) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function ping() {
  const result = await query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

export async function closePool() {
  await pool.end();
}
