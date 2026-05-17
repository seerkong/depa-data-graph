import type { DataGraph, GraphNodeIdLike, StopHandle } from 'depa-data-graph-core';
import { watch } from 'depa-data-graph-core';

export type BindElementOptions<TElement, TValue> = {
  property: keyof TElement & string;
  format?: (value: TValue) => TElement[keyof TElement];
};

export function bindElement<TRuntime, TElement extends Record<string, unknown>, TValue = unknown>(
  graph: DataGraph<TRuntime>,
  id: GraphNodeIdLike,
  element: TElement,
  options: BindElementOptions<TElement, TValue>,
): StopHandle {
  const prop = options.property;

  const apply = (value: TValue) => {
    const formatted = options.format
      ? options.format(value)
      : ((value == null ? '' : String(value)) as unknown as TElement[keyof TElement]);

    element[prop] = formatted as unknown as TElement[typeof prop];
  };

  apply(graph.get<TValue>(id));

  return watch(
    () => graph.get<TValue>(id),
    (value: TValue) => {
      apply(value);
    },
  );
}

export type ReactiveStore<TIds extends readonly string[]> = {
  getSnapshot: () => Record<TIds[number], unknown>;
  subscribe: (cb: (value: Record<TIds[number], unknown>) => void) => StopHandle;
};

export function createReactiveStore<TRuntime, const TIds extends readonly string[]>(
  graph: DataGraph<TRuntime>,
  ids: TIds,
): ReactiveStore<TIds> {
  const list = ids as readonly TIds[number][];

  const getSnapshot = (): Record<TIds[number], unknown> => {
    const out = {} as Record<TIds[number], unknown>;
    for (const id of list) {
      out[id] = graph.get<unknown>(id);
    }
    return out;
  };

  return {
    getSnapshot,
    subscribe(cb) {
      cb(getSnapshot());
      return watch(getSnapshot, (next: Record<TIds[number], unknown>) => cb(next));
    },
  };
}
