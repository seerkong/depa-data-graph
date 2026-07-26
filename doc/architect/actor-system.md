# Actor System — superseded

The former core `ActorSystem` has been removed and is not part of the current architecture. `packages/core` no longer provides an actor mesh, actor refs, actor mailboxes, or `runtime.intents` as a coordination surface.

Use a unified `DataGraph` with explicit Signal/Stream nodes instead. Model named
state changes through a `StateNodeHandle`'s typed `.mutations` and effectful
orchestration through `.actions`; actions receive `StateNodeActionRuntime` as
`rt` and modify state only through `rt.mutations` or typed `rt.dispatch`.

This page is retained solely to prevent new designs from depending on the retired API.
