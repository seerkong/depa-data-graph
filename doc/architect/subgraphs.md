# Subgraphs and module composition

Subgraphs are explicit graph modules, not isolated hidden runtimes synchronized by effects. A parent wires public `SignalNodeRef` and `StreamNodeRef` ports to a mounted module through declared edges; the unified snapshot and validation can therefore inspect the complete topology.

```ts
const child = mountGraph(CounterModule, { scope: 'view/vue' });

graph.connect({ from: parentRefs.counter, to: child.inputs.counter });
graph.connect({ from: parentRefs.events, to: child.inputs.events });

graph.get(child.outputs.summary);
graph.stream(child.outputs.timeline);
```

Use a subgraph when ownership and lifecycle should be scoped, not to recreate a
second graph abstraction. A child state node exports a `StateNodeHandle`: its
read-only `.output`, typed `.mutations` / `.actions`, namespaced operation
creators, and public typed `.dispatch` all remain available through the module
API. Action callbacks receive `StateNodeActionRuntime` as `rt` and use
`rt.graph` and `rt.bizRuntime`; reducers/mutations stay pure. Dataflow remains
explicit Signal/Stream edges. Mixed feedback across a module boundary follows
the same explicit feedback/delay/scheduler boundary rule as any other edge.
