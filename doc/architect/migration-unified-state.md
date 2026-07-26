# Migrating to Unified State Nodes

This guide maps legacy state, bridge, runtime, and demo APIs to the unified
DataGraph contracts. It is a migration specification: remove the old mechanisms
only after the corresponding explicit node, operation, or adapter exists.

## API-to-mechanism matrix

| Legacy API or pattern                                          | Unified mechanism                                                                                        | Why / trade-off                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `StreamGraph`                                                  | Stream Source/Operator/Sink and Stream-output refs registered in the same `DataGraph`                    | One identity, edge, lifecycle, validation, and snapshot model                                                    |
| `GraphBridge`                                                  | Explicit typed Signal↔Stream node/adapter and ordinary graph edges                                       | Removes hidden second identities and implicit cleanup ownership                                                  |
| `StreamBridgeManager`                                          | Graph-owned registration/lifecycle plus explicit adapters                                                | Gives cleanup one graph owner instead of a bridge manager                                                        |
| `subscribeStreamToSignal`                                      | `StreamDrivenStateSignalNode` or an explicit Stream→Signal latest/reducer adapter                        | Initial state and reduction policy become visible                                                                |
| `signalToStream`                                               | `SignalDrivenStateStreamNode` or an explicit Signal→Stream current/change adapter                        | Current bootstrap and equality semantics become visible                                                          |
| `ReducerProjection`                                            | `StreamDrivenStateSignalNode` or `StreamDrivenStateStreamNode`                                           | Projection becomes a first-class state node with typed operations and output semantics                           |
| `createReducerProjection`                                      | A state-node builder with `input`, `initial`, and a pure `reducer`                                       | Makes identity, lifecycle, operations, and output semantic part of the graph                                     |
| `StreamGraphSnapshot`                                          | Unified `GraphSnapshot`                                                                                  | Signal and Stream topology are inspected together                                                                |
| Registration returns a bare state ref                          | `add*State*Node(...)` returns `StateNodeHandle`; use `handle.output` as the ref                          | Keeps operation/lifecycle capabilities without making the output writable; one extra property access is explicit |
| `graph.get(stateNode)`                                         | `graph.get(node.output)` for Signal-output state nodes                                                   | `get` stays protocol-specific                                                                                    |
| `graph.stream(stateNode)`                                      | `graph.stream(node.output)` for Stream-output state nodes                                                | Prevents a handle from masquerading as a Stream ref                                                              |
| `graph.set(stateNode, next)` or `graph.set(node.output, next)` | `node.mutations.name(payload)` or typed `node.dispatch(node.operations.mutations.name(payload))`         | Named transitions are traceable/replayable; callers can no longer replace owned state arbitrarily                |
| Reducer receives `ctx`/`rt`                                    | Pure `(state, input) => nextState` reducer                                                               | Determinism and testability; effects move to actions                                                             |
| Mutation receives `ctx`/`rt`                                   | Pure `(state, ...payload) => nextState` mutation                                                         | Same single commit boundary; less ambient power                                                                  |
| Per-action `(rt) => handler` entries                           | One `actions: (rt) => ({ async name(...) { ... } })` factory                                             | Creates a coherent scoped facade and avoids handle-before-initialization closures                                |
| Private/untyped dispatch                                       | Public `node.dispatch` accepting only the closed union from `node.operations.mutations.*` / `.actions.*` | Enables middleware/tooling while preserving type safety                                                          |
| Flat operation creators                                        | Namespaced `node.operations.mutations.*` and `.actions.*`                                                | Allows identical domain verbs without collisions                                                                 |
| Hidden Signal-to-Stream bridge                                 | Explicit current/change adapter or `SignalDrivenStateStreamNode`                                         | Bootstrap and replay semantics become visible                                                                    |
| Hidden Stream-to-Signal bridge                                 | Explicit reducer/latest adapter or `StreamDrivenStateSignalNode`                                         | Requires an initial state and reduction policy                                                                   |
| State output used as history                                   | Subscribe to the original history-bearing Stream/`AppendOnlyEventLog`                                    | Stream state output replays current state only                                                                   |
| Implicit retained state                                        | Explicit snapshot adapter, or an ordered replayable input source plus projection                         | Separates current-state snapshots from event history                                                             |
| `makeCtx(...)` runtime factory                                 | `makeRuntime(...)`                                                                                       | `rt` consistently means runtime                                                                                  |
| Runtime variable/parameter `ctx`                               | `rt`                                                                                                     | Separates runtime from request/middleware context                                                                |
| `MiddlewareContext ctx`                                        | Keep unchanged                                                                                           | This `ctx` is an invocation context, not a graph runtime                                                         |

## Selecting the replacement node

| Legacy behavior                               | Replacement                   |
| --------------------------------------------- | ----------------------------- |
| Signal input, synchronous state reads         | `SignalDrivenStateSignalNode` |
| Signal input, current/live state subscription | `SignalDrivenStateStreamNode` |
| Stream input, synchronous state reads         | `StreamDrivenStateSignalNode` |
| Stream input, current/live state subscription | `StreamDrivenStateStreamNode` |

Mutations/actions do not create a fifth “operation-driven” family. All four
nodes retain their explicit input; operations provide additional domain intents.

## `AppendOnlyEventLog`: before and after

Before, reducer projection was a special-purpose helper over a replayable log:

```ts
const log = new AppendOnlyEventLog<CartEvent>();
log.append({ type: 'item-added', sku: 'book-1', quantity: 2 });

const cart = createReducerProjection(log, {
  initial: emptyCart,
  reducer: (state, entry) => reduceCart(state, entry.value),
});

cart.getState();
```

After, the replayable source remains separate and the projection uses the
general state-node mechanism:

```ts
const log = new AppendOnlyEventLog<CartEvent>();
log.append({ type: 'item-added', sku: 'book-1', quantity: 2 });
const cartEvents = graph.addSource('cart-events', log.stream());

const cart = graph.addStreamDrivenStateSignalNode({
  input: cartEvents.ref,
  initial: emptyCart,
  reducer: (state, entry) => reduceCart(state, entry.value),
  mutations: {},
  actions: (rt) => ({
    async addItem(input: AddItemInput) {
      await rt.bizRuntime.cartEvents.append({
        type: 'item-added',
        ...input,
      });
    },
  }),
});

// Registration eagerly connects the projection and synchronously reduces the
// log's existing entries before returning the handle.
const currentCart = graph.get(cart.output);
```

`AppendOnlyEventLog` remains an ordered, replayable source. The projection does
not append its emitted states or re-append replayed entries. For a Stream output,
use `addStreamDrivenStateStreamNode`; new subscribers receive one current
projection state, not log history. A mutation is a live state override, not a
log entry: later entries reduce from it, but a fresh node replay reconstructs
only what `log.stream()` supplies through its graph source. Model a correction as an input event when
it must be replayed by a new projection.

## Runtime migration: `ctx` to `rt`

Apply the rename across graph builders, actions, processors, examples, and
runtime test fixtures:

```ts
// Before
const ctx = makeCtx(deps);
const node = defineState({
  reducer: (state, input, ctx) => ctx.normalize(state, input),
  actions: {
    submit: (ctx) => async (payload) => ctx.api.submit(payload),
  },
});

// After
const rt = makeRuntime(deps);
const node = graph.addSignalDrivenStateSignalNode({
  input,
  initial,
  reducer: (state, value) => normalize(state, value),
  mutations: {
    submitted: (state, result) => ({ ...state, result }),
  },
  actions: (rt) => ({
    async submit(payload) {
      const result = await rt.bizRuntime.api.submit(payload);
      rt.mutations.submitted(result);
    },
  }),
});
```

The migration is semantic, not only lexical: reducers and mutations lose
runtime access; action factories gain the scoped `StateNodeActionRuntime` with
`bizRuntime`, `graph: GraphEffect`, `getState`, typed `mutations`, and typed
`dispatch`. Do not rename `MiddlewareContext ctx`.

## Bridge behavior migration

Bridge cleanup must preserve behavior explicitly:

| Bridge responsibility                     | Destination                                               |
| ----------------------------------------- | --------------------------------------------------------- |
| Subscribe/unsubscribe cleanup             | Node/adapter activation and idempotent `dispose()`        |
| Emit current Signal value on subscription | Explicit Signal-to-Stream current bootstrap               |
| Reduce Stream into current Signal         | `StreamDrivenStateSignalNode` or explicit reducer adapter |
| Debounce                                  | Stream operator with declared scheduler/timing            |
| Throttle                                  | Stream operator with declared leading/trailing policy     |
| Error mapping/recovery                    | Explicit stream error operator or action error handling   |
| Ordered append/replay                     | `AppendOnlyEventLog`, never a state-output Stream         |

Do not fold debounce, throttle, or error recovery into the state reducer. They
change event timing/control flow and therefore belong to an explicit Stream
operator. Cleanup ownership must state whether the adapter owns its input; by
default disposing a projection only unsubscribes from an independently owned
source.

## Demo intent mapping

The migrated demo retains UI intent names while routing each through a node
mutation or action:

| Demo intent       | Node operation                    | Reason                                                            |
| ----------------- | --------------------------------- | ----------------------------------------------------------------- |
| `increase(by)`    | `quantity.mutations.increase(by)` | Pure synchronous transition                                       |
| `setInput(value)` | `graph.set(inputSignal, value)`   | The target is an ordinary writable input Signal, not state output |
| `submit(payload)` | `form.actions.submit(payload)`    | Coordinates async business effect and multiple mutations          |
| `reset()`         | `node.mutations.reset()`          | Pure named reset transition                                       |

The demo must visibly cover all four node kinds:

1. `SignalDrivenStateSignalNode`: selected product Signal drives quantity state;
   `increase` and `reset` mutate it, and the UI reads `graph.get(output)`.
2. `SignalDrivenStateStreamNode`: form input Signal drives validation/submission
   status; the UI subscribes to current/live state and invokes `submit`.
3. `StreamDrivenStateSignalNode`: an `AppendOnlyEventLog` cart event Stream is
   synchronously reduced in source order into a queryable cart projection.
4. `StreamDrivenStateStreamNode`: connectivity events drive a subscribable
   current status; a later subscriber sees only current state plus live commits.

## Removal order

1. Introduce the four builders, handle/output refs, operations, and lifecycle.
2. Port reducers and mutations to pure signatures; move effects into actions.
3. Replace hidden bridges with explicit conversions/operators.
4. Split replayable event logs from projections and validate synchronous bootstrap.
5. Port demos/tests to `handle.output`, facades, and typed dispatch.
6. Rename graph/business runtime `ctx`/`makeCtx` to `rt`/`makeRuntime`, preserving
   `MiddlewareContext ctx`.
7. Remove legacy APIs only after type tests and runtime behavior tests prove the
   new path.

See [State Nodes](./state-nodes.md), [State Operations](./state-operations.md),
and [Stream Lifecycle](./stream-lifecycle.md) for normative contracts.
