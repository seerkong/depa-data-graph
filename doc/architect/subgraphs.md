# Subgraphs

Independent per-framework `DataGraph` instances bridged from the main graph.

**Source**: `examples/demo/src/app/subgraphs/createActorSubgraph.ts`

## Overview

Each framework (vanilla, vue, react, solid) has its own isolated `DataGraph` that:

1. Receives main graph outputs via effect bridges
2. Computes local derived state
3. Remains isolated from other frameworks' subgraphs

```
┌─────────────────────────────────────────────────────────────┐
│                       Main Graph                            │
│  ┌─────────┐    ┌─────────┐    ┌───────────────────────┐   │
│  │ counter │───▶│ plus100 │───▶│ plus300               │   │
│  └─────────┘    └─────────┘    └───────────────────────┘   │
│       │                              │                      │
│       │         ┌────────────────────┘                      │
│       ▼         ▼                                           │
│  ┌─────────────────────┐                                    │
│  │ manual/counterTimes10│                                   │
│  └─────────────────────┘                                    │
│            │         │                                      │
└────────────┼─────────┼──────────────────────────────────────┘
             │         │
    ┌────────┘         └────────┐
    ▼                           ▼
┌─────────────────┐    ┌─────────────────┐
│ Vanilla Subgraph│    │  Vue Subgraph   │  ...
│                 │    │                 │
│ input/mainPlus300    │ input/mainPlus300
│ input/mainTimes10    │ input/mainTimes10
│       │              │       │
│       ▼              │       ▼
│ computed/plusOffset  │ computed/plusOffset
│ computed/sumMain     │ computed/sumMain
│ computed/label       │ computed/label
└─────────────────┘    └─────────────────┘
```

## Why Subgraphs?

| Concern         | Solution                                            |
| --------------- | --------------------------------------------------- |
| **Isolation**   | Each framework's local state doesn't pollute others |
| **Scalability** | Subgraphs can grow independently                    |
| **Testing**     | Subgraphs can be tested in isolation                |
| **Performance** | Only affected subgraphs update                      |

## Subgraph Structure

Each subgraph has the same structure:

```typescript
const SUBGRAPH_NODE = {
  inputMainPlus300: 'input/mainPlus300', // Bridged from main
  inputMainTimes10: 'input/mainTimes10', // Bridged from main
  offset: 'local/offset', // Local signal
  plusOffset: 'computed/plusOffset', // Local computed
  sumMain: 'computed/sumMain', // Local computed
  label: 'computed/label', // Local computed
};
```

## Factory Function

```typescript
export function createActorSubgraph(
  runtime: DemoRuntime,
  actorId: DemoActorId,
): DataGraph<DemoRuntime> {
  const graph = new DataGraph<DemoRuntime>(() => runtime);
  const b = createCodeGraphBuilder(graph);

  const offset = actorOffset(actorId); // Different per framework

  // Define nodes using Code DSL
  b.signal(SUBGRAPH_NODE.inputMainPlus300, 0, { in: true, out: true })
    .signal(SUBGRAPH_NODE.inputMainTimes10, 0, { in: true, out: true })
    .signal(SUBGRAPH_NODE.offset, offset, { in: true, out: true })
    .computed(
      SUBGRAPH_NODE.plusOffset,
      [SUBGRAPH_NODE.inputMainPlus300, SUBGRAPH_NODE.offset],
      (ctx) => {
        const v = ctx.get<number>(SUBGRAPH_NODE.inputMainPlus300);
        const k = ctx.get<number>(SUBGRAPH_NODE.offset);
        return v + k;
      },
      { out: true, computed: true },
    )
    .computed(
      SUBGRAPH_NODE.sumMain,
      [SUBGRAPH_NODE.inputMainPlus300, SUBGRAPH_NODE.inputMainTimes10],
      (ctx) => {
        const a = ctx.get<number>(SUBGRAPH_NODE.inputMainPlus300);
        const b = ctx.get<number>(SUBGRAPH_NODE.inputMainTimes10);
        return a + b;
      },
      { out: true, computed: true },
    )
    .signal(SUBGRAPH_NODE.label, '', { out: true, computed: true })
    .processor(
      'processor/makeLabel',
      [SUBGRAPH_NODE.plusOffset, SUBGRAPH_NODE.sumMain],
      [SUBGRAPH_NODE.label],
      (ctx) => {
        const v = ctx.get<number>(SUBGRAPH_NODE.plusOffset);
        const sum = ctx.get<number>(SUBGRAPH_NODE.sumMain);
        ctx.set<string>(
          SUBGRAPH_NODE.label,
          `${actorId} subgraph: plusOffset=${v}, sumMain=${sum}`,
        );
      },
      { computed: true },
    );

  // Bridge effects (see below)
  // ...

  return graph;
}
```

## Bridge Effects

Effects that sync main graph outputs into subgraph inputs:

```typescript
// Bridge main graph's plus300 → subgraph's input/mainPlus300
graph.addCleanup(
  effect(() => {
    const mainPlus300 = runtime.graph.get<number>('plus300');
    graph.set<number>(SUBGRAPH_NODE.inputMainPlus300, mainPlus300);
  }),
);

// Bridge main graph's manual/counterTimes10 → subgraph's input/mainTimes10
graph.addCleanup(
  effect(() => {
    const times10 = runtime.graph.get<number>('manual/counterTimes10');
    graph.set<number>(SUBGRAPH_NODE.inputMainTimes10, times10);
  }),
);
```

### How Bridges Work

```
Main Graph                          Subgraph
┌─────────────┐                    ┌─────────────────────┐
│   plus300   │──── effect() ────▶│ input/mainPlus300   │
│   (301)     │     reads main,   │ (301)               │
└─────────────┘     writes sub    └─────────────────────┘
                                           │
                                           ▼
                                  ┌─────────────────────┐
                                  │ computed/plusOffset │
                                  │ (302 for vanilla)   │
                                  └─────────────────────┘
```

1. Effect subscribes to main graph node (`plus300`)
2. When main graph updates, effect runs
3. Effect writes new value to subgraph input signal
4. Subgraph's computed nodes recalculate

### Cleanup

Bridge effects are registered with `graph.addCleanup()` so they're disposed when the subgraph is disposed:

```typescript
graph.addCleanup(effect(() => { ... }));

// Later, when subgraph is no longer needed:
graph.dispose();  // All bridge effects are stopped
```

## Per-Framework Offset

Each framework has a unique offset to demonstrate independent state:

```typescript
function actorOffset(actorId: DemoActorId): number {
  if (actorId === 'vanilla') return 1;
  if (actorId === 'vue') return 2;
  if (actorId === 'react') return 3;
  return 4; // solid
}
```

This means:

- Vanilla: `plusOffset = plus300 + 1`
- Vue: `plusOffset = plus300 + 2`
- React: `plusOffset = plus300 + 3`
- Solid: `plusOffset = plus300 + 4`

## Usage in Views

### Creating Subgraph

```typescript
// In examples/demo/src/views/vanilla/mountVanillaView.ts
if (!runtime.subgraphs.vanilla) {
  runtime.subgraphs.vanilla = createActorSubgraph(runtime, 'vanilla');
}
const subgraph = runtime.subgraphs.vanilla;
```

### Creating Subgraph View Model

```typescript
const subgraphLabel$ = subgraph.createViewModelSignal('view/vanilla/subgraph', () => ({
  label: subgraph.get<string>(SUBGRAPH_NODE.label),
}));
```

### Rendering Subgraph State

```typescript
// Vanilla
effect(() => {
  valueSubgraph.textContent = subgraphLabel$().label;
});

// Vue
h('div', { class: 'code' }, sub ? sub.value.label : '')

// React
<div className="code">{sub.label}</div>

// Solid
<div class="code">{sub().label}</div>
```

## Data Flow Example

When `counter` changes from 1 to 2:

```
1. counter: 1 → 2
2. plus100: 101 → 102
3. plus300: 301 → 302
4. manual/counterTimes10: 10 → 20

5. Bridge effects fire:
   - vanilla subgraph: input/mainPlus300 = 302, input/mainTimes10 = 20
   - vue subgraph: input/mainPlus300 = 302, input/mainTimes10 = 20
   - react subgraph: input/mainPlus300 = 302, input/mainTimes10 = 20
   - solid subgraph: input/mainPlus300 = 302, input/mainTimes10 = 20

6. Each subgraph recalculates:
   - vanilla: plusOffset = 302 + 1 = 303, sumMain = 302 + 20 = 322
   - vue: plusOffset = 302 + 2 = 304, sumMain = 322
   - react: plusOffset = 302 + 3 = 305, sumMain = 322
   - solid: plusOffset = 302 + 4 = 306, sumMain = 322

7. Labels update:
   - vanilla: "vanilla subgraph: plusOffset=303, sumMain=322"
   - vue: "vue subgraph: plusOffset=304, sumMain=322"
   - etc.
```

## Subgraph vs Local Computed

| Subgraph                      | Local Computed            |
| ----------------------------- | ------------------------- |
| Separate `DataGraph` instance | Framework-native computed |
| Explicit node IDs             | Anonymous                 |
| Inspectable via `snapshot()`  | Not inspectable           |
| Shared across components      | Component-local           |
| Bridged from main graph       | Reads main graph directly |

**Use subgraph when**:

- State needs to be inspected/debugged
- Multiple components share derived state
- You want explicit data flow documentation

**Use local computed when**:

- Simple, component-local derivation
- No need for inspection
- Framework-native patterns preferred

## Best Practices

1. **Keep subgraphs focused**: Each subgraph should have a clear purpose
2. **Use Code DSL**: Subgraphs are typically built with Code DSL for type safety
3. **Bridge only what's needed**: Don't bridge entire main graph, only required outputs
4. **Register cleanup**: Always use `graph.addCleanup()` for bridge effects
5. **Consistent naming**: Use `input/`, `local/`, `computed/` prefixes for clarity
