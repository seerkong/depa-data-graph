# Module identity

Modules compose typed graph ports. `SignalNodeRef<T>` denotes a current-value port and `StreamNodeRef<T>` denotes an event-sequence port; their canonical string ID is a runtime/debug/serialization projection, not the primary business authoring interface.

```ts
const SearchModule = defineGraphModule('search', {
  inputs: { criteria: signalInput<SearchCriteria>() },
  outputs: { state: signalOutput<SearchState>(), transitions: streamOutput<SearchState>() },
  internals: { events: streamInternal<SearchEvent>() },
});

const mounted = mountGraph(SearchModule, { scope: 'screen/main' });
graph.get(mounted.outputs.state);
graph.stream(mounted.outputs.transitions);
```

Mounting scopes canonical IDs without changing ref semantics. Parent-child wiring
declares explicit edges between compatible Signal/Stream refs. A module exports
a state node as its `StateNodeHandle` contract: consumers read `handle.output`
and call its typed facades or public namespaced-operation dispatch, never a
setter. The unified snapshot retains scoped refs, edge direction, node kind, and
lifecycle state. Runtime callbacks use `StateNodeActionRuntime` as `rt`; module
actions access graph facilities as `rt.graph` and application services as
`rt.bizRuntime`. Reducers/mutations remain pure.
