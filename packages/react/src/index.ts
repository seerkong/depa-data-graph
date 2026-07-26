import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import type { DataGraph, SignalNodeIdLike } from 'depa-data-graph-core';
import { toNodeId, watch } from 'depa-data-graph-core';

let viewIdSeq = 0;

function nextViewId(prefix: string): string {
  viewIdSeq += 1;
  return `${prefix}${viewIdSeq}`;
}

function useAlienSignalValue<T>(sig: () => T): T {
  return useSyncExternalStore(
    (onStoreChange: () => void) => watch(sig, () => onStoreChange()),
    () => sig(),
    () => sig(),
  );
}

export function useGraphSignal<T, TRuntime>(graph: DataGraph<TRuntime>, id: SignalNodeIdLike): T {
  const nodeId = toNodeId(id);
  const viewId = useMemo(() => nextViewId(`react:signal:${nodeId}:`), [graph, nodeId]);

  const sig = useMemo(
    () => graph.createViewModelSignal(viewId, () => graph.get<T>(id)),
    [graph, viewId, id],
  );

  useEffect(() => {
    return () => {
      graph.disposeViewModel(viewId);
    };
  }, [graph, viewId]);

  return useAlienSignalValue(sig);
}

export function useGraph<TRuntime, const TIds extends readonly string[]>(
  graph: DataGraph<TRuntime>,
  ids: TIds,
): Record<TIds[number], unknown> {
  const key = ids.join('|');
  const viewId = useMemo(() => nextViewId(`react:multi:${key}:`), [graph, key]);

  const sig = useMemo(
    () =>
      graph.createViewModelSignal(viewId, () => {
        const out = {} as Record<TIds[number], unknown>;
        const list = ids as readonly TIds[number][];
        for (const id of list) {
          out[id] = graph.get<unknown>(id);
        }
        return out;
      }),
    // Depend on the key rather than the array identity.
    [graph, viewId, key],
  );

  useEffect(() => {
    return () => {
      graph.disposeViewModel(viewId);
    };
  }, [graph, viewId]);

  return useAlienSignalValue(sig);
}

export function useGraphComputed<T, TRuntime>(graph: DataGraph<TRuntime>, selector: () => T): T {
  // Keep the latest selector while keeping the subscription stable.
  // We subscribe via watch(), and compute the snapshot by calling the selector.
  // This means prop-driven selector changes are reflected on re-render.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  return useSyncExternalStore(
    (onStoreChange: () => void) =>
      watch(
        () => selectorRef.current(),
        () => onStoreChange(),
      ),
    () => selectorRef.current(),
    () => selectorRef.current(),
  );
}
