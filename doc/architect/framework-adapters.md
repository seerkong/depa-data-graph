# Framework Adapters

This project ships small per-framework adapter packages that bridge `DataGraph` updates into each UI framework.

Packages:

- `depa-data-graph-react`
- `depa-data-graph-vue`
- `depa-data-graph-solid`
- `depa-data-graph-vanilla`

The adapters are intentionally thin:

- No new reactive system is introduced.
- Subscriptions are driven by `DataGraph.get()` reads.
- Cleanup follows the host framework conventions.

## React (`depa-data-graph-react`)

Exports:

- `useGraphSignal<T>(graph, id): T`
- `useGraph(graph, ids): Record<id, unknown>`
- `useGraphComputed<T>(graph, selector): T`

```tsx
import type { DataGraph } from 'depa-data-graph-core';
import { useGraphComputed, useGraphSignal } from 'depa-data-graph-react';

export function Counter(props: { graph: DataGraph<unknown> }) {
  const counter = useGraphSignal<number, unknown>(props.graph, 'counter');
  const doubled = useGraphComputed<number, unknown>(
    props.graph,
    () => props.graph.get<number>('counter') * 2,
  );

  return (
    <div>
      counter={counter} doubled={doubled}
    </div>
  );
}
```

Implementation notes:

- `useGraphSignal` creates an internal view-model signal and disposes it on unmount.
- `useGraphComputed` subscribes via `watch()` and evaluates the selector for the snapshot.

## Vue (`depa-data-graph-vue`)

Exports:

- `useGraphSignal<T>(graph, id): Ref<T>`
- `useGraph(graph, ids): Record<id, Ref<unknown>>`

```ts
import type { DataGraph } from 'depa-data-graph-core';
import { useGraphSignal } from 'depa-data-graph-vue';

export function useCounter(graph: DataGraph<unknown>) {
  const counter = useGraphSignal<number, unknown>(graph, 'counter');
  return { counter };
}
```

Cleanup is automatically bound to the current Vue scope via `onScopeDispose()`.

## Solid (`depa-data-graph-solid`)

Exports:

- `useGraphSignal<T>(graph, id): Accessor<T>`

```ts
import type { DataGraph } from 'depa-data-graph-core';
import { useGraphSignal } from 'depa-data-graph-solid';

export function useCounter(graph: DataGraph<unknown>) {
  const counter = useGraphSignal<number, unknown>(graph, 'counter');
  return { counter };
}
```

Cleanup is automatically bound to the current Solid owner via `onCleanup()`.

## Vanilla (`depa-data-graph-vanilla`)

Exports:

- `bindElement(graph, id, element, { property, format? }): StopHandle`
- `createReactiveStore(graph, ids): { subscribe(cb), getSnapshot() }`

```ts
import type { DataGraph } from 'depa-data-graph-core';
import { bindElement, createReactiveStore } from 'depa-data-graph-vanilla';

export function mountCounter(el: HTMLElement, graph: DataGraph<unknown>) {
  const stopBind = bindElement(graph, 'counter', el, { property: 'textContent' });

  const store = createReactiveStore(graph, ['counter'] as const);
  const stopStore = store.subscribe((v) => console.log('counter', v.counter));

  return () => {
    stopBind();
    stopStore();
  };
}
```

## Demo usage

The mixed-framework demo under `examples/demo/` uses these adapter packages in each view.

## Building your own adapter

If you need a custom integration (SSR, different scheduling, etc), you can build your own thin adapter using:

- `watch(getter, cb)` from `depa-data-graph-core`
- `DataGraph.createViewModelSignal(viewId, selector)` for dependency tracking/debuggability
