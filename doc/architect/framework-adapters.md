# Framework adapters

Adapters are thin integrations over the unified `DataGraph`; they do not add a reactive runtime or mutate graph state directly.

| Output semantic | Adapter responsibility                                             | View operation                       |
| --------------- | ------------------------------------------------------------------ | ------------------------------------ |
| Signal          | subscribe/read the current value represented by `SignalNodeRef<T>` | `graph.get(ref)` or a Signal hook    |
| Stream          | subscribe with host-lifecycle cleanup to `StreamNodeRef<T>`        | `graph.stream(ref)` or a Stream hook |

```tsx
function SearchView({ graph, refs, search }: Props) {
  const state = useGraphSignal(graph, refs.searchState);
  return <button onClick={() => search.actions.refresh()}>Refresh</button>;
}
```

The current framework packages expose Signal adapters. A component that owns a
Stream-output subscription uses `graph.stream(ref).subscribe(...)` in the
framework's lifecycle/effect primitive and unsubscribes during cleanup; there
is no implicit `useGraphStream` API.

Framework code receives a state node's `StateNodeHandle`: it reads its
`.output`, invokes typed `.mutations` for synchronous user changes and
`.actions` for workflows, and may use public typed
`.dispatch(handle.operations.*.name(...))` for integrations. It never receives
a public generic setter. Stream subscriptions dispose with the host
component/scope; Signal adapters read the current graph state and update only
when Signal semantics publish a change. Stream adapters must handle the node’s
immediate current-state replay.

React, Vue, Solid, and vanilla adapters all follow this distinction. Their generated/typed APIs accept refs rather than hand-authored IDs whenever possible.
