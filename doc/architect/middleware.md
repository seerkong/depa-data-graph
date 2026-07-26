# Middleware and named-operation hooks

`DataGraph` middleware observes cross-cutting behavior without creating a public state setter. A real `MiddlewareContext` is a context object and remains conventionally named `ctx`; it is distinct from runtime callback `rt`.

```ts
const middleware: GraphMiddleware<AppRuntime> = {
  name: 'audit',
  beforeMutation(operation, ctx: MiddlewareContext<AppRuntime>) {
    ctx.logger.info(operation.name, operation.payload);
  },
  afterAction(operation, ctx: MiddlewareContext<AppRuntime>) {
    ctx.metrics.record(operation.name);
  },
  onDispatch(operation, ctx: MiddlewareContext<AppRuntime>) {
    return operation;
  },
};
```

Middleware may observe named mutations, actions, and dispatch operations for
logging, validation, replay, devtools, and an explicit persistence adapter or
extension. Neither middleware nor that extension makes `AppendOnlyEventLog` or
a state node internally persistent. Middleware can block or transform an
operation only under the declared operation protocol. It cannot inject an
arbitrary next state, expose `node.set`, or bypass a node’s typed mutation
registry.

`dispatch` is the public shared extension point for those named operations; it
accepts only the node's generated, namespaced `operations.mutations.*` or
`operations.actions.*` union and preserves names/payloads for replay and
diagnostics. Facades and direct typed dispatch use this same pipeline.
State-node action factories instead receive `StateNodeActionRuntime` as `rt`,
using `rt.graph`, `rt.getState()`, `rt.mutations`, typed `rt.dispatch`, and
`rt.bizRuntime` according to their role. Reducers and mutation handlers receive
only state and input/payload, never `rt` or `ctx`.
