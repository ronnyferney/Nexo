/** Logger JSON (una línea por evento) en stdout/stderr. Nunca recibe credenciales, SQL ni datos de filas. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const min = RANK[level] ?? RANK.info;
  const write = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: Record<string, unknown>) => {
    if (RANK[lvl] < min) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields });
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export const silentLogger: Logger = createLogger('silent');
