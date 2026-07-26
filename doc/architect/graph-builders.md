# Unified graph builders

All construction modes build the same `DataGraph` and the same typed Signal/Stream topology. Builder callbacks receive `rt`, whose graph access is `rt.graph` and whose application capability is `rt.bizRuntime`; they do not receive the retired callback surface.

| Mode                 | Purpose                         | State-node support                                                                     |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| Imperative API       | dynamic composition and plugins | `graph.add*State*Node` returns `StateNodeHandle`; its read-only ref is `handle.output` |
| Code DSL             | typed application topology      | methods declare all four state-node kinds                                              |
| JSON DSL             | serializable topology           | node kind plus registry keys for reducer/mutation/action logic                         |
| Schema-first/codegen | one type source for modules     | derives refs, state facade payloads, and generated consumers                           |

## Imperative API

```ts
const search = graph.addSignalDrivenStateSignalNode({
  input: criteriaRef,
  initial: { page: 1, rows: [] as Row[] },
  reducer: (state) => ({ ...state, page: 1 }),
  mutations: { setPage: (state, page: number) => ({ ...state, page }) },
  actions: (rt) => ({
    async load() {
      const rows = await rt.bizRuntime.api.search(rt.getState());
      rt.mutations.setPage(1);
      return rows;
    },
  }),
});
```

Imperative registration returns `StateNodeHandle`, not an output ref or an
untyped facade. Read through `graph.get(search.output)` or
`graph.stream(search.output)` according to its output semantic. All builders
preserve `handle.mutations`, `handle.actions`, namespaced
`handle.operations.mutations` / `.actions`, and public typed
`handle.dispatch(operation)`; facades construct those operations and use the
same dispatch path.

## Code DSL

```ts
createCodeGraphBuilder(graph)
  .signal(criteriaRef, emptyCriteria)
  .signalDrivenStateSignal(searchRef, {
    input: criteriaRef,
    initial: { page: 1 },
    reducer: (state) => ({ ...state, page: 1 }),
    mutations: { setPage: (state, page: number) => ({ ...state, page }) },
  })
  .signalDrivenStateStream(criteriaTransitionsRef, {
    input: criteriaRef,
    initial: 0,
    reducer: (s) => s + 1,
    mutations: {},
  })
  .streamDrivenStateSignal(currentRef, {
    input: eventRef,
    initial: 0,
    reducer: (s, e) => s + e.value,
    mutations: {},
  })
  .streamDrivenStateStream(timelineRef, {
    input: eventRef,
    initial: [] as Event[],
    reducer: (s, e) => [...s, e],
    mutations: {},
  });
```

Code DSL callbacks and generated action factories use `rt.graph` for graph
effects and `rt.bizRuntime` for application effects. Its reducer is still pure:
`(state, input) => nextState`, never `(rt, state, input)`. Named mutation/action
registry entries remain the only public state-change surface; typed dispatch is
the public lower-level operation surface, never a raw updater.

## JSON DSL and logic registry

JSON describes refs, node kinds, edges, initial state, and registry keys. It may persist mutation/action registry keys, while generated TypeScript exposes typed `.mutations.name(payload)` and `.actions.name(payload)` calls.

```json
{
  "kind": "streamDrivenStateSignal",
  "id": "counter/current",
  "input": "events/counter",
  "initial": 0,
  "reducerKey": "counter/reduce",
  "mutationsKey": "counter/mutations",
  "actionsKey": "counter/actions"
}
```

```ts
const logic = {
  reducers: { 'counter/reduce': (state: number, event: CounterEvent) => state + event.value },
  mutations: { 'counter/mutations': { reset: () => 0 } },
  actions: {
    'counter/actions': (rt: StateNodeActionRuntime<AppRuntime, number, CounterMutations>) => ({
      async sync() {
        await rt.bizRuntime.api.sync();
      },
    }),
  },
};
```

## Schema-first and code generation

Schema-first definitions declare `SignalNodeRef`/`StreamNodeRef`, the four node
kinds, and named mutation/action signatures. Code generation preserves handle,
output-ref, facade, namespaced creator, and typed-dispatch signatures in module
ports, builder calls, JSON registry bindings, and framework-facing facades. It
must not generate a public generic setter or an intent-object API.

When schema actions use application services, bind the runtime type before
declaring nodes so every inline factory gets a typed node-scoped `rt` while its
mutation and action registries remain inferred:

```ts
const stateNodes = createStateNodeSchemaBuilder<AppRuntime>();

const counter = stateNodes.signalDrivenStateStream({
  input: 'counter-input',
  initial: 0,
  reducer: (state, value: number) => state + value,
  mutations: { add: (state: number, by: number) => state + by },
  actions: (rt) => ({ addDefault: () => rt.mutations.add(rt.bizRuntime.defaultStep) }),
});
```

The same builder exposes all four state-node schema methods.
