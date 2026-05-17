import type { DataGraph } from '../graph';
import type { GraphMiddleware, MiddlewareContext } from '../middleware';

export type PersistStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type PersistPluginOptions = {
  storage: PersistStorage;
  keys: string[];
  debounce?: number;
  storageKey?: string;
};

export function persistPlugin<TRuntime>(options: PersistPluginOptions): GraphMiddleware<TRuntime> {
  const storage = options.storage;
  const keys = [...options.keys];
  const storageKey = options.storageKey ?? 'DataGraph';
  const debounceMs = options.debounce ?? 0;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const persistNow = (graph: DataGraph<TRuntime>): void => {
    const payload: Record<string, unknown> = {};
    for (const key of keys) {
      try {
        payload[key] = graph.get<unknown>(key);
      } catch {
        // Ignore unreadable/missing nodes.
      }
    }

    storage.setItem(storageKey, JSON.stringify(payload));
  };

  const schedule = (graph: DataGraph<TRuntime>): void => {
    if (debounceMs <= 0) {
      persistNow(graph);
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      persistNow(graph);
    }, debounceMs);
  };

  const cancel = (): void => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = null;
  };

  const shouldHandle = new Set(keys);

  return {
    name: 'persist',
    afterSet: (id, _value, ctx: MiddlewareContext<TRuntime>) => {
      if (!shouldHandle.has(id)) {
        return;
      }
      schedule(ctx.graph);
    },
    onDispose: () => {
      cancel();
    },
  };
}
