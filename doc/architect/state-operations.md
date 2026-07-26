# State Operations

This document is the authoritative contract for changing state in the unified
DataGraph. It distinguishes ordinary writable signals from state-node
operations and fixes the public execution boundary used by implementations,
middleware, replay, and developer tooling.

## Five ways values appear to change

| Mechanism         | Public entry point                                               | Target                             | May read runtime?                     | Purpose                                                         |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| Signal assignment | `graph.set(ref, value)`                                          | Ordinary writable `SignalRef` only | No                                    | Replace an externally owned signal value                        |
| Input reducer     | Declared in node config; invoked by its Signal/Stream input edge | One state node                     | No                                    | Purely reduce one input value into the next state               |
| Mutation facade   | `node.mutations.name(...payload)`                                | One state node                     | No                                    | Typed, intent-revealing synchronous state transition            |
| Action facade     | `node.actions.name(...payload)`                                  | One state node                     | Yes, through `StateNodeActionRuntime` | Coordinate effects and dispatch zero or more mutations          |
| Typed dispatch    | `node.dispatch(operation)`                                       | One state node                     | The dispatched action receives `rt`   | Public lower-level entry point for closed, generated operations |

`graph.set` is deliberately not a generic graph write primitive. It remains
available for ordinary writable Signals. A state-node ref and its output ref
must be rejected as `graph.set` targets. Its declared input edge invokes the
configured input reducer automatically; explicit state changes use the node's
operation protocol. Both paths meet at the same observable commit/emission
boundary, preserving validation, replay, debugging, and any explicit
persistence adapter or extension; neither is built into a state node or
`AppendOnlyEventLog`.

Input reducers and mutation handlers never receive a runtime. That restriction
keeps state transitions deterministic and replayable. An action factory receives a
`StateNodeActionRuntime`; it may perform effects and then call the same typed
dispatch path used by callers. The runtime boundary belongs to coordination,
not calculation.

## Input edge versus public operation pipeline

An input reducer is not a public operation and does not enter public typed
dispatch. The graph invokes it when the declared Signal or Stream input edge
delivers a bootstrap or live input value. A reducer computes
`(state, inputValue) => nextState`; a named mutation instead computes
`(state, ...payload) => nextState` from its typed operation payload.

Both successful reducer and mutation results use the one state-node commit and
output-emission boundary. Thus input transitions have the same output semantics
and failure rule as mutation transitions, while only mutations/actions, their
facades, and direct `node.dispatch` share the public operation/middleware
pipeline.

## Closed operation union and typed facades

Every state node exposes operation creators whose return types form a closed
discriminated union. Conceptually:

```ts
type CounterOperation =
  | { readonly type: 'mutation/increase'; readonly payload: { readonly by: number } }
  | { readonly type: 'mutation/reset'; readonly payload: undefined }
  | { readonly type: 'action/increaseLater'; readonly payload: { readonly by: number } };

interface CounterMutations {
  readonly increase: (payload: { readonly by: number }) => CounterOperation;
  readonly reset: () => CounterOperation;
}

interface CounterActions {
  readonly increaseLater: (payload: { readonly by: number }) => CounterOperation;
}

interface CounterOperations {
  readonly mutations: CounterMutations;
  readonly actions: CounterActions;
}
```

The concrete generic types may differ by node kind, but implementations must
preserve these properties:

- `node.operations.mutations` and `node.operations.actions` are the public typed
  creator namespaces.
- `node.mutations` and `node.actions` are public convenience facades that create
  an operation through those namespaces and enter the same dispatch pipeline.
- `node.dispatch` accepts only the generated closed union.
- Operation discriminants are stable and collision-free within the node.
- Payload types are inferred from the corresponding mutation or action
  declaration; input reducers receive their typed edge value instead.
- Unknown hand-written objects are compile-time errors and must also be rejected
  at an untyped runtime boundary.

`node.mutations.foo(payload)` is equivalent to dispatching
`node.operations.mutations.foo(payload)`; `node.actions.bar(payload)` is
equivalent to dispatching `node.operations.actions.bar(payload)`. These facades
do not create alternative execution engines.

## Execution pipeline

```text
Signal/Stream input edge ──► pure input reducer ──────────────┐
                                                           commit ──► output emit
node.mutations.foo / node.actions.bar / typed node.dispatch ──┤
      │
      ▼
operation middleware / instrumentation
      │
      ├── mutation ──► pure mutation handler ────────────────┘
      │
      └── action ─────► action factory(rt)
                              │
                              └──► dispatch zero or more mutation operations
```

Dispatch performs one operation at a time in declaration order. A mutation
computes and commits one next state. An action may dispatch multiple mutations;
each committed mutation is independently observable. The action itself does
not imply an atomic transaction around those mutations.

The base contract does not promise parallel action scheduling, cancellation,
rollback, or multi-mutation transactions. A future scheduler may add such
capabilities through an explicit extension without changing reducer semantics.

## Return and error boundary

Dispatch has a typed result contract that distinguishes successful mutation
commit, action result, and failure. The concrete `StateNodeDispatchResult<T>`
spelling is finalized by implementation type tests, but it must preserve the
declared result type through operation creators, `dispatch`, and both facades;
it cannot degrade to `unknown` or an untyped promise.

Creator validation errors, unknown operations, reducer failures, and action
failures propagate through dispatch; they must not be silently converted into
state. A failed mutation must not emit an output or append a transition. If an
action has already dispatched mutations before it fails, those commits remain:
actions are orchestration, not implicit transactions.

## Middleware and replay extension points

Operation middleware wraps `node.dispatch`, so direct dispatch and both facades
are observed consistently. Middleware can trace, validate, authorize, time, or
adapt errors around an operation. It must not give reducers access to runtime or
bypass the node commit path.

Replay feeds recorded mutation operations or recorded transition data back into
the deterministic reduction/restore boundary. Actions are not replayed because
they may repeat effects. `AppendOnlyEventLog` is a separate ordered, replayable
Stream source: a projection state node may reduce its entries, but its outputs
and transitions are not appended back into that source.

The distinction is intentional: middleware observes live commands, while an
explicit replay/snapshot adapter reconstructs state without re-running effects.
