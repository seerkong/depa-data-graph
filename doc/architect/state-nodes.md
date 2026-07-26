# State Nodes

State nodes make stateful reduction a first-class part of the unified DataGraph.
Every state node has an input (`Signal` or `Stream`), owns current state, exposes
that state as a read-only output (`Signal` or `Stream`), and may additionally
accept named mutations and actions.

## Choosing one of the four node kinds

The names encode two independent axes: the driver protocol comes first and the
output protocol comes last.

| Input that drives reduction | Signal output                 | Stream output                 |
| --------------------------- | ----------------------------- | ----------------------------- |
| Signal                      | `SignalDrivenStateSignalNode` | `SignalDrivenStateStreamNode` |
| Stream                      | `StreamDrivenStateSignalNode` | `StreamDrivenStateStreamNode` |

“Driven” is intentional: it says which protocol supplies automatic reducer
input. “StateSignal” versus “StateStream” says how downstream code observes the
current state. Mutations and actions are an additional explicit operation
surface on all four kinds; they do not replace the input axis.

Choose a Signal output when callers require synchronous current-state reads via
`graph.get(node.output)`. Choose a Stream output when callers subscribe via
`graph.stream(node.output)` and should receive the current state followed by live
commits. Choose the driver that matches the existing upstream fact source; do
not hide a Signal/Stream conversion inside node configuration.

## Target TypeScript contract

The public shape below is normative. Implementation type tests may refine exact
generic ordering and the concrete `StateNodeDispatchResult`, while preserving
the capability and type relationships.

```ts
interface StateNodeOperationCreators<M, A> {
  readonly mutations: MutationOperationCreators<M>;
  readonly actions: ActionOperationCreators<A>;
}

interface StateNodeHandle<State, OutputRef, M, A, Operation> {
  /** Stable read-only graph ref. */
  readonly output: OutputRef;

  /** Closed, namespaced creators accepted by dispatch. */
  readonly operations: StateNodeOperationCreators<M, A>;

  /** Intent-oriented facade; creates mutation operations and dispatches them. */
  readonly mutations: MutationFacade<M>;

  /** Effectful facade; creates action operations and dispatches them. */
  readonly actions: ActionFacade<A>;

  /** Synchronous read of the node-owned current state. */
  getState(): State;

  /** Public lower-level API, closed to this node's generated union. */
  dispatch(operation: Operation): StateNodeDispatchResult;

  /** Idempotently detach input and reject later operations. */
  dispose(): void;
}

interface StateNodeActionRuntime<TBiz, State, M, Operation> {
  readonly bizRuntime: TBiz;
  readonly graph: GraphEffect;
  getState(): State;
  readonly mutations: MutationFacade<M>;
  dispatch(operation: Operation): StateNodeDispatchResult;
}
```

The `operations.mutations` and `operations.actions` namespaces allow a mutation
and action to share a domain verb without creator collisions. Both facades
delegate to the same public typed `dispatch`; an arbitrary hand-written object
outside the generated operation union is not accepted.

Every `add*State*Node` builder returns a `StateNodeHandle`, never a bare ref:

```ts
const totals = graph.addSignalDrivenStateSignalNode(/* config */);
graph.get(totals.output);

const status = graph.addStreamDrivenStateStreamNode(/* config */);
graph.stream(status.output).subscribe(renderStatus);
```

`node.output` is read-only. Neither the handle nor its output is a valid
`graph.set` target; `graph.set` remains exclusive to ordinary writable Signals.

## Configuration contract

All four builders declare:

- `input`: a typed Signal or Stream ref matching the builder's driver name;
- `initial`: an initial state value or factory;
- `reducer`: a pure `(state, inputValue) => nextState` function;
- `mutations`: optional named pure `(state, payload) => nextState` functions;
- `actions: (rt) => ({ ... })`: an optional action-factory object whose methods
  can coordinate effects and dispatch typed mutations;
- optional identity, middleware, and lifecycle metadata supported by the graph
  builder. Such metadata must not override the fixed public output semantics:
  Signal publication uses `Object.is`, while Stream publication emits every
  successful transition.

Reducers and mutations never receive a runtime. The one action factory receives
`StateNodeActionRuntime`, and closes over that runtime when creating its action
methods:

```ts
actions: (rt) => ({
  async submit(input: SubmitInput) {
    rt.mutations.started();
    const result = await rt.bizRuntime.submit(input);
    rt.mutations.succeeded(result);
  },
});
```

This shape avoids closing over a handle before the builder has returned it.
`StateNodeActionRuntime` is scoped to one state node. Its `graph: GraphEffect`
provides the permitted graph effects; `bizRuntime` carries application
capabilities; `getState`, typed `mutations`, and typed `dispatch` preserve the
owning node boundary.

Runtime callbacks use `rt`. The migration-only legacy factory rename details
are in [Unified State Migration](./migration-unified-state.md);
`MiddlewareContext ctx` remains the explicit exception because it names a
middleware invocation context, not a graph or business runtime.

## Signal-driven, Signal-output: derived editable quantity

Use `SignalDrivenStateSignalNode` when a current Signal automatically drives the
projection and callers also need synchronous reads. Here a selected SKU resets
the quantity while explicit user intents adjust it.

```ts
const selectedSku = graph.addSignal<string | null>('selected-sku', null);

const quantity = graph.addSignalDrivenStateSignalNode({
  input: selectedSku.ref,
  initial: { sku: null as string | null, value: 1 },
  reducer: (_state, sku) => ({ sku, value: 1 }),
  mutations: {
    increase: (state, by: number) => ({ ...state, value: state.value + by }),
    reset: (state) => ({ ...state, value: 1 }),
  },
  actions: (rt) => ({
    async increaseAfter(input: { by: number; ms: number }) {
      await rt.bizRuntime.delay(input.ms);
      rt.mutations.increase(input.by);
      return rt.getState();
    },
  }),
});

graph.set(selectedSku.ref, 'book-1');
quantity.mutations.increase(2);
await quantity.actions.increaseAfter({ by: 3, ms: 50 });
console.log(graph.get(quantity.output)); // { sku: "book-1", value: 6 }

quantity.dispatch(quantity.operations.mutations.reset());
```

The input Signal is writable; the state output is not.

## Signal-driven, Stream-output: form draft status

Use `SignalDrivenStateStreamNode` when each current input value drives state but
consumers should observe state through subscriptions.

```ts
const formInput = graph.addSignal('form-input', { email: '', message: '' });

const formStatus = graph.addSignalDrivenStateStreamNode({
  input: formInput.ref,
  initial: { phase: 'editing' as const, valid: false },
  reducer: (_state, form) => ({
    phase: 'editing' as const,
    valid: form.email.includes('@') && form.message.length > 0,
  }),
  mutations: {
    submitting: (state) => ({ ...state, phase: 'submitting' as const }),
    submitted: (state) => ({ ...state, phase: 'submitted' as const }),
    reset: () => ({ phase: 'editing' as const, valid: false }),
  },
  actions: (rt) => ({
    async submit() {
      const state = rt.getState();
      if (!state.valid) return;
      rt.mutations.submitting();
      await rt.bizRuntime.submitCurrentForm();
      rt.mutations.submitted();
    },
  }),
});

graph.stream(formStatus.output).subscribe(renderFormStatus);
graph.set(formInput.ref, { email: 'a@example.com', message: 'Hello' });
await formStatus.actions.submit();
formStatus.mutations.reset();
```

A later subscriber receives only the current form status and then live commits,
not every prior editing/submitting transition.

## Stream-driven, Signal-output: event-log projection

Use `StreamDrivenStateSignalNode` to build a synchronously queryable projection
from ordered events. `AppendOnlyEventLog` is a Stream source, not a state node.

```ts
type CartEvent =
  | { type: 'item-added'; sku: string; quantity: number }
  | { type: 'item-removed'; sku: string };

const log = new AppendOnlyEventLog<CartEvent>();
log.append({ type: 'item-added', sku: 'book-1', quantity: 2 });
const cartEvents = graph.addSource('cart-events', log.stream());

const cart = graph.addStreamDrivenStateSignalNode({
  input: cartEvents.ref,
  initial: new Map<string, number>(),
  reducer: (state, entry) => reduceCart(state, entry.value),
  mutations: {
    resetProjection: () => new Map<string, number>(),
  },
  actions: (rt) => ({
    async reloadCatalog() {
      await rt.bizRuntime.catalog.refresh();
    },
  }),
});

// Registration eagerly subscribes and synchronously reduces existing entries
// before returning the handle; later appends continue the same reducer.
console.log(graph.get(cart.output));
```

The log owns ordered append and replayable history. The state node only projects
that history and live input; it does not append transitions or make its output
a log.

## Stream-driven, Stream-output: connectivity state

Use `StreamDrivenStateStreamNode` when an event Stream drives a current-state
Stream for reactive consumers.

```ts
type ConnectivityEvent = { type: 'online'; at: number } | { type: 'offline'; at: number };

const connectivitySource = graph.addSource('connectivity-events', connectivityEvents);

const connectivity = graph.addStreamDrivenStateStreamNode({
  input: connectivitySource.ref,
  initial: { online: false, changedAt: null as number | null, retries: 0 },
  reducer: (state, event: ConnectivityEvent) => ({
    ...state,
    online: event.type === 'online',
    changedAt: event.at,
  }),
  mutations: {
    retrying: (state) => ({ ...state, retries: state.retries + 1 }),
    reset: (state) => ({ ...state, retries: 0 }),
  },
  actions: (rt) => ({
    async reconnect() {
      rt.mutations.retrying();
      await rt.bizRuntime.network.reconnect();
    },
  }),
});

const first = graph.stream(connectivity.output).subscribe(renderConnectivity);
await connectivity.actions.reconnect();
first.unsubscribe();

const later = graph.stream(connectivity.output).subscribe(renderConnectivity);
// `later` gets one current state, followed by new commits only.
```

Consumers that require the original connectivity history subscribe to
`connectivityEvents`, not the state output.

## Dispatch, emission, and disposal

An input reducer is automatically invoked by its declared Signal/Stream edge;
it is not a public typed-dispatch operation. Input reduction, mutation facades,
action facades, and direct typed dispatch nevertheless converge on the node's
single commit/emission boundary. Each successful input-reducer transition or
mutation transition commits one state, including bootstrap and live input.
An action can dispatch zero or many mutations; each successful mutation remains
separately observable. Action concurrency, automatic cancellation, and
multi-mutation transactions are not base-contract features.

Signal output retains a synchronously readable current state and publishes a
successful input-reducer or mutation commit only when
`Object.is(previousState, nextState)` is false. Stream output emits every
successful input-reducer or mutation commit, including when
`Object.is(previousState, nextState)` is true. This is a fixed public semantic,
not an overridable equality option.

Stream output retains only the current state needed to bootstrap a new
subscriber, then emits live commits. That one current-state replay is not a
replay of historical transitions, whether those transitions occurred during
bootstrap or live delivery. It is not a durable transition log.

`dispose()` is idempotent: it detaches the driver input, rejects later
operations, releases owned middleware/action resources, and stops later output
emission. It does not dispose an independently owned input source unless the
configuration explicitly transfers ownership.

See [State Operations](./state-operations.md) for the closed operation union and
[Stream Lifecycle](./stream-lifecycle.md) for activation/bootstrap ordering.
