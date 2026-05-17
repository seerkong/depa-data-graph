# DataGraph

The `DataGraph` class is the core abstraction for explicit, inspectable state management.

**Source**: `packages/core/src/graph.ts`

## Overview

```typescript
class DataGraph<TRuntime> {
  // Node management
  addSignal<T>(id: string, initialValue: T, flags?: NodeFlags): GraphNode<T>;
  addComputed<T>(
    id: string,
    deps: string[],
    getter: (ctx, prev?) => T,
    flags?: NodeFlags,
  ): GraphNode<T>;
  addProcessor(
    id: string,
    deps: string[],
    outputs: string[],
    run: (ctx) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addConsumer(id: string, deps: string[], run: (ctx) => void, flags?: NodeFlags): GraphNode;
  addAsync<TArgs, TResult>(
    id: string,
    deps: string[],
    config: AsyncConfig,
    flags?: NodeFlags,
  ): GraphNode;

  // Value access
  get<T>(id: string): T; // Read with tracking
  peek<T>(id: string): T; // Read without tracking
  set<T>(id: string, value: Setter<T>): void;

  // Utilities
  use(middleware: GraphMiddleware<TRuntime>): this;
  batch<T>(fn: () => T): T; // Atomic updates
  untracked<T>(fn: () => T): T; // Suspend dependency tracking
  validate(): GraphValidationError[]; // Structural validation
  snapshot(): GraphSnapshot; // Full graph state
  revision(): () => number; // Reactive revision counter

  // Lifecycle
  addCleanup(stop: StopHandle): void;
  dispose(): void;
}
```

## Node Types

### Signal

Basic reactive state container. Readable and writable.

```typescript
graph.addSignal('counter', 1, { in: true, out: true });

// Read
const value = graph.get<number>('counter');

// Write
graph.set<number>('counter', 5);
graph.set<number>('counter', (prev) => prev + 1);
```

**Characteristics**:

- Stores a single value
- Triggers dependents when value changes (using `Object.is` equality)
- Can be read and written from anywhere

### Computed

Derived value from other nodes. Read-only.

```typescript
graph.addComputed(
  'doubled',
  ['counter'],
  (ctx) => {
    return ctx.get<number>('counter') * 2;
  },
  { out: true },
);
```

**Note**: The `computed: true` flag is automatically added by `addComputed()`. You don't need to specify it manually.

**Characteristics**:

- Lazily evaluated (only when read)
- Recomputes on next read when dependencies change
- Caches result until dependencies change
- Receives `prev` parameter for incremental computation

### Processor

Side-effect node that writes to multiple outputs.

```typescript
graph.addProcessor(
  'processor/counterDerived',
  ['counter'], // deps
  ['counter/isEven', 'counter/label'], // outputs
  (ctx) => {
    const c = ctx.get<number>('counter');
    ctx.set<boolean>('counter/isEven', c % 2 === 0);
    ctx.set<string>('counter/label', c % 2 === 0 ? 'even' : 'odd');
  },
  { computed: true },
);
```

**Characteristics**:

- Runs when any dependency changes
- Can write to multiple output signals
- Outputs must be pre-declared
- Runs inside `batch()` automatically

**Use cases**:

- Deriving multiple related values from one source
- Validation (input → error message)
- Normalization (raw input → cleaned value)

### Async

Asynchronous computation with built-in loading/error state.

```typescript
graph.addAsync<[number], number>(
  'asyncPlus100',
  ['counter'],
  {
    initial: 0,
    params: (ctx) => [ctx.get<number>('counter')],
    task: async (value) => {
      await delay(350);
      return value + 100;
    },
  },
  { out: true, computed: true },
);
```

**Auto-created child signals**:

- `asyncPlus100/result` - resolved value (type: `TResult`)
- `asyncPlus100/loading` - boolean loading state
- `asyncPlus100/error` - error message or `null`

**Characteristics**:

- Re-triggers when dependencies change
- Cancels stale requests (only latest result is applied)
- Standardized loading/error handling

### Consumer

Side-effect node that only consumes data without producing new graph nodes.

```typescript
graph.addConsumer('consumer/logCounter', ['counter'], (ctx) => {
  const counter = ctx.get<number>('counter');
  console.log(`[Consumer] counter changed to: ${counter}`);
});
```

**Characteristics**:

- Runs when any dependency changes
- Does NOT write to any output signals (unlike Processor)
- Does NOT produce a readable value (unlike Computed)
- Used for side effects: logging, analytics, external API calls

**Use cases**:

- Logging state changes
- Sending analytics events
- Syncing to external systems (localStorage, server)
- Triggering notifications

**Comparison with Processor**:

| Aspect          | Processor                         | Consumer                   |
| --------------- | --------------------------------- | -------------------------- |
| Outputs         | Writes to declared output signals | No outputs                 |
| Purpose         | Transform data within graph       | Side effects outside graph |
| `outputs` param | Required                          | Not applicable             |

## Node Flags

```typescript
type NodeFlags = {
  in?: boolean; // Input node (user-writable)
  out?: boolean; // Output node (view-readable)
  computed?: boolean; // Derived value
  restriction?: boolean; // Access restriction marker
  validation?: boolean; // Validation-related node
};
```

Flags are metadata for tooling and documentation. They don't affect runtime behavior.

## Graph Context

All node computations receive a `GraphContext`:

```typescript
interface GraphContext<TRuntime> {
  runtime: TRuntime; // Application runtime
  get<T>(id: string): T; // Read with tracking
  peek<T>(id: string): T; // Read without tracking
  set<T>(id: string, value: Setter<T>): void; // Write
  batch<T>(fn: () => T): T; // Atomic updates
}
```

**Example**:

```typescript
graph.addComputed('greeting', ['hello/name'], (ctx) => {
  const name = ctx.get<string>('hello/name');
  return `Hello, ${name}!`;
});
```

## Edges

The graph tracks three types of edges:

| Edge Kind   | Meaning                    | Example                    |
| ----------- | -------------------------- | -------------------------- |
| `dependsOn` | Node reads from another    | `doubled` → `counter`      |
| `writesTo`  | Processor writes to output | `processor/x` → `x/result` |
| `viewReads` | View model reads from node | `view:vanilla` → `counter` |

Edges are derived from declared `deps` and `outputs`, not runtime tracking.

## Snapshot

Get the full graph state at any moment:

```typescript
const snap = graph.snapshot();

// snap.revision - monotonic counter
// snap.nodes - array of node states
// snap.edges - array of edges
// snap.viewDeps - view → node dependencies
```

**Node snapshot**:

```typescript
{
  id: 'counter',
  kind: 'signal',
  flags: { in: true, out: true },
  deps: [],
  outputs: [],
  version: 5,        // How many times value changed
  updatedAt: 1705..., // Last update timestamp
  value: 42          // Current value (untracked read)
}
```

## Validation

Validate the graph structure (without executing node logic):

```typescript
const errors = graph.validate();
if (errors.length) {
  console.warn(errors);
}
```

**Checks include**:

- Missing `deps` targets
- Missing `outputs` targets
- Outputs that exist but are not writable
- View model deps pointing to missing nodes
- Cycles in declared deps

Each entry is a structured `GraphValidationError` with fields like:

- `kind` (e.g. `missingDep`, `outputNotWritable`, `cycle`)
- `from`, `to` (or `path` for cycles)
- `message` and optional `suggestion`

## Revision Tracking

The graph maintains a reactive revision counter:

```typescript
const revision$ = graph.revision();

effect(() => {
  console.log('Graph changed, revision:', revision$());
});
```

Revision increments on:

- Node added
- Node value changed
- View dependencies changed

## View Model Signals

Create a reactive signal that tracks which nodes a view reads:

```typescript
const viewModel$ = graph.createViewModelSignal('view:vanilla', () => ({
  counter: graph.get<number>('counter'),
  label: graph.get<string>('counter/label'),
}));

// viewModel$ is a signal that updates when counter or label changes
// graph.snapshot().viewDeps['view:vanilla'] = ['counter', 'counter/label']
```

This enables:

- Fine-grained view updates
- Dependency visualization in tooling

## Middleware / Plugins

The graph supports registering middleware for cross-cutting concerns (logging, validation, persistence, metrics):

```ts
import type { GraphMiddleware } from 'depa-data-graph-core';

graph.use({
  name: 'my-middleware',
  beforeSet: (id, value) => {
    // return `undefined` to block a write
    return value;
  },
  afterSet: (id) => {
    console.log('updated', id);
  },
});
```

Middleware hooks are invoked at well-defined points:

- `beforeGet` / `afterGet`
- `beforeSet` / `afterSet`
- `onNodeAdd`
- `onBatch`
- `onDispose`

Built-in plugins are provided as middleware helpers:

- `loggerPlugin()`
- `persistPlugin()`
- `validationPlugin()`

## Batching

Group multiple writes into a single update:

```typescript
graph.batch(() => {
  graph.set('counter', 10);
  graph.set('hello/input', 'test');
  // Dependents only recalculate once, after batch completes
});
```

## Untracked Reads

Read values without creating dependencies:

```typescript
graph.addComputed('example', ['a'], (ctx) => {
  const a = ctx.get<number>('a'); // Tracked
  const b = ctx.peek<number>('b'); // Not tracked
  return a + b;
});
// Only re-runs when 'a' changes, not when 'b' changes
```

## Lifecycle

```typescript
// Add cleanup handlers
graph.addCleanup(() => {
  console.log('Cleaning up...');
});

// Dispose all effects and cleanup handlers
graph.dispose();
```

## Internal Implementation

The `DataGraph` wraps `alien-signals` primitives:

| DataGraph                | alien-signals                 |
| ------------------------ | ----------------------------- |
| Signal node              | `signal()`                    |
| Computed node            | `computed()`                  |
| Processor/Async/Consumer | `effect()`                    |
| `batch()`                | `startBatch()` / `endBatch()` |
| `untracked()`            | `setActiveSub(undefined)`     |

The wrapper adds:

- Explicit dependency declaration
- Node metadata (id, kind, flags)
- Snapshot capability
- View dependency tracking
