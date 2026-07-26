# Unified graph — Accepted target

## 目录职责

- **holds**：本目录拥有 Unified DataGraph 已接受方案的稳定目标说明、关键取舍和通往规范性架构文档的入口。
- **excludes**：被否决或被取代方案归入相邻 historical alternative 目录；完整规范性细节归入 `doc/architect/`。
- **tier**：`stable`
- **promotes_from**：track 中经确认的统一图设计、决策和 AttractorCheck 结论。
- **promotes_to**：`doc/architect/` 的 owner 设计，以及对应源码、类型、测试和 demo 投影。

This is the accepted architecture: one `DataGraph` hosts current-value Signals
and event-sequence Streams. `SignalNodeRef<T>` and `StreamNodeRef<T>` make each
output semantic and connection direction explicit. The graph exposes
`graph.get(signalRef)` and `graph.stream(streamRef)`, records typed refs and
edges in one snapshot, and never creates implicit two-way binding. The complete
normative contract lives in [the architecture overview](../../architect/overview.md),
[DataGraph](../../architect/data-graph.md), [state nodes](../../architect/state-nodes.md),
[state operations](../../architect/state-operations.md), and
[stream lifecycle](../../architect/stream-lifecycle.md).

```text
Signal -> Signal state     Signal -> Stream state
Stream -> Signal state     Stream -> Stream state
```

Those are the four supported state-node directions. State nodes expose `getState()`, named typed mutations, and named typed actions; actions use `rt.bizRuntime` for effects and `rt.mutations` for writes. Signal outputs deduplicate with `Object.is`; Stream outputs emit equal transitions and replay the current state to every new subscriber.

Stream sources/operators are lazy, sinks and state nodes are eager. A mixed
feedback cycle must have an explicit feedback, delay, or scheduler boundary. The
single `GraphSnapshot` includes both semantics, node kinds, refs/edges, state,
lifecycle, and boundaries. The demo migration calls node mutation/action
facades rather than a global intent object, and demonstrates equal-value
semantics and event-log projection.
