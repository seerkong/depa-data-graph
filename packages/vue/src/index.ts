import { onScopeDispose, shallowRef } from 'vue';
import type { Ref } from 'vue';

import type { DataGraph, SignalNodeIdLike } from 'depa-data-graph-core';
import { watch } from 'depa-data-graph-core';

export function useGraphSignal<T, TRuntime>(
  graph: DataGraph<TRuntime>,
  id: SignalNodeIdLike,
): Ref<T> {
  const state = shallowRef<T>(graph.get<T>(id)) as Ref<T>;

  const stop = watch(
    () => graph.get<T>(id),
    (value: T) => {
      state.value = value;
    },
  );

  onScopeDispose(() => stop());
  return state;
}

export function useGraph<TRuntime, const TIds extends readonly string[]>(
  graph: DataGraph<TRuntime>,
  ids: TIds,
): Record<TIds[number], Ref<unknown>> {
  const out = {} as Record<TIds[number], Ref<unknown>>;
  const list = ids as readonly TIds[number][];

  for (const id of list) {
    out[id] = shallowRef(graph.get<unknown>(id)) as Ref<unknown>;
  }

  const stop = watch(
    () => {
      const next = {} as Record<TIds[number], unknown>;
      for (const id of list) {
        next[id] = graph.get<unknown>(id);
      }
      return next;
    },
    (next: Record<TIds[number], unknown>) => {
      for (const id of list) {
        out[id].value = next[id];
      }
    },
  );

  onScopeDispose(() => stop());
  return out;
}
