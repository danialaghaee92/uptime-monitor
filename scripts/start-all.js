import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// اجرای ساده هر دو نقش (وب و کارگر) در یک سرویس PaaS.
// برای استقرارهای بزرگ‌تر، وب و کارگر را در دو سرویس جدا اجرا کنید.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const migrate = spawnSync(process.execPath, [path.join(root, 'scripts', 'migrate.js')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

if (migrate.status !== 0) {
  console.error('[supervisor] اجرای migration ناموفق بود؛ برنامه بالا نمی‌آید.');
  process.exit(migrate.status ?? 1);
}

const children = new Map();
let stopping = false;

function start(name, script) {
  const child = spawn(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  children.set(name, child);

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (stopping) return;
    console.error(`[supervisor] ${name} متوقف شد (${code ?? signal})؛ تلاش مجدد تا ۳ ثانیه دیگر.`);
    setTimeout(() => {
      if (!stopping) start(name, script);
    }, 3000);
  });
}

start('web', 'src/server.js');
start('worker', 'src/worker.js');

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) {
    try {
      child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
