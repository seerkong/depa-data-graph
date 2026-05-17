import type { Setter } from '../graph';
import type { GraphMiddleware, MiddlewareContext } from '../middleware';

export type LoggerLevel = 'debug' | 'info' | 'warn' | 'error';

export type LoggerPluginOptions = {
  level?: LoggerLevel;
  prefix?: string;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error' | 'log'>;
};

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function pickLoggerFn(
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error' | 'log'>,
  level: LoggerLevel,
): (msg: string) => void {
  switch (level) {
    case 'debug':
      return logger.debug?.bind(logger) ?? logger.log.bind(logger);
    case 'info':
      return logger.info?.bind(logger) ?? logger.log.bind(logger);
    case 'warn':
      return logger.warn?.bind(logger) ?? logger.log.bind(logger);
    case 'error':
      return logger.error?.bind(logger) ?? logger.log.bind(logger);
    default: {
      const _exhaustive: never = level;
      return logger.log.bind(logger);
    }
  }
}

export function loggerPlugin<TRuntime>(
  options: LoggerPluginOptions = {},
): GraphMiddleware<TRuntime> {
  const prefix = options.prefix ?? '[DataGraph]';
  const level = options.level ?? 'debug';
  const logger = options.logger ?? console;

  const log = pickLoggerFn(logger, level);

  return {
    name: 'logger',
    afterSet: <T>(id: string, value: Setter<T>, ctx: MiddlewareContext<TRuntime>) => {
      let current: unknown;
      try {
        current = ctx.graph.get<unknown>(id);
      } catch {
        current = typeof value === 'function' ? '<setter>' : (value as unknown);
      }

      log(`${prefix} ${id} = ${formatValue(current)}`);
    },
  };
}
