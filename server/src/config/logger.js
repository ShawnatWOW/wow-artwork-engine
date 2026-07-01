// Structured logging. Uses pino when installed; falls back to a tiny
// console-backed shim so the spikes and unit tests can run before
// `npm install`. The shim implements the subset of the pino API we use.
let logger;

try {
  const { default: pino } = await import('pino');
  const level = process.env.LOG_LEVEL || 'info';
  const wantsPretty = process.env.NODE_ENV !== 'production';
  try {
    // Pretty output in dev if pino-pretty is installed.
    logger = pino(
      wantsPretty
        ? { level, transport: { target: 'pino-pretty', options: { colorize: true } } }
        : { level },
    );
  } catch {
    // pino-pretty not installed → plain JSON pino rather than the shim.
    logger = pino({ level });
  }
} catch {
  const order = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
  const threshold = order[process.env.LOG_LEVEL] || order.info;
  const emit = (level) => (obj, msg) => {
    if (order[level] < threshold) return;
    const line = typeof obj === 'string' ? obj : msg || '';
    const ctx = typeof obj === 'object' ? ` ${JSON.stringify(obj)}` : '';
    // eslint-disable-next-line no-console
    console[level === 'fatal' ? 'error' : level === 'trace' ? 'debug' : level](
      `[${level}] ${line}${ctx}`.trim(),
    );
  };
  logger = {
    level: process.env.LOG_LEVEL || 'info',
    trace: emit('trace'),
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('fatal'),
    child() {
      return logger;
    },
  };
}

export default logger;
