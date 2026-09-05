import type { Logger } from '../types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  prefix?: string;
  stream?: { write(chunk: string): unknown };
}

export function createLogger(options: ConsoleLoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const prefix = options.prefix ? `${options.prefix} ` : '';
  const stream = options.stream ?? process.stderr;
  const emit = (lvl: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const tail = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    stream.write(`${prefix}${lvl.padEnd(5)} ${msg}${tail}\n`);
  };
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
  };
}

/** Collects log lines instead of printing them. Used by tests and the console. */
export function createMemoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (lvl: string) => (m: string, meta?: Record<string, unknown>) => {
    lines.push(`${lvl} ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
  };
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}
