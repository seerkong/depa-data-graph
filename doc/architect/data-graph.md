# Unified DataGraph

DataGraph is one typed dependency graph containing signal computation, stream
processing, effects, and stateful projections. “Unified” means these node kinds
share refs, dependency validation, lifecycle, snapshots, and runtime ownership;
it does not erase the semantic difference between current values and events.

## Complete topology

```text
Signal world                                      Stream world
────────────                                      ────────────
Writable Signal ──► Computed ──► Processor        Source ──► Operator ──► Sink
      │                │             │                │          │          │
      └────────────────┴─────────────┴──── explicit conversions ─┴──────────┘
                                           │                  │
                         SignalDrivenStateSignalNode ◄── Signal
                         SignalDrivenStateStreamNode ◄── Signal
                         StreamDrivenStateSignalNode ◄── Stream
                         StreamDrivenStateStreamNode ◄── Stream
                                           │
                            output is Signal or Stream as named

Consumer nodes observe values/effects at the graph boundary.
```

The canonical taxonomy is:

- `Signal`: a current value; writable Signals are set through `graph.set`.
- `Computed`: a pure derived current value.
- `Processor`: explicit processing/effect logic over graph inputs.
- `Consumer`: a terminal observer or external side-effect boundary.
- Stream `Source`: produces ordered events, including `AppendOnlyEventLog`.
- Stream `Operator`: transforms, filters, combines, or schedules streams.
- Stream `Sink`: consumes stream events at an external boundary.
- `SignalDrivenStateSignalNode`: a Signal drives state; output is a Signal.
- `SignalDrivenStateStreamNode`: a Signal drives state; output is a Stream.
- `StreamDrivenStateSignalNode`: a Stream drives state; output is a Signal.
- `StreamDrivenStateStreamNode`: a Stream drives state; output is a Stream.

## Explicit Signal/Stream conversions

Signal and Stream edges are not interchangeable. Both directions require an
explicit node or adapter because they answer different questions:

```text
Signal ── current/change adapter ──► Stream
Stream ── reducer/latest adapter ──► Signal
```

Signal-to-Stream conversion defines whether subscription emits the current
value and how later equality-filtered changes appear. Stream-to-Signal
conversion must define an initial value and a reduction/latest-value policy.
The four state-node builders are specialized, named forms of these stateful
boundaries, not invisible coercions.

## Typed refs

A ref identifies one registered graph output and carries its protocol and value
type. The target shape is conceptually:

```ts
type SignalNodeRef<T, Writable extends boolean = false> = {
  readonly id: NodeId;
  readonly protocol: 'signal';
  readonly value: T;
  readonly writable: Writable;
};

type StreamNodeRef<T> = {
  readonly id: NodeId;
  readonly protocol: 'stream';
  readonly value: T;
};
```

The phantom `value` fields above illustrate type relationships; runtime objects
need not contain actual values. State-node output refs are always read-only.
`graph.get` accepts a Signal ref, `graph.stream` accepts a Stream ref, and
`graph.set` accepts only an ordinary writable Signal ref.

Builders return handles when callers need behavior beyond reading an output.
Accordingly, every `add*State*Node` returns `StateNodeHandle`, with the graph ref
available as `handle.output`.

## Typed edges

An edge connects a producer output port to a compatible consumer input port:

```ts
type GraphEdge<From extends GraphNodeRef, To extends InputPort> = {
  readonly from: From;
  readonly to: To;
  readonly mode: EdgeModeFor<From, To>;
};
```

Validation must reject protocol mismatches, value-type mismatches visible to
the type system, missing nodes/ports, illegal ownership crossings, and mixed
cycles that lack an explicit `feedback`, `delay`, or `scheduler` boundary.
State-node presence alone does not legalize a mixed cycle. Conversion nodes make
a protocol change visible in the topology and snapshot.

## Snapshot target shape

Snapshots describe definitions, topology, and inspectable lifecycle state, but
not hidden closures or runtime objects. The target is structurally equivalent
to:

```ts
interface DataGraphSnapshot {
  readonly version: 1;
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: GraphNodeKind;
    readonly outputSemantic: 'signal' | 'stream';
    readonly inputs: readonly PortSnapshot[];
    readonly outputs: readonly PortSnapshot[];
    readonly lifecycle: 'inactive' | 'active' | 'disposed';
    readonly state?: unknown;
    readonly stream?: {
      readonly started: boolean;
      readonly subscriberCount: number;
    };
  }[];
  readonly edges: readonly {
    readonly from: PortAddress;
    readonly to: PortAddress;
    readonly mode: 'signal' | 'stream' | 'explicit-conversion';
    readonly boundary?: 'feedback' | 'delay' | 'scheduler';
  }[];
}
```

State-node snapshots identify node kind, output protocol, operation names,
input refs, eligible current state, and Stream start/subscriber information.
They must not serialize action closures, runtime objects, subscriber callbacks,
middleware contexts, or claim that a Stream-output node contains transition
history.

## Feedback boundary

Combinational Signal/Computed dependencies must remain acyclic. Stream/operator
loops must likewise be rejected when they can synchronously feed an emission
back into itself. Feedback is legal only when an explicit feedback, delay, or
scheduler boundary defines turn ordering, queuing, cancellation, and disposal.
A state node owns state, but does not automatically count as that explicit
mixed-protocol boundary.

Legal feedback:

```text
commands Stream ──► StreamDrivenStateSignalNode(initial = 0) ──► state Signal
       ▲                                                            │
       └── explicit scheduler/delay boundary ◄── Signal→Stream adapter
```

The state node provides an initial value, while the explicit scheduler/delay
boundary creates the next delivery turn. The conversion and boundary are both
visible, so validation and snapshots can explain why the loop is legal.

Illegal feedback:

```text
Computed A ──► Computed B ──► Computed A
```

Neither node owns state or defines an initial value, so evaluation has no valid
starting point.

Also illegal:

```text
Stream operator A ──► operator B ──► operator A
```

Without a declared delay/state boundary, one input can recurse indefinitely in
the same delivery turn. Hiding either loop inside a bridge, module, or subgraph
does not make it legal; validation follows typed exported ports and edges.

## Runtime and ownership

The DataGraph runtime owns registration-time activation, reads, ordinary Signal
writes, Stream access, snapshots, and disposal. A `StateNodeActionRuntime` is a
node-scoped capability view containing `bizRuntime`, `graph: GraphEffect`,
`getState`, typed mutations, and typed dispatch. Reducers do not receive either
runtime view.

Modules, subgraphs, and adapters can package nodes but must preserve ref
protocols and ownership. They cannot turn a state-node output into a writable
Signal or hide an implicit Signal/Stream conversion.

See [State Nodes](./state-nodes.md), [State Operations](./state-operations.md),
and [Stream Lifecycle](./stream-lifecycle.md) for the operational contracts.
