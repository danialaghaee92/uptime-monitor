const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info', scope = 'app') {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (name, args) => {
    if (LEVELS[name] < min) return;
    const line = `${new Date().toISOString()} [${name.toUpperCase()}] [${scope}]`;
    const fn = name === 'error' ? console.error : name === 'warn' ? console.warn : console.log;
    fn(line, ...args);
  };
  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    child: (childScope) => createLogger(level, `${scope}:${childScope}`),
  };
}
