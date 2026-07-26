# Typed graph

Typed authoring starts with output semantics, not string IDs. `SignalNodeRef<T>` may be read synchronously with `graph.get(ref)`; `StreamNodeRef<T>` may be observed with `graph.stream(ref)`. Both can be placed in module ports, edges, snapshots, JSON bindings, and code generation.

```ts
const graph = createTypedGraph(
  {
    criteria: signal<SearchCriteria>(emptyCriteria),
    events: stream<CounterEvent>(),
    search: signalDrivenStateSignal({
      input: 'criteria',
      initial: emptySearch,
      reducer: reduceSearch,
      mutations: searchMutations,
    }),
    current: streamDrivenStateSignal({
      input: 'events',
      initial: 0,
      reducer: (state, event) => state + event.value,
      mutations: { reset: () => 0 },
    }),
  } as const,
  () => appRuntime,
);

const state = graph.get(graph.nodes.current.output);
graph.nodes.current.mutations.reset();
graph.nodes.current.dispatch(graph.nodes.current.operations.mutations.reset());
```

Each state-node declaration returns a `StateNodeHandle`: its `.output` is the
typed Signal/Stream ref, while `.mutations`, `.actions`, namespaced
`.operations`, and `.dispatch` are the public operation contract. Schema-first
definitions derive all of those types and every payload type. A generated action
factory receives `StateNodeActionRuntime` as `rt`, uses `rt.graph` and
`rt.bizRuntime`, and writes only via `rt.mutations` or typed `rt.dispatch`.
Reducers and mutations are pure and receive no runtime; no generated API gets a
generic state setter.
