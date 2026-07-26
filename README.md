# depa-data-graph

A framework-agnostic reactive state library that models Signal values and Stream events in one explicit `DataGraph`.

English | [中文](./README-CN.md)

## Packages

| Package                                             | Description                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [depa-data-graph-core](./packages/core)             | Unified DataGraph runtime, state nodes, builders, typed refs, middleware, and streams |
| [depa-data-graph-codegen](./packages/graph-codegen) | JSON graph validation and TypeScript identity/facade generation                       |
| [depa-data-graph-react](./packages/react)           | React hooks                                                                           |
| [depa-data-graph-vue](./packages/vue)               | Vue composables                                                                       |
| [depa-data-graph-solid](./packages/solid)           | Solid accessors                                                                       |
| [depa-data-graph-vanilla](./packages/vanilla)       | DOM bindings and reactive stores                                                      |

The [demo](./examples/demo) runs Vanilla, Vue, React, and Solid against the same graph and state-node operations.

## Design

- One `DataGraph` owns Signal nodes, Stream nodes, edges, validation, snapshots, and lifecycle.
- Typed `SignalNodeRef<T>` and `StreamNodeRef<T>` make output semantics explicit.
- Signal sources/computeds and Stream sources/operators/sinks can be connected in all four directions.
- Four state-node kinds combine Signal or Stream input with Signal or Stream state output.
- State nodes expose `getState()`, typed `mutations`, typed `actions`, typed `dispatch`, and `dispose()`. They do not expose `set`.
- Runtime callbacks use `rt`: `rt.graph` is the graph-effect capability and `rt.bizRuntime` contains application services.
- Signal state outputs suppress `Object.is`-equal publications. Stream state outputs emit every successful transition and replay only the current state to a new subscriber.
- Stream sources/operators are lazy; sinks and state nodes are eager. Mixed feedback requires an explicit feedback/delay/scheduler boundary.

## Install

```bash
pnpm add depa-data-graph-core alien-signals xstream
```

Framework adapters are separate packages:

```bash
pnpm add depa-data-graph-react react
pnpm add depa-data-graph-vue vue
pnpm add depa-data-graph-solid solid-js
pnpm add depa-data-graph-vanilla
```

## Unified Graph

```ts
import { DataGraph } from 'depa-data-graph-core';

const bizRuntime = { logger: console };
const graph = new DataGraph(() => bizRuntime);

const count = graph.addSignal('count', 1);
const doubled = graph.addComputed('doubled', [count.ref], (rt) => rt.graph.get(count.ref) * 2);

const countEvents = graph.addSignalToStream('count-events', count.ref);
const latestCount = graph.addStreamToSignal(
  'latest-count',
  countEvents.ref,
  0,
  (_state, value) => value,
);

graph.get(doubled.ref); // 2
graph.stream(countEvents.ref).subscribe({ next: (value) => console.log(value) });
graph.get(latestCount.ref); // 1
```

`graph.set(...)` remains available for ordinary writable Signal nodes such as external drivers. A state-node output ref is read-only and cannot be passed to `set`.

## State Nodes

The input and output semantics are independent:

| Input  | Signal output                 | Stream output                 |
| ------ | ----------------------------- | ----------------------------- |
| Signal | `SignalDrivenStateSignalNode` | `SignalDrivenStateStreamNode` |
| Stream | `StreamDrivenStateSignalNode` | `StreamDrivenStateStreamNode` |

```ts
const input = graph.addSignal('counter-input', 2);

const counter = graph.addSignalDrivenStateSignalNode({
  id: 'counter-state',
  input: input.ref,
  initial: 0,
  reducer: (state, value) => state + value,
  mutations: {
    increment: (state, by: number) => state + by,
    replace: (_state, value: number) => value,
  },
  actions: (rt) => ({
    incrementByConfiguredStep() {
      return rt.mutations.increment(10);
    },
  }),
});

counter.getState(); // 2 after Signal bootstrap
counter.mutations.increment(3); // 5
counter.actions.incrementByConfiguredStep(); // 15
counter.dispatch(counter.operations.mutations.replace(1));
graph.get(counter.output); // 1
```

Mutations are named, synchronous, pure transitions. Actions may perform effects, but can update their node only through `rt.mutations` or typed `rt.dispatch`. Calls through `.mutations`, `.actions`, and `.dispatch` share the same observable operation pipeline.

## Event Log Projection

`AppendOnlyEventLog` remains an ordered replayable Stream source. Projection is now a first-class Stream-driven state node:

```ts
import { AppendOnlyEventLog, DataGraph } from 'depa-data-graph-core';

const graph = new DataGraph(() => ({}));
const log = new AppendOnlyEventLog<number>();
log.append(2);
log.append(3);

const source = graph.addSource('counter-events', log.stream());
const projection = graph.addStreamDrivenStateSignalNode({
  id: 'counter-projection',
  input: source.ref,
  initial: 0,
  reducer: (state, entry) => state + entry.value,
  mutations: { reset: () => 0 },
});

projection.getState(); // 5; synchronous history was reduced before registration returned
log.append(4);
projection.getState(); // 9
```

Use `StreamDrivenStateStreamNode` when downstream consumers need a transition Stream. A late subscriber receives the current state once, not the complete transition history. The event log remains the owner of historical events.

## Construction Modes

The imperative API, Code DSL, JSON DSL, schema-first API, module refs, and codegen all support Signal/Stream refs and the four state-node kinds.

```ts
import {
  createStateNodeSchemaBuilder,
  createTypedGraph,
  signal,
} from 'depa-data-graph-core';

type AppRuntime = { defaultStep: number };
const stateNodes = createStateNodeSchemaBuilder<AppRuntime>();

const typed = createTypedGraph(
  {
    input: signal(1),
    counter: stateNodes.signalDrivenStateSignal({
      input: 'input',
      initial: 0,
      reducer: (state, value: number) => state + value,
      mutations: { add: (state: number, by: number) => state + by },
      actions: (rt) => ({ addDefault: () => rt.mutations.add(rt.bizRuntime.defaultStep) }),
    }),
  } as const,
  () => ({ defaultStep: 2 }),
);

typed.nodes.counter.mutations.add(2);
typed.nodes.counter.actions.addDefault();
typed.get(typed.nodes.counter.output);
```

Protocol-specific module slots are available as `signalInput`, `streamInput`, `signalOutput`, `streamOutput`, `signalState`, `streamState`, `signalInternal`, and `streamInternal`.

## Framework Adapters

Adapters consume Signal refs, including read-only state-node outputs. Updates remain explicit on the state-node handle:

```tsx
function CounterView({ graph, counter }) {
  const value = useGraphSignal(graph, counter.output);
  return <button onClick={() => counter.mutations.increment(1)}>{value}</button>;
}
```

The same boundary applies to Vue `useGraphSignal`, Solid `useGraphSignal`, and Vanilla `bindElement`/`createReactiveStore`: adapters read graph state; they do not create a second mutation channel.

## Breaking Migration

This release removes the separate Stream graph, graph bridge managers/functions, and reducer-projection wrapper. Migrate as follows:

- Register Stream sources/operators/sinks directly on `DataGraph`.
- Replace bridge calls with explicit `addSignalToStream` / `addStreamToSignal` nodes or one of the four state-node kinds.
- Replace reducer projection helpers with `StreamDrivenStateSignalNode` or `StreamDrivenStateStreamNode`.
- Rename GraphRuntime callback parameters from `ctx` to `rt`; real `MiddlewareContext ctx` variables keep their context name.
- Replace application `intents` wrappers with typed `.mutations.xxx()` and `.actions.xxx()` calls.

See [the migration guide](./doc/architect/migration-unified-state.md) for the exact old-to-new API matrix.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev
```

Architecture documentation starts at [doc/architect/index.md](./doc/architect/index.md), with focused contracts for [the unified graph](./doc/architect/data-graph.md), [state nodes](./doc/architect/state-nodes.md), [state operations](./doc/architect/state-operations.md), and [lifecycle](./doc/architect/stream-lifecycle.md).

## License

MIT
