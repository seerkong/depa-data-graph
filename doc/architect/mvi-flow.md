# MVI Flow

Model-View-Intent unidirectional data flow pattern.

## Overview

MVI (Model-View-Intent) is a unidirectional data flow architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    User Action                                              │
│         │                                                   │
│         ▼                                                   │
│    ┌─────────┐                                              │
│    │ Intent  │  Named actions that describe user intent     │
│    └────┬────┘                                              │
│         │                                                   │
│         ▼                                                   │
│    ┌─────────┐                                              │
│    │  Model  │  DataGraph (signals, computed, processors)   │
│    └────┬────┘                                              │
│         │                                                   │
│         ▼                                                   │
│    ┌─────────┐                                              │
│    │  View   │  Framework-specific rendering                │
│    └────┬────┘                                              │
│         │                                                   │
│         └──────────────────────────────────────────────────▶│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Model

The `DataGraph` is the single source of truth:

```typescript
// Main graph nodes
const MODEL = {
  counter: 'counter',
  plus100: 'plus100',
  plus300: 'plus300',
  hello: {
    input: 'hello/input',
    name: 'hello/name',
    error: 'hello/validationError',
  },
  derived: {
    isEven: 'counter/isEven',
    label: 'counter/label',
  },
  // ...
};
```

**Characteristics**:

- Immutable from view's perspective (views only read)
- All state changes go through intents
- Derived state computed automatically

### View

Framework-specific rendering that:

- Reads from Model via view model signals
- Renders UI based on current state
- Dispatches Intents on user interaction

```typescript
// View reads model
const vm$ = runtime.graph.createViewModelSignal('view/react', () => ({
  counter: runtime.graph.get<number>(MODEL.counter),
  // ...
}));

// View renders
<div>{vm.counter}</div>

// View dispatches intent
<button onClick={() => runtime.intents.increase(1)}>+1</button>
```

### Intent

Named functions that describe what the user wants to do:

```typescript
runtime.intents = {
  increase: (by = 1) => {
    graph.set<number>(MODEL.counter, (v) => v + by);
  },
  setInput: (text) => {
    graph.set<string>(MODEL.hello.input, text);
  },
  submit: () => {
    graph.batch(() => {
      const err = graph.get<string | null>(MODEL.hello.error);
      if (err) return;
      graph.set<string>(MODEL.hello.name, graph.get<string>(MODEL.hello.input));
    });
  },
  reset: () => {
    graph.batch(() => {
      graph.set<number>(MODEL.counter, 1);
      graph.set<string>(MODEL.hello.input, '');
      graph.set<string>(MODEL.hello.name, 'world');
    });
  },
};
```

**Why Intents?**

| Direct Mutation                    | Intent                  |
| ---------------------------------- | ----------------------- |
| `graph.set('counter', v => v + 1)` | `intents.increase(1)`   |
| Scattered across views             | Centralized in runtime  |
| No semantic meaning                | Named, self-documenting |
| Hard to track                      | Easy to log/debug       |

## Data Flow Examples

### Example 1: Increment Counter

```
1. User clicks "+1" button in Vue panel
   │
   ▼
2. Vue calls intent
   runtime.intents.increase(1)
   │
   ▼
3. Intent modifies model
   graph.set('counter', v => v + 1)
   │
   ▼
4. Model updates propagate
   counter: 1 → 2
   plus100: 101 → 102
   plus300: 301 → 302
   isEven: false → true
   label: 'odd' → 'even'
   │
   ▼
5. Views re-render
   All panels show updated values
```

### Example 2: Form Submission

```
1. User types "alice" in input
   │
   ▼
2. View calls intent
   runtime.intents.setInput('alice')
   │
   ▼
3. Model updates
   hello/input: '' → 'alice'
   │
   ▼
4. Processor validates
   hello/validationError: null (valid)
   │
   ▼
5. User clicks "Submit"
   │
   ▼
6. View calls intent
   runtime.intents.submit()
   │
   ▼
7. Intent checks validation, updates name
   hello/name: 'world' → 'alice'
   │
   ▼
8. Views re-render
   All panels show "Hello, alice!"
```

### Example 3: Cross-Framework via Actor

```
1. User clicks "Ask Vue +3" in React panel
   │
   ▼
2. React sends actor message
   runtime.actorMesh.sendFrom('react', 'vue', { type: 'inc', by: 3 })
   │
   ▼
3. ActorSystem delivers to Vue handler
   │
   ▼
4. Vue handler calls intent
   self.runtime.intents.increase(3)
   │
   ▼
5. Model updates
   counter: 2 → 5
   │
   ▼
6. All views re-render
```

## System Behaviors

Beyond user-triggered intents, the system has automatic behaviors:

```typescript
// Broadcast ping when counter is multiple of 5
watch(
  () => graph.get<number>(MODEL.counter),
  (value, prev) => {
    if (prev !== undefined && value !== prev && value % 5 === 0) {
      runtime.actorMesh.broadcastFrom('system', { type: 'ping' }, { excludeSelf: true });
    }
  },
);

// Auto-increment when name is 'alien'
effect(() => {
  const err = graph.get<string | null>(MODEL.hello.error);
  if (err) return;

  const name = graph.get<string>(MODEL.hello.name);
  if (name === 'alien') {
    graph.set<number>(MODEL.counter, (v) => v + 2);
  }
});
```

These behaviors:

- React to model changes
- Trigger further model updates or actor messages
- Are defined in `wireSystemBehaviors()`

## MVI vs Other Patterns

### MVI vs MVC

| MVC                           | MVI                           |
| ----------------------------- | ----------------------------- |
| Controller handles input      | Intent handles input          |
| Model can be mutated directly | Model only changes via Intent |
| Bidirectional data flow       | Unidirectional data flow      |

### MVI vs Redux

| Redux                       | MVI (this demo)              |
| --------------------------- | ---------------------------- |
| Actions + Reducers          | Intents                      |
| Single store                | DataGraph                    |
| Middleware for side effects | Processors, system behaviors |
| `dispatch(action)`          | `intents.xxx()`              |

### MVI vs MVVM

| MVVM                       | MVI                                     |
| -------------------------- | --------------------------------------- |
| ViewModel exposes commands | Intent functions                        |
| Two-way binding common     | One-way data flow                       |
| ViewModel per view         | Shared Model, per-view ViewModel signal |

## Benefits of MVI

1. **Predictable**: State changes only through intents
2. **Debuggable**: Log intents to see all state changes
3. **Testable**: Test intents in isolation
4. **Traceable**: Follow data flow from intent to view
5. **Framework-agnostic**: Same intents work across all frameworks

## Intent Design Guidelines

### 1. Name by User Intent, Not Implementation

```typescript
// Good: Describes what user wants
intents.submitForm();
intents.toggleDarkMode();
intents.addToCart(productId);

// Bad: Describes implementation
intents.setFormSubmitted(true);
intents.updateTheme('dark');
intents.pushToCartArray(product);
```

### 2. Keep Intents Atomic

```typescript
// Good: Single responsibility
intents.increase(by);
intents.setInput(text);
intents.submit();

// Bad: Multiple responsibilities
intents.increaseAndSubmitIfValid(by);
```

### 3. Use Batch for Multi-Node Updates

```typescript
// Good: Atomic update
submit: () => {
  graph.batch(() => {
    const err = graph.get(MODEL.hello.error);
    if (err) return;
    graph.set(MODEL.hello.name, graph.get(MODEL.hello.input));
  });
};

// Bad: Multiple separate updates
submit: () => {
  const err = graph.get(MODEL.hello.error);
  if (err) return;
  graph.set(MODEL.hello.name, graph.get(MODEL.hello.input));
  // Views might render intermediate state
};
```

### 4. Validate in Model, Not Intent

```typescript
// Good: Processor handles validation
graph.addProcessor('processor/validateInput', ['hello/input'], ['hello/validationError'], (ctx) => {
  const text = ctx.get('hello/input');
  const err = text.length > 12 ? 'Too long' : null;
  ctx.set('hello/validationError', err);
});

// Intent just checks result
submit: () => {
  const err = graph.get(MODEL.hello.error);
  if (err) return; // Validation already done by processor
  // ...
};
```

## Complete Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                           User Interaction                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│  │ Vanilla │  │   Vue   │  │  React  │  │  Solid  │                 │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘                 │
│       │            │            │            │                       │
│       └────────────┴─────┬──────┴────────────┘                       │
│                          │                                           │
│                          ▼                                           │
│                    ┌───────────┐                                     │
│                    │  Intents  │                                     │
│                    │ increase()│                                     │
│                    │ setInput()│                                     │
│                    │ submit()  │                                     │
│                    │ reset()   │                                     │
│                    └─────┬─────┘                                     │
│                          │                                           │
│                          ▼                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                        DataGraph                               │  │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐                    │  │
│  │  │ Signals │───▶│Computed │───▶│Processors│                   │  │
│  │  │ counter │    │ plus100 │    │ validate │                   │  │
│  │  │ input   │    │ plus300 │    │ derive   │                   │  │
│  │  └─────────┘    └─────────┘    └─────────┘                    │  │
│  │                                     │                          │  │
│  │                                     ▼                          │  │
│  │                              ┌───────────┐                     │  │
│  │                              │   Async   │                     │  │
│  │                              │asyncPlus100│                    │  │
│  │                              └───────────┘                     │  │
│  └───────────────────────────────────┬───────────────────────────┘  │
│                                      │                               │
│                          ┌───────────┴───────────┐                  │
│                          ▼                       ▼                  │
│                    ┌───────────┐          ┌───────────┐             │
│                    │ Subgraphs │          │  System   │             │
│                    │ (per-fw)  │          │ Behaviors │             │
│                    └─────┬─────┘          └─────┬─────┘             │
│                          │                      │                    │
│                          │                      ▼                    │
│                          │               ┌───────────┐              │
│                          │               │  Actors   │              │
│                          │               │ (messages)│              │
│                          │               └─────┬─────┘              │
│                          │                     │                     │
│                          └──────────┬──────────┘                    │
│                                     │                                │
│                                     ▼                                │
│                          ┌───────────────────┐                      │
│                          │  View Model ($)   │                      │
│                          │ createViewModelSignal()                  │
│                          └─────────┬─────────┘                      │
│                                    │                                 │
│       ┌────────────────────────────┼────────────────────────────┐   │
│       ▼            ▼               ▼               ▼            │   │
│  ┌─────────┐  ┌─────────┐    ┌─────────┐    ┌─────────┐        │   │
│  │ Vanilla │  │   Vue   │    │  React  │    │  Solid  │        │   │
│  │  View   │  │  View   │    │  View   │    │  View   │        │   │
│  └─────────┘  └─────────┘    └─────────┘    └─────────┘        │   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```
