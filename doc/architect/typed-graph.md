# Typed Graph

This project provides two complementary ways to get TypeScript safety for node IDs and value types.

## 1) Wrap an existing graph (Model schema)

Use this when you already have a `DataGraph` (for example, built from JSON DSL) and you want typed `get`/`set`/`peek`.

```ts
import { DataGraph, asTypedGraph, defineModel, types } from 'depa-data-graph-core';

const MODEL = defineModel({
  counter: types.number(),
  name: types.string(),
} as const);

const graph = asTypedGraph(new DataGraph(() => ({})), MODEL);

graph.addSignal('counter', 0);
graph.addSignal('name', 'world');

graph.set('counter', 1); // ok
// graph.set('counter', 'x'); // TS error

const c = graph.get('counter'); // number
```

Notes:

- This is a _typing helper_; it does not validate that nodes exist at runtime.
- It is a good fit for JSON DSL + runtime-generated graphs.

## 2) Define a typed graph upfront (Schema-first)

Use this when you want the schema itself to be the source of truth and you want a graph created from that schema.

```ts
import { computed, createTypedGraph, signal } from 'depa-data-graph-core';

const graph = createTypedGraph(
  {
    counter: signal(0),
    doubled: computed(['counter'], (ctx) => ctx.get<number>('counter') * 2),
  } as const,
  () => ({}),
);

graph.set('counter', 2);
graph.get('doubled'); // number
// graph.set('doubled', 1); // TS error (computed is read-only)
```

Notes:

- Signals are created before computeds to ensure dependencies exist.
- This approach is ideal for fully statically-defined graphs.
