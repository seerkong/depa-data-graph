# Graph Builders

Three ways to construct a `DataGraph`: JSON DSL, Code DSL, and Imperative API.

**Source**: `packages/core/src/graph-builders.ts`

## Comparison

| Mode           | Serializable | Type-Safe  | Dynamic | Use Case                              |
| -------------- | ------------ | ---------- | ------- | ------------------------------------- |
| **JSON DSL**   | ✅ Yes       | ⚠️ Partial | ❌ No   | Config files, tooling, visual editors |
| **Code DSL**   | ❌ No        | ✅ Yes     | ❌ No   | Application code, fluent API          |
| **Imperative** | ❌ No        | ✅ Yes     | ✅ Yes  | Runtime additions, plugins            |

## 1. JSON DSL

Separates graph structure (JSON) from computation logic (TypeScript).

### JSON Spec

```json
{
  "version": 1,
  "nodes": [
    {
      "kind": "signal",
      "id": "counter",
      "initial": 1,
      "flags": { "in": true, "out": true }
    },
    {
      "kind": "computed",
      "id": "plus100",
      "deps": ["counter"],
      "logicKey": "plus100",
      "flags": { "out": true }
    },
    {
      "kind": "processor",
      "id": "processor/counterDerived",
      "deps": ["counter"],
      "outputs": ["counter/isEven", "counter/label"],
      "logicKey": "counterDerived"
    },
    {
      "kind": "consumer",
      "id": "consumer/logCounter",
      "deps": ["counter"],
      "logicKey": "logCounter"
    },
    {
      "kind": "async",
      "id": "asyncPlus100",
      "deps": ["counter"],
      "initial": 0,
      "logicKey": "asyncPlus100",
      "flags": { "out": true }
    }
  ]
}
```

### Logic Registry

```typescript
// examples/demo/src/app/graph/main-graph.logic.ts
import type { JsonGraphLogicRegistry } from 'depa-data-graph-core';
import type { DemoRuntime } from '../runtime';

export const mainGraphLogic: JsonGraphLogicRegistry<DemoRuntime> = {
  computed: {
    plus100: (ctx) => ctx.get<number>('counter') + 100,
    plus300: (ctx) => ctx.get<number>('plus100') + 200,
  },
  processor: {
    counterDerived: (ctx) => {
      const c = ctx.get<number>('counter');
      ctx.set<boolean>('counter/isEven', c % 2 === 0);
      ctx.set<string>('counter/label', c % 2 === 0 ? 'even' : 'odd');
    },
  },
  consumer: {
    logCounter: (ctx) => {
      const counter = ctx.get<number>('counter');
      console.log(`[Consumer] counter changed to: ${counter}`);
    },
  },
  async: {
    asyncPlus100: {
      params: (ctx) => [ctx.get<number>('counter')],
      task: async (value) => {
        await delay(350);
        return Number(value) + 100;
      },
    },
  },
};
```

### Building

```typescript
import { buildGraphFromJson } from 'depa-data-graph-core';

import mainGraphSpecJson from './graph/main-graph.json';
import { mainGraphLogic } from './graph/main-graph.logic';

const graph = new DataGraph<DemoRuntime>(() => runtime);
buildGraphFromJson(graph, mainGraphSpecJson, mainGraphLogic);
```

### Node Types in JSON

#### Signal

```json
{
  "kind": "signal",
  "id": "counter",
  "initial": 1,
  "flags": { "in": true, "out": true }
}
```

#### Computed

```json
{
  "kind": "computed",
  "id": "plus100",
  "deps": ["counter"],
  "logicKey": "plus100",
  "flags": { "out": true }
}
```

**Note**: The `computed: true` flag is automatically added by `addComputed()`.

#### Processor

```json
{
  "kind": "processor",
  "id": "processor/counterDerived",
  "deps": ["counter"],
  "outputs": ["counter/isEven", "counter/label"],
  "logicKey": "counterDerived"
}
```

#### Consumer

```json
{
  "kind": "consumer",
  "id": "consumer/logCounter",
  "deps": ["counter"],
  "logicKey": "logCounter"
}
```

#### Async

```json
{
  "kind": "async",
  "id": "asyncPlus100",
  "deps": ["counter"],
  "initial": 0,
  "logicKey": "asyncPlus100",
  "flags": { "out": true }
}
```

**Note**: The `computed: true` flag is automatically added by `addAsync()`.

### Benefits

- **Serializable**: Store graph structure in files, databases, or send over network
- **Tooling-friendly**: Visual editors can manipulate JSON without parsing code
- **Separation of concerns**: Structure vs logic clearly separated
- **Validation**: JSON schema can validate structure before runtime

### Limitations

- Logic must be pre-registered (no inline functions)
- Less type-safe than pure TypeScript
- Two files to maintain (JSON + logic registry)

---

## 2. Code DSL

Fluent, chainable API for building graphs in TypeScript.

### Usage

```typescript
import { createCodeGraphBuilder } from 'depa-data-graph-core';

const graph = new DataGraph<DemoRuntime>(() => runtime);
const b = createCodeGraphBuilder(graph);

b.signal('counter', 1, { in: true, out: true })
  .signal('hello/input', '', { in: true, out: true })
  .computed('plus100', ['counter'], (ctx) => ctx.get<number>('counter') + 100, { out: true })
  .computed('plus300', ['plus100'], (ctx) => ctx.get<number>('plus100') + 200, { out: true })
  .processor(
    'processor/counterDerived',
    ['counter'],
    ['counter/isEven', 'counter/label'],
    (ctx) => {
      const c = ctx.get<number>('counter');
      ctx.set<boolean>('counter/isEven', c % 2 === 0);
      ctx.set<string>('counter/label', c % 2 === 0 ? 'even' : 'odd');
    },
  )
  .consumer('consumer/logCounter', ['counter'], (ctx) => {
    console.log(`[Consumer] counter: ${ctx.get<number>('counter')}`);
  })
  .async(
    'asyncPlus100',
    ['counter'],
    {
      initial: 0,
      params: (ctx) => [ctx.get<number>('counter')],
      task: async (value) => value + 100,
    },
    { out: true },
  );
```

### Builder Interface

```typescript
interface CodeGraphBuilder<TRuntime> {
  signal(id: string, initial: unknown, flags?: NodeFlags): CodeGraphBuilder<TRuntime>;
  computed(
    id: string,
    deps: string[],
    getter: (ctx, prev?) => unknown,
    flags?: NodeFlags,
  ): CodeGraphBuilder<TRuntime>;
  processor(
    id: string,
    deps: string[],
    outputs: string[],
    run: (ctx) => void,
    flags?: NodeFlags,
  ): CodeGraphBuilder<TRuntime>;
  consumer(
    id: string,
    deps: string[],
    run: (ctx) => void,
    flags?: NodeFlags,
  ): CodeGraphBuilder<TRuntime>;
  async(
    id: string,
    deps: string[],
    config: AsyncConfig,
    flags?: NodeFlags,
  ): CodeGraphBuilder<TRuntime>;
}
```

### Benefits

- **Type-safe**: Full TypeScript inference
- **Fluent**: Chainable API reads naturally
- **Inline logic**: Functions defined where they're used
- **IDE support**: Autocomplete, refactoring, go-to-definition

### Limitations

- Not serializable
- Graph structure mixed with logic

---

## 3. Imperative API

Direct method calls on `DataGraph` for dynamic additions.

### Usage

```typescript
const graph = new DataGraph<DemoRuntime>(() => runtime);

// Build initial graph (via JSON or Code DSL)
buildGraphFromJson(graph, mainGraphSpecJson, mainGraphLogic);

// Add nodes imperatively at runtime
graph.addComputed<number>(
  'manual/counterTimes10',
  ['counter'],
  (ctx) => ctx.get<number>('counter') * 10,
  { out: true },
);

// Add a consumer for side effects
graph.addConsumer('consumer/logCounter', ['counter'], (ctx) => {
  console.log(`[Consumer] counter: ${ctx.get<number>('counter')}`);
});

// Later, add more nodes based on runtime conditions
if (featureFlags.enableAdvancedMetrics) {
  graph.addComputed('metrics/advanced', ['counter', 'plus100'], (ctx) => {
    return ctx.get<number>('counter') * ctx.get<number>('plus100');
  });
}
```

### Benefits

- **Dynamic**: Add nodes at runtime based on conditions
- **Plugin-friendly**: Extensions can add their own nodes
- **Incremental**: Build graph piece by piece

### Limitations

- No declarative overview of full graph
- Harder to visualize/validate upfront
- Order-dependent (dependencies must exist before dependents)

---

## Combining Modes

All three modes can be used together:

```typescript
// 1. Start with JSON DSL for core graph
const graph = new DataGraph<DemoRuntime>(() => runtime);
buildGraphFromJson(graph, mainGraphSpecJson, mainGraphLogic);

// 2. Use Code DSL for subgraphs
const subgraph = new DataGraph<DemoRuntime>(() => runtime);
createCodeGraphBuilder(subgraph)
  .signal('input/mainPlus300', 0, { in: true })
  .computed(
    'local/doubled',
    ['input/mainPlus300'],
    (ctx) => ctx.get<number>('input/mainPlus300') * 2,
  );

// 3. Use Imperative API for dynamic additions
graph.addComputed('manual/counterTimes10', ['counter'], (ctx) => ctx.get<number>('counter') * 10);
```

---

## Type Definitions

### JSON Types

```typescript
type JsonSignalNode = {
  kind: 'signal';
  id: string;
  initial: unknown;
  flags?: NodeFlags;
};

type JsonComputedNode = {
  kind: 'computed';
  id: string;
  deps: string[];
  logicKey: string;
  flags?: NodeFlags;
};

type JsonProcessorNode = {
  kind: 'processor';
  id: string;
  deps: string[];
  outputs: string[];
  logicKey: string;
  flags?: NodeFlags;
};

type JsonAsyncNode = {
  kind: 'async';
  id: string;
  deps: string[];
  initial: unknown;
  logicKey: string;
  flags?: NodeFlags;
};

type JsonConsumerNode = {
  kind: 'consumer';
  id: string;
  deps: string[];
  logicKey: string;
  flags?: NodeFlags;
};

type JsonGraphNode =
  | JsonSignalNode
  | JsonComputedNode
  | JsonProcessorNode
  | JsonAsyncNode
  | JsonConsumerNode;

interface JsonGraphSpecV1 {
  version: 1;
  nodes: JsonGraphNode[];
}
```

### Logic Registry Type

```typescript
interface JsonGraphLogicRegistry<TRuntime> {
  computed: Record<string, (ctx: GraphContext<TRuntime>, prev?: unknown) => unknown>;
  processor: Record<string, (ctx: GraphContext<TRuntime>) => void>;
  consumer: Record<string, (ctx: GraphContext<TRuntime>) => void>;
  async: Record<
    string,
    {
      params: (ctx: GraphContext<TRuntime>) => unknown[];
      task: (...args: unknown[]) => Promise<unknown>;
    }
  >;
}
```

---

## Best Practices

1. **Use JSON DSL** for the main application graph that needs to be inspected/visualized
2. **Use Code DSL** for subgraphs and framework-specific state
3. **Use Imperative API** sparingly, for truly dynamic scenarios
4. **Keep logic registry organized** by domain (counter, hello, async, etc.)
5. **Use consistent ID naming**: `domain/property` (e.g., `hello/input`, `counter/isEven`)
