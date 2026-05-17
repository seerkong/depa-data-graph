import { createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';

import type { DataGraph, GraphNodeIdLike } from 'depa-data-graph-core';
import { watch } from 'depa-data-graph-core';

export function useGraphSignal<T, TRuntime>(graph: DataGraph<TRuntime>, id: GraphNodeIdLike): Accessor<T> {
  const [value, setValue] = createSignal<T>(graph.get<T>(id));

  const stop = watch(
    () => graph.get<T>(id),
    (next: T) => {
      setValue(() => next);
    },
  );

  onCleanup(() => stop());
  return value;
}
