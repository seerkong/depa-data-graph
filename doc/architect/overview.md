# Architecture Overview

## Design Goals

1. **Framework-Agnostic Core**: State management logic lives outside any UI framework
2. **Explicit Data Graph**: Dependencies are declared, not inferred at runtime
3. **Inspectable State**: Full graph structure and values available via `snapshot()`
4. **Cross-Framework Communication**: Actor-based messaging between isolated framework views
5. **Multiple Construction Modes**: JSON DSL, Code DSL, and Imperative API for flexibility
6. **MVI Pattern**: Unidirectional data flow with named intents
7. **Extensible Core**: Middleware/plugin hooks for cross-cutting concerns (logging, validation, persistence)
8. **Streaming Support**: Stream factories with lifecycle hooks (WebSocket/SSE)

## Why alien-signals?

[alien-signals](https://github.com/nicksrandall/alien-signals) provides:

- **Minimal API**: `signal()`, `computed()`, `effect()`
- **No framework coupling**: Pure JavaScript, works anywhere
- **Batching**: `startBatch()` / `endBatch()` for atomic updates
- **Untracked reads**: `setActiveSub(undefined)` to read without tracking

This makes it ideal as the reactive primitive layer beneath our explicit graph abstraction.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                        Views                                 │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│   │ Vanilla  │ │   Vue    │ │  React   │ │  Solid   │       │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│        │            │            │            │              │
│        └────────────┴─────┬──────┴────────────┘              │
│                           │                                  │
├───────────────────────────┼──────────────────────────────────┤
│                   Framework Adapters                          │
│     @.../vanilla | @.../vue | @.../react | @.../solid         │
│          (hooks/bindings that subscribe to DataGraph)         │
├───────────────────────────┼──────────────────────────────────┤
│                     Actor System                             │
│              (cross-framework messaging)                     │
├───────────────────────────┼──────────────────────────────────┤
│                           │                                  │
│   ┌───────────────────────┴───────────────────────┐         │
│   │                  DemoRuntime                   │         │
│   │  ┌─────────────────────────────────────────┐  │         │
│   │  │              Main Graph                  │  │         │
│   │  │  (signals, computed, processors, async) │  │         │
│   │  └─────────────────────────────────────────┘  │         │
│   │                      │                        │         │
│   │         ┌────────────┼────────────┐          │         │
│   │         ▼            ▼            ▼          │         │
│   │   ┌──────────┐ ┌──────────┐ ┌──────────┐    │         │
│   │   │ Subgraph │ │ Subgraph │ │ Subgraph │    │         │
│   │   │ (vanilla)│ │  (vue)   │ │ (react)  │... │         │
│   │   └──────────┘ └──────────┘ └──────────┘    │         │
│   │                                              │         │
│   │  ┌─────────────────────────────────────────┐ │         │
│   │  │               Intents                    │ │         │
│   │  │  increase() | setInput() | submit()     │ │         │
│   │  └─────────────────────────────────────────┘ │         │
│   └──────────────────────────────────────────────┘         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                     Framework Core                          │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│   │  DataGraph   │ │ GraphBuilders│ │ ActorSystem  │       │
│   │ (middleware)  │                 │ (typed messages)│      │
│   └──────────────┘ └──────────────┘ └──────────────┘       │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ Streams (xstream) + lifecycle hooks (WS/SSE/Fetch/AI) │  │
│   └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    alien-signals                            │
│         signal() | computed() | effect() | batch()         │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

```
User clicks "Increase" button in Vue panel
                │
                ▼
        intents.increase(1)
                │
                ▼
    graph.set('counter', v => v + 1)
                │
                ▼
    ┌───────────┴───────────┐
    │   Reactive propagation │
    │   (alien-signals)      │
    └───────────┬───────────┘
                │
    ┌───────────┼───────────┬───────────┐
    ▼           ▼           ▼           ▼
 plus100    processor   asyncPlus100  subgraph
 computed   runs        triggers      bridges
    │           │           │           │
    ▼           ▼           ▼           ▼
 plus300    isEven,     async         subgraph
 computed   label       result        computed
    │                                   │
    └───────────────┬───────────────────┘
                    ▼
            Views re-render
    (Vanilla, Vue, React, Solid)
```

## Key Design Decisions

### 1. Explicit vs Implicit Dependencies

**Traditional (implicit)**:

```typescript
const doubled = computed(() => count.value * 2);
// Dependencies tracked at runtime
```

**This demo (explicit)**:

```typescript
graph.addComputed('doubled', ['count'], (ctx) => ctx.get('count') * 2);
// Dependencies declared upfront
```

**Why explicit?**

- Graph structure is inspectable without executing code
- Enables tooling (visualization, validation, serialization)
- Makes data flow obvious in large codebases

### 2. Processors vs Computed

| Computed                        | Processor                              |
| ------------------------------- | -------------------------------------- |
| Single output                   | Multiple outputs                       |
| Pure function                   | Side effects allowed                   |
| Returns value                   | Writes to other nodes                  |
| `addComputed(id, deps, getter)` | `addProcessor(id, deps, outputs, run)` |

**Example**: Counter parity check writes to both `isEven` and `label`:

```typescript
graph.addProcessor(
  'processor/counterDerived',
  ['counter'],
  ['counter/isEven', 'counter/label'],
  (ctx) => {
    const c = ctx.get('counter');
    ctx.set('counter/isEven', c % 2 === 0);
    ctx.set('counter/label', c % 2 === 0 ? 'even' : 'odd');
  },
);
```

### 3. Async Nodes

Async nodes automatically create three child signals:

- `{id}/result` - the resolved value
- `{id}/loading` - boolean loading state
- `{id}/error` - error message or null

This standardizes async state handling across the graph.

### 4. Actor Isolation

Frameworks don't share mutable state directly. Instead:

- Each framework registers as an actor
- Communication happens via typed messages
- Actor handlers process messages sequentially (mailbox pattern)

This prevents race conditions and makes cross-framework interactions explicit.

### 5. Subgraph Bridging

Main graph outputs flow into subgraphs via effect bridges:

```typescript
effect(() => {
  const mainPlus300 = runtime.graph.get('plus300');
  subgraph.set('input/mainPlus300', mainPlus300);
});
```

This keeps subgraphs isolated while allowing them to react to main graph changes.

## File Organization

```
packages/
├── core/
│   └── src/                # Reusable, framework-agnostic
│       ├── graph.ts         # DataGraph class (+ middleware hooks)
│       ├── middleware.ts    # GraphMiddleware API
│       ├── plugins/         # logger/persist/validation plugins
│       ├── stream/          # stream graph + factories
│       ├── graph-builders.ts # JSON DSL + Code DSL
│       ├── actor.ts         # ActorSystem
│       └── watch.ts         # watch() utility
├── react/                   # React hooks adapter
├── vue/                     # Vue Composition API adapter
├── solid/                   # Solid accessor adapter
└── vanilla/                 # DOM/store adapter

examples/
└── demo/
    └── src/
        ├── app/            # DemoRuntime, intents, actor handlers
        │   ├── graph/      # Main graph definition
        │   └── subgraphs/  # Subgraph factories
        └── views/          # UI layer (vanilla/vue/react/solid)
```

## Next Steps

- [DataGraph](./data-graph.md) - Deep dive into node types and graph operations
- [Graph Builders](./graph-builders.md) - Three construction modes explained
- [Actor System](./actor-system.md) - Cross-framework messaging details
