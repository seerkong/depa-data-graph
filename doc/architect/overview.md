# Architecture Overview

The project provides a unified, typed DataGraph for current values, event
streams, stateful projections, and effects. The architecture keeps data
protocols explicit: Signals answer “what is the current value?”, Streams answer
“what happened in order?”, and state nodes answer “which named transitions may
change this owned state?”.

## System map

```text
                    ┌──────────── Unified DataGraph ────────────┐
ordinary input ───► Signal ─► Computed ─► Processor ─► Consumer│
                       │             explicit adapters          │
external events ───► Source ─► Operator ─► Sink                 │
                       │                                        │
Signal input ──────────► SignalDrivenStateSignalNode ─► Signal │
Signal input ──────────► SignalDrivenStateStreamNode ─► Stream │
Stream input ──────────► StreamDrivenStateSignalNode ─► Signal │
Stream input ──────────► StreamDrivenStateStreamNode ─► Stream │
                    └───────────────────────────────────────────┘
```

Signal/Stream conversion is always explicit in both directions. A node builder
returns typed refs for passive graph values, or a handle when it also exposes an
operation/lifecycle API. In particular, all state-node builders return a
`StateNodeHandle`, and callers read or subscribe through `handle.output`.

## Governing boundaries

- `graph.set(ref, value)` changes only an ordinary writable Signal.
- State-node outputs are read-only; state changes through typed mutations or
  actions, both of which delegate to public typed `node.dispatch`.
- Reducers and mutations are pure and receive no runtime.
- Action factories receive `StateNodeActionRuntime`, a scoped capability linked
  to the owning `GraphRuntime`.
- Stream-output state nodes replay one current state to a new subscriber, not a
  history of transitions.
- `AppendOnlyEventLog` is an ordered, replayable Stream source. Stream-driven
  state nodes may synchronously reduce its existing history during bootstrap,
  but do not become logs themselves.
- Feedback requires an explicit feedback, delay, or scheduler boundary. A state
  node by itself does not implicitly legalize a mixed Signal/Stream cycle.

## Lifecycle

Definitions begin in `initial`, connect during the registration-time
`activation` step, establish current state during synchronous `bootstrap`, then
enter `live` before the builder returns its handle. They release resources
during `dispose`. Bootstrap ordering is part of the contract: a replayable event
log emits existing entries to its projection before live delivery, while a
Stream-output state node gives a later subscriber only its current state.

## Authoritative topics

- [Unified DataGraph](./data-graph.md): taxonomy, topology, refs, edges,
  snapshots, conversions, and feedback validation.
- [State Nodes](./state-nodes.md): handles, configuration, four node kinds, and
  complete usage examples.
- [State Operations](./state-operations.md): set/reducer/mutation/action/dispatch
  boundaries, creators, middleware, replay, results, and errors.
- [Stream Lifecycle](./stream-lifecycle.md): activation, bootstrap, current-only
  replay, live ordering, event-source/history ownership, and disposal.
- [Unified State Migration](./migration-unified-state.md): old-to-new API and
  demo migration guidance.

These documents are normative for the unified state-node work. Package-local
implementation notes may refine concrete generic spelling but must preserve the
observable contracts documented here.
