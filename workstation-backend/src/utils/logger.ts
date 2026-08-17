type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type LogMeta = Record<string, unknown>;

const SENSITIVE_KEYS = /password|secret|token|authorization|cookie|api[_-]?key|pepper/i;

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(nested);
  }
  return out;
}

function emit(level: LogLevel, message: string, meta?: unknown): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta === undefined ? {} : { meta: redact(meta) }),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug') {
    if (process.env.NODE_ENV !== 'production') console.debug(line);
  } else console.log(line);
}

export const logger = {
  info(message: string, meta?: LogMeta | unknown) {
    emit('info', message, meta);
  },
  warn(message: string, meta?: LogMeta | unknown) {
    emit('warn', message, meta);
  },
  error(message: string, meta?: LogMeta | unknown) {
    emit('error', message, meta);
  },
  debug(message: string, meta?: LogMeta | unknown) {
    emit('debug', message, meta);
  },
};
