import type { Setter } from '../graph';
import type { GraphMiddleware, MiddlewareContext } from '../middleware';

export type ValidationRule = (value: unknown) => string | null | undefined;

export type ValidationPluginOptions = {
  rules: Record<string, ValidationRule>;
  logger?: Pick<Console, 'warn'>;
};

function resolveNextValue<TRuntime>(
  id: string,
  value: Setter<unknown>,
  ctx: MiddlewareContext<TRuntime>,
): unknown {
  if (typeof value !== 'function') {
    return value;
  }

  try {
    const prev = ctx.graph.get<unknown>(id);
    return (value as (prev: unknown) => unknown)(prev);
  } catch {
    return undefined;
  }
}

export function validationPlugin<TRuntime>(
  options: ValidationPluginOptions,
): GraphMiddleware<TRuntime> {
  const rules = options.rules;
  const logger = options.logger ?? console;

  return {
    name: 'validation',
    beforeSet: <T>(id: string, value: Setter<T>, ctx: MiddlewareContext<TRuntime>) => {
      const rule = rules[id];
      if (!rule) {
        return value;
      }

      const nextValue = resolveNextValue(id, value as unknown as Setter<unknown>, ctx);
      const message = rule(nextValue);

      if (message) {
        logger.warn(`[DataGraph] ${id}: ${message}`);
        return undefined;
      }

      return value;
    },
  };
}
