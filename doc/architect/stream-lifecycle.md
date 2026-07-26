# Stream and State-Node Lifecycle

The unified DataGraph has one ordered lifecycle for stream sources and all four
state-node kinds and their outputs:

```text
initial ──► activation ──► bootstrap ──► live ──► dispose
```

This order is observable and implementations must not collapse bootstrap into
an unspecified asynchronous phase.

Default activation policy remains explicit:

| Node role                 | Default |
| ------------------------- | ------- |
| Stream source/operator    | lazy    |
| Stream sink               | eager   |
| All four state-node kinds | eager   |

A state node's eager input subscription can start an otherwise lazy upstream
source/operator. Activation is internal to registration, not a caller-operated
graph API.

## Initial

Registration first creates the definition, output publisher, and configured
initial state. It does not return the state-node handle until eager activation
and synchronous bootstrap have completed.

- Signal-output state nodes can expose their initial current value.
- Stream-output state nodes retain an initial current value for subscription
  bootstrap.
- `graph.set` remains available only for ordinary writable Signals; it cannot
  initialize or replace a state node through its output ref.

## Activation

Activation is an internal registration step for state nodes: it resolves graph
dependencies, connects the declared input edge, installs middleware, and
subscribes the state node to its input. Dependency order matters: the reducer
and output publisher must be ready before a replayable source emits bootstrap
history.

The registration operation must be atomic with respect to duplicate activation:
one state-node handle owns one input subscription. Other graph node roles retain
their documented lazy/eager behavior.

## Bootstrap

Bootstrap establishes the current state before normal live delivery.

### Signal-driven state bootstrap

`SignalDrivenStateSignalNode` and `SignalDrivenStateStreamNode` synchronously
read the input Signal's current value once and apply their reducer before the
builder returns. Later Signal publications enter the live phase. The bootstrap
value is a current fact, not a historical event sequence.

### AppendOnlyEventLog history bootstrap

`AppendOnlyEventLog` is an ordered, replayable Stream source. When a
Stream-driven state node subscribes during registration, the log synchronously
emits its existing history in source order. The node reduces every entry before
bootstrap completes:

```text
stored e1, e2, e3
       │
       ▼ synchronous source bootstrap
reduce(initial, e1) ─► reduce(s1, e2) ─► reduce(s2, e3) ─► current s3
```

The event log owns append and replayable history. The state node owns projection
state. Reducing history does not make the state-node output a log, and the
projection must not append a second copy of each transition.

### Stream state current-only replay

A Stream-output state node gives every new subscriber exactly one current-state
bootstrap value, followed by live commits:

```text
subscribe at t4 ─► current state s4 ─► s5 ─► s6 ...
```

It does not automatically replay `s1`, `s2`, or `s3`. Consumers that need the
full transition history must subscribe to a history-bearing source such as
`AppendOnlyEventLog`, or use an explicit replay adapter.

Bootstrap emissions must precede live emissions for the same subscription.
Events arriving during activation must be serialized behind the source's
synchronous bootstrap so projection order remains deterministic.

## Live

After bootstrap, inputs and operations produce live state transitions.

- A successful input reducer or mutation handler commits one next state.
- An action may perform effects and dispatch multiple mutations; those commits
  remain individually visible and ordered.
- A stream-driven node reduces each input item once in input order.
- A Signal output publishes a successful bootstrap or live input/mutation
  transition only when `Object.is(previousState, nextState)` is false.
- A Stream output emits every successful bootstrap or live input/mutation
  transition to active subscribers, including when
  `Object.is(previousState, nextState)` is true.

No implicit transaction groups the mutations dispatched by an action. If an
action dispatches two mutations and then fails, the first two commits remain.
The base lifecycle also makes no promise of concurrent action execution,
automatic cancellation, or rollback. Such behavior requires an explicit
scheduler or transaction protocol.

## Mutation state versus event-log history

State mutation and event-source history are separate responsibilities:

| Concern                      | State node | `AppendOnlyEventLog`     |
| ---------------------------- | ---------- | ------------------------ |
| Calculate current projection | Yes        | No                       |
| Emit current/live state      | Yes        | No                       |
| Append ordered domain events | No         | Yes                      |
| Replay its existing history  | No         | Yes, as source bootstrap |

Applications must choose the fact source. If domain events are authoritative,
append them to the log and project them with a Stream-driven state node. A
mutation applied only to the projection is not appended to the log; recreating
the node from the same log therefore does not restore that mutation. A
correction that must replay in a fresh node must be modeled as an event. Never
infer event history from a Stream-output node's current-state replay.

## Dispose

Disposal runs in reverse dependency order where ownership requires it:

1. Reject new state-node operations and action starts.
2. Cancel or release resources only when the action/runtime contract explicitly
   provides such a mechanism; cancellation is not implied by the base API.
3. Unsubscribe stream-driven nodes from their inputs.
4. Detach output subscribers and middleware hooks.
5. Dispose owned sources; leave externally owned sources intact.

`dispose()` is idempotent. A disposed node must not emit additional state or
accept dispatch. Late asynchronous action completion must not commit through a
disposed node.

## Failure ordering

A bootstrap reduction failure aborts activation for that projection and must not
silently skip the bad item. A live reducer or mutation failure produces no
commit and no output emission. An action failure propagates to its caller; any
mutations committed before that failure remain observable because actions are
not transactions.

See [State Nodes](./state-nodes.md) for node selection and
[State Operations](./state-operations.md) for dispatch and middleware.
