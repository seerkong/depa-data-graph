# Architecture Documentation

> Framework-agnostic state management demo based on `alien-signals` with explicit data graph, MVI pattern, and actor-based cross-framework messaging.

## Documents

| Document                                      | Description                                                  |
| --------------------------------------------- | ------------------------------------------------------------ |
| [Overview](./overview.md)                     | High-level architecture and design goals                     |
| [DataGraph](./data-graph.md)                  | Core `DataGraph` class: node types, edges, snapshot          |
| [Middleware](./middleware.md)                 | Middleware / plugins API and built-in plugins                |
| [Graph Builders](./graph-builders.md)         | Three construction modes: JSON DSL, Code DSL, Imperative API |
| [Module Identity](./module-identity.md)      | Structured node refs, public ports, and scoped mounting      |
| [Actor System](./actor-system.md)             | Cross-framework messaging with `ActorSystem`                 |
| [Framework Adapters](./framework-adapters.md) | Per-framework integration patterns (Vanilla/Vue/React/Solid) |
| [Typed Graph](./typed-graph.md)               | Type-safe node IDs and value types                           |
| [Subgraphs](./subgraphs.md)                   | Independent subgraphs with bridge effects                    |
| [MVI Flow](./mvi-flow.md)                     | Model-View-Intent unidirectional data flow                   |
| [Stream Lifecycle](./stream-lifecycle.md)     | WebSocket/SSE lifecycle hooks and heartbeats                 |

## Quick Start

```
packages/
├── core/
│   └── src/
│       ├── graph.ts          # DataGraph class
│       ├── module-identity.ts # NodeRef / GraphModule / mount helpers
│       ├── middleware.ts     # GraphMiddleware API
│       ├── plugins/          # logger/persist/validation plugins
│       ├── stream/           # stream graph + factories
│       ├── graph-builders.ts # JSON DSL + Code DSL builders
│       ├── actor.ts          # ActorSystem
│       └── watch.ts          # watch() and untracked() utilities
├── react/                    # React hooks adapter
├── vue/                      # Vue Composition API adapter
├── solid/                    # Solid accessor adapter
└── vanilla/                  # DOM/store adapter

examples/
└── demo/
    └── src/
        ├── app/
        │   ├── runtime.ts              # DemoRuntime, intents, actor handlers
        │   ├── graph/
        │   │   ├── main-graph.json     # Main graph JSON DSL spec
        │   │   └── main-graph.logic.ts # Logic registry for JSON DSL
        │   └── subgraphs/
        │       └── createActorSubgraph.ts # Per-framework subgraph factory
        └── views/
            ├── vanilla/                # Vanilla JS view
            ├── vue/                    # Vue view
            ├── react/                  # React view
            └── solid/                  # Solid view
```

## Key Concepts

### 1. Explicit Data Graph

Unlike traditional reactive systems where dependencies are implicit (tracked at runtime), this demo uses an **explicit data graph** where:

- Every node has a declared `id`
- Dependencies (`deps`) are explicitly listed
- Outputs (`outputs`) are explicitly declared for processors
- The entire graph structure is inspectable via `snapshot()`

### 2. Three Construction Modes

| Mode           | Use Case                       | Example                                                   |
| -------------- | ------------------------------ | --------------------------------------------------------- |
| **JSON DSL**   | Serializable, tooling-friendly | `main-graph.json` + `main-graph.logic.ts`                 |
| **Code DSL**   | Type-safe, fluent API          | `createCodeGraphBuilder(graph).signal(...).computed(...)` |
| **Imperative** | Dynamic additions              | `graph.addComputed('id', deps, getter)`                   |

### 3. Structured Module Identity

For reusable subgraphs and multi-instance composition, `depa-data-graph-core` also exposes structured node refs and module mounting helpers:

- `defineGraphModule()`
- `input()` / `output()` / `state()` / `internal()`
- `mountGraph()`
- `toNodeId()`

These APIs let authoring code work with typed refs first while runtime canonical strings stay available for snapshots and diagnostics.

### 4. Actor-Based Messaging

Frameworks communicate via message passing, not shared mutable state:

```
[Vanilla] --send('vue', {type:'ping'})--> [Vue]
[Vue] --send('vanilla', {type:'pong'})--> [Vanilla]
```

### 5. Subgraph Isolation

Each framework has its own independent `DataGraph` that:

- Receives main graph outputs via effect bridges
- Computes local derived state
- Remains isolated from other frameworks' subgraphs

### 6. MVI Pattern

```
User Action → Intent → Model (DataGraph) → View
                ↑                            │
                └────────────────────────────┘
```

- **Model**: `DataGraph` nodes (signals, computed, processors, consumers, async)
- **View**: Framework-specific rendering (Vanilla/Vue/React/Solid)
- **Intent**: Named actions that modify the model (`intents.increase()`, `intents.setInput()`)
