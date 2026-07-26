# Stream support: accepted Unified DataGraph target

## 目录职责

- **holds**：本目录拥有 Stream 支持方案的稳定导航、已接受目标的入口，以及被取代候选方案的历史索引。
- **excludes**：规范性架构契约归入 `doc/architect/`；运行时实现与验证归入 `packages/`、`examples/`。
- **tier**：`stable`
- **promotes_from**：track 讨论、方案比较、设计决策与已确认的迁移结论。
- **promotes_to**：已接受结论晋升到 `doc/architect/`，历史理由下沉到各候选子目录供决策追溯。

The accepted target is [unified-graph](./unified-graph/) and its normative
[architecture reading map](../architect/index.md): a single `DataGraph`
containing Signal and Stream nodes, explicit typed refs/edges, four state-node
combinations, and one snapshot/lifecycle model. For the complete target
contracts, use [DataGraph](../architect/data-graph.md),
[State Nodes](../architect/state-nodes.md),
[State Operations](../architect/state-operations.md), and
[Stream Lifecycle](../architect/stream-lifecycle.md).

The following documents are retained as superseded historical alternatives, not recommendations or implementation plans:

- [dual-layer](./dual-layer/)
- [stream-as-source](./stream-as-source/)
- [cycle-inspired](./cycle-inspired/)

For the normative architecture, read [the architecture overview](../architect/overview.md) and [state nodes](../architect/state-nodes.md).
