# depa-data-graph

A framework-agnostic state management library featuring explicit data graphs, MVI (Model-View-Intent) pattern, and actor-based cross-framework messaging.

English | [中文](./README-CN.md)

## Packages

| Package                                       | Description                                    | npm                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [depa-data-graph-core](./packages/core)       | Core library: DataGraph, ActorSystem, builders | [![npm](https://img.shields.io/npm/v/depa-data-graph-core)](https://www.npmjs.com/package/depa-data-graph-core)       |
| [depa-data-graph-react](./packages/react)     | React adapter: Hooks integration               | [![npm](https://img.shields.io/npm/v/depa-data-graph-react)](https://www.npmjs.com/package/depa-data-graph-react)     |
| [depa-data-graph-vue](./packages/vue)         | Vue adapter: Composition API integration       | [![npm](https://img.shields.io/npm/v/depa-data-graph-vue)](https://www.npmjs.com/package/depa-data-graph-vue)         |
| [depa-data-graph-solid](./packages/solid)     | Solid adapter: Accessor integration            | [![npm](https://img.shields.io/npm/v/depa-data-graph-solid)](https://www.npmjs.com/package/depa-data-graph-solid)     |
| [depa-data-graph-vanilla](./packages/vanilla) | Vanilla adapter: DOM bindings & store          | [![npm](https://img.shields.io/npm/v/depa-data-graph-vanilla)](https://www.npmjs.com/package/depa-data-graph-vanilla) |

## Examples

| Example                 | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| [demo](./examples/demo) | Mixed tech stacks demo (Vanilla + Vue + React + Solid) |

## Features

- **Explicit Data Graph**: Dependencies declared upfront, not tracked at runtime
- **Framework Agnostic**: Core state management works with any UI framework
- **Multiple Construction Modes**: JSON DSL, Code DSL, and Imperative API
- **Actor-Based Messaging**: Cross-framework communication via typed messages
- **Subgraph Isolation**: Per-framework independent state with bridge effects
- **MVI Pattern**: Unidirectional data flow with named intents
- **Timeline / Event Log Foundations**: Ordered append-only timelines, channel fanout, and reducer projections
- **Module Identity**: Structured node refs, public ports, and scoped subgraph mounting

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start demo dev server
pnpm dev
```

## Project Structure

```
depa-data-graph/
├── packages/
│   └── core/                    # depa-data-graph-core
│       ├── src/
│       │   ├── graph.ts         # DataGraph class
│       │   ├── graph-builders.ts # JSON DSL + Code DSL builders
│       │   ├── actor.ts         # ActorSystem
│       │   ├── watch.ts         # watch() and untracked() utilities
│       │   └── index.ts         # Public exports
│       ├── package.json
│       └── tsconfig.json
├── examples/
│   └── demo/                    # Demo application
│       ├── src/
│       │   ├── app/             # Runtime, intents, graph config
│       │   └── views/           # Vanilla/Vue/React/Solid views
│       ├── index.html
│       ├── package.json
│       └── vite.config.ts
├── doc/
│   └── architect/               # Architecture documentation
├── package.json                 # Root workspace config
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Installation

```bash
# Using pnpm
pnpm add depa-data-graph-core alien-signals xstream

# Using npm
npm install depa-data-graph-core alien-signals xstream

# Using yarn
yarn add depa-data-graph-core alien-signals xstream
```

### Framework adapters

```bash
# React
pnpm add depa-data-graph-react react

# Vue
pnpm add depa-data-graph-vue vue

# Solid
pnpm add depa-data-graph-solid solid-js

# Vanilla
pnpm add depa-data-graph-vanilla
```

## Usage

```typescript
import { DataGraph, createCodeGraphBuilder, ActorSystem } from 'depa-data-graph-core';

// Create a data graph
const graph = new DataGraph(() => runtime);

// Build with Code DSL
createCodeGraphBuilder(graph)
  .signal('counter', 0)
  .computed('doubled', ['counter'], (ctx) => ctx.get('counter') * 2)
  .consumer('logger', ['counter'], (ctx) => {
    console.log('Counter:', ctx.get('counter'));
  });

// Read and write
graph.get('counter'); // 0
graph.set('counter', 1); // triggers computed + consumer
graph.get('doubled'); // 2
```

## Ordered Timelines And Event Projections

`depa-data-graph-core` also exposes low-level stream foundations for append-only timelines and reducer-style projections:

```ts
import {
  AppendOnlyEventLog,
  OrderedTimeline,
  createReducerProjection,
} from 'depa-data-graph-core';

const timeline = new OrderedTimeline<string>();
const content = timeline.createChannel('content');
content.append('hello');
content.append('world');

const log = new AppendOnlyEventLog<number>();
log.append(2);
log.append(3);

const projection = createReducerProjection(log, {
  initial: 0,
  reducer: (state, entry) => state + entry.value,
});

projection.getState(); // 5
```

Use `OrderedTimeline` when you need globally ordered appends plus per-channel fanout. Use `AppendOnlyEventLog` and `createReducerProjection` when you need replayable event history and derived snapshots.

## Typed Model Helper (Optional)

If you want compile-time checking for node IDs and value types, you can define a schema and wrap a graph:

```ts
import { DataGraph, asTypedGraph, defineModel, types } from 'depa-data-graph-core';

const MODEL = defineModel({
  counter: types.number(),
  name: types.string(),
} as const);

const graph = asTypedGraph(new DataGraph(() => runtime), MODEL);

graph.addSignal('counter', 0);
graph.set('counter', 1); // ok
// graph.set('counter', 'x'); // TS error
// graph.get('missing');      // TS error
```

## Schema-first Typed Graph (Optional)

If you prefer defining a typed graph upfront (instead of wrapping an existing one), use the Schema-first API:

```ts
import { computed, createTypedGraph, signal } from 'depa-data-graph-core';

const graph = createTypedGraph(
  {
    counter: signal(0),
    doubled: computed(['counter'], (ctx) => ctx.get<number>('counter') * 2),
  } as const,
  () => ({}),
);

graph.set('counter', 1);
graph.get('doubled'); // number
```

## Module Identity (Optional)

For reusable subgraphs and multi-instance composition, you can define structured refs instead of hand-authoring long-lived string IDs:

```ts
import { defineGraphModule, input, mountGraph, output, state, toNodeId } from 'depa-data-graph-core';

const StageModule = defineGraphModule('stage', {
  inputs: {
    lexicalEvents: input<string[]>(),
  },
  outputs: {
    semanticEvents: output<string[]>(),
  },
  state: {
    lexicalSeq: state<number>(),
  },
} as const);

const main = mountGraph(StageModule, { scope: 'agent/main' });

toNodeId(main.inputs.lexicalEvents);
// 'agent/main::stage.inputs.lexicalEvents'
```

The canonical string still exists for runtime/debugging, but the ref object becomes the primary long-lived identity in application code.

## Framework Adapters

### React

```ts
import type { DataGraph } from 'depa-data-graph-core';
import { useGraph, useGraphComputed, useGraphSignal } from 'depa-data-graph-react';

function CounterView(props: { graph: DataGraph<unknown> }) {
  const counter = useGraphSignal<number, unknown>(props.graph, 'counter');
  const doubled = useGraphComputed<number, unknown>(
    props.graph,
    () => props.graph.get<number>('counter') * 2,
  );

  const vm = useGraph(props.graph, ['counter'] as const);
  void vm;

  return `${counter} doubled=${doubled}`;
}
```

### Vue

```ts
import type { DataGraph } from 'depa-data-graph-core';
import { useGraphSignal } from 'depa-data-graph-vue';

export function useCounter(graph: DataGraph<unknown>) {
  const counter = useGraphSignal<number, unknown>(graph, 'counter'); // Ref<number>
  return { counter };
}
```

### Solid

```ts
import type { DataGraph } from 'depa-data-graph-core';
import { useGraphSignal } from 'depa-data-graph-solid';

export function useCounter(graph: DataGraph<unknown>) {
  const counter = useGraphSignal<number, unknown>(graph, 'counter'); // Accessor<number>
  return { counter };
}
```

### Vanilla

```ts
import type { DataGraph } from 'depa-data-graph-core';
import { bindElement, createReactiveStore } from 'depa-data-graph-vanilla';

export function mountCounter(el: HTMLElement, graph: DataGraph<unknown>) {
  bindElement(graph, 'counter', el, { property: 'textContent' });

  const store = createReactiveStore(graph, ['counter'] as const);
  const stop = store.subscribe((v) => console.log('counter', v.counter));
  return stop;
}
```

## Middleware (Plugins)

```ts
import { loggerPlugin, validationPlugin } from 'depa-data-graph-core';

graph.use(loggerPlugin({ level: 'info' }));
graph.use(
  validationPlugin({
    rules: {
      counter: (v) => (typeof v === 'number' && v < 0 ? 'Cannot be negative' : null),
    },
  }),
);
```

## Stream Lifecycle Hooks

```ts
import { createWebSocketStream } from 'depa-data-graph-core';

const ws$ = createWebSocketStream('wss://example.invalid', {
  lifecycle: {
    onDisconnect: (event) => console.log('disconnected', event),
    shouldReconnect: () => true,
    reconnectStrategy: (attempt) => (attempt < 5 ? 250 * 2 ** attempt : null),
  },
});
```

## Migration Notes (Breaking Changes)

### Explicit deps are enforced

`computed`, `processor`, `consumer`, and `async` nodes only re-run when their declared `deps` change. Reads of other nodes inside the logic no longer create implicit subscriptions.

Enable deps audit to find undeclared reads:

```ts
graph.setDepsAudit('warn'); // or 'throw'
```

Before:

```ts
graph.addComputed('c', ['a'], (ctx) => ctx.get('a') + ctx.get('b'));
```

After:

```ts
graph.addComputed('c', ['a', 'b'], (ctx) => ctx.get('a') + ctx.get('b'));
```

### Computed nodes are lazy

Computed logic runs only when the node is read (`graph.get('id')`). If you relied on eager/background computation, explicitly read it once during startup, or express the behavior as a `consumer`/`processor`.

## Node Types

| Type          | Description                                 | Outputs                                     |
| ------------- | ------------------------------------------- | ------------------------------------------- |
| **Signal**    | Basic reactive state                        | Readable & writable                         |
| **Computed**  | Derived value from dependencies             | Read-only, auto `computed` flag             |
| **Processor** | Side-effect that writes to multiple outputs | Declared output signals                     |
| **Consumer**  | Side-effect that only consumes data         | No outputs (logging, analytics)             |
| **Async**     | Async computation with loading/error state  | `{id}/result`, `{id}/loading`, `{id}/error` |

## Three Construction Modes

### 1. JSON DSL

```json
{
  "version": 1,
  "nodes": [
    { "kind": "signal", "id": "counter", "initial": 1 },
    { "kind": "computed", "id": "doubled", "deps": ["counter"], "logicKey": "doubled" }
  ]
}
```

### 2. Code DSL

```typescript
createCodeGraphBuilder(graph)
  .signal('counter', 1)
  .computed('doubled', ['counter'], (ctx) => ctx.get('counter') * 2)
  .consumer('logger', ['counter'], (ctx) => console.log(ctx.get('counter')));
```

### 3. Imperative API

```typescript
graph.addSignal('counter', 1);
graph.addComputed('doubled', ['counter'], (ctx) => ctx.get('counter') * 2);
graph.addConsumer('logger', ['counter'], (ctx) => console.log(ctx.get('counter')));
```

## Actor Messaging

Frameworks communicate via typed messages:

```typescript
// Register actor without state
actorMesh.register('vue', (self, envelope) => {
  if (envelope.msg.type === 'ping') {
    self.send(envelope.from, { type: 'pong', text: 'hello' });
  }
});

// Register actor with state
actorMesh.register('react', {
  initialState: { count: 0 },
  handler: (self, envelope) => {
    self.state.count++;
    if (envelope.msg.type === 'ping') {
      // Pass self.ref as reply address
      self.send(envelope.from, { type: 'pong', replyTo: self.ref });
    }
  },
});

// External: use sendFrom (from is explicit)
actorMesh.sendFrom('system', 'vue', { type: 'ping' });

// External: use refFrom to get a bound ActorRef
const vueRef = actorMesh.refFrom('system', 'vue');
vueRef?.send({ type: 'ping' }); // from is bound to 'system'

// Broadcast to all
actorMesh.broadcastFrom('system', { type: 'ping' });
```

## Documentation

See [doc/architect/](./doc/architect/) for detailed architecture documentation:

- [Overview](./doc/architect/overview.md) - High-level architecture
- [DataGraph](./doc/architect/data-graph.md) - Node types, edges, snapshot
- [Graph Builders](./doc/architect/graph-builders.md) - Three construction modes
- [Actor System](./doc/architect/actor-system.md) - Cross-framework messaging
- [Framework Adapters](./doc/architect/framework-adapters.md) - Per-framework integration
- [Subgraphs](./doc/architect/subgraphs.md) - Subgraph bridging
- [MVI Flow](./doc/architect/mvi-flow.md) - Unidirectional data flow

## Tech Stack

- [alien-signals](https://github.com/nicksrandall/alien-signals) - Reactive primitives
- [pnpm](https://pnpm.io/) - Package manager with workspace support
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vite](https://vitejs.dev/) - Build tool (for examples)

## License

MIT
