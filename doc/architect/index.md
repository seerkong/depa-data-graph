# Architecture — Unified DataGraph

## 目录职责

- **holds**：本目录拥有 Unified DataGraph 的稳定、规范性架构设计，包括拓扑、状态节点、生命周期、构建层和消费边界。
- **excludes**：候选方案与被否决方案的历史说明归入 `doc/support-stream/`；具体实现与测试归入 `packages/`、`examples/`。
- **tier**：`stable`
- **promotes_from**：已批准 track 的 proposal、design、decisions 与通过 AttractorCheck 的稳定结论。
- **promotes_to**：运行时代码、类型/API、测试、demo 与对外使用文档的实现投影。

## Accepted target: Unified DataGraph

`DataGraph` is the only graph runtime. It contains both current-value Signal nodes and event-sequence Stream nodes; it does not delegate either kind to a second graph. Start with [the overview](./overview.md), then use [state nodes](./state-nodes.md), [DataGraph topology](./data-graph.md), and [stream lifecycle](./stream-lifecycle.md).

The retired core `ActorSystem` is not part of the current architecture; see [Actor System](./actor-system.md) for the migration boundary.

## Reading map

- [Overview](./overview.md): system map, governing boundaries, and topic routing.
- [Unified DataGraph](./data-graph.md): complete node topology, typed refs and
  edges, snapshot target, explicit conversions, and feedback validation.
- [State Nodes](./state-nodes.md): handle/config/runtime contracts, selection
  rules, and examples for all four input/output combinations.
- [State Operations](./state-operations.md): `set`, reducers, mutations, actions,
  typed dispatch, middleware, replay, return, and error boundaries.
- [Stream Lifecycle](./stream-lifecycle.md): activation, synchronous bootstrap,
  current-only replay, live ordering, event-source/history ownership, and disposal.
- [Unified State Migration](./migration-unified-state.md): legacy API mapping,
  event-log split, bridge cleanup, runtime renames, and demo intent migration.
- [Graph Builders](./graph-builders.md): imperative, Code DSL, JSON,
  schema-first, and codegen requirements.
- [Typed Graph](./typed-graph.md), [Module Identity](./module-identity.md), and
  [Subgraphs](./subgraphs.md): typed consumption and composition.
- [Middleware](./middleware.md), [MVI Flow](./mvi-flow.md), and
  [Framework Adapters](./framework-adapters.md): operation and UI integration.
