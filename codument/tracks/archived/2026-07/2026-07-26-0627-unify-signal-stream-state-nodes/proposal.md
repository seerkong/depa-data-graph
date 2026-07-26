# 变更：统一 Signal / Stream 图并新增四类状态节点

## 背景和动机 (Context And Why)

项目的设计初衷是用同一张数据图统一 Signal 与 Stream，但当前实现仍把二者拆成 `DataGraph` 与 `StreamGraph`，再依赖 `GraphBridge`、`StreamBridgeManager`、`subscribeStreamToSignal`、`signalToStream` 等桥接 API 连接。这使跨语义拓扑、生命周期、快照、节点身份与反馈环策略分散在两套模型中。

同时，现有 `AppendOnlyEventLog + createReducerProjection` 已具备“初始状态 + 消费事件 + reducer 更新状态”的业务特例，但缺少可复用的一等状态节点抽象，也不能同时表达以下四种方向：Signal 输入或 Stream 输入，状态以 Signal 或 Stream 输出。

本变更将上述能力收敛进唯一的 `DataGraph`，新增四类一等状态节点，并以类型化 mutations/actions 作为状态更新入口。由于这是项目设计理念与公共 API 的整体重构，必须先把目标设计完整写入 `doc/`，经人工确认后再修改运行时代码。

## “要做”和“不做” (Goals / Non-Goals)

**目标：**

- 建立唯一的 Unified `DataGraph`，显式支持 `Signal → Signal`、`Signal → Stream`、`Stream → Signal`、`Stream → Stream`。
- 新增 `SignalDrivenStateSignalNode`、`SignalDrivenStateStreamNode`、`StreamDrivenStateSignalNode`、`StreamDrivenStateStreamNode`。
- 四类状态节点都提供只读 `getState()`、类型化 `node.mutations.xxx(...)` 与 `node.actions.xxx(...)`，不暴露 `set`。
- mutation 使用注册表 + typed payload，保持同步、确定性、无副作用；action 可异步并通过 `rt.mutations` 更新状态。
- 将所有代表节点/图 runtime 的回调参数统一命名为 `rt`，同时保留真正上下文对象（如 `MiddlewareContext`）的 `ctx` 命名。
- 明确输出去重、Stream replay、生命周期、混合反馈环、ref/edge/snapshot 与拓扑访问语义。
- 破坏性移除双图与桥接 API，并把 `AppendOnlyEventLog + ReducerProjection` 迁移到新状态节点底座。
- 更新 builder、typed graph、JSON/codegen、demo、README、架构文档和测试，使公共表面一致。

**非目标：**

- 不创建独立的 `StreamGraph` 替代品；Signal 与 Stream 不能拆为两张图。
- 不提供任意 `(state) => nextState` 的公共 mutation API。
- 不给四类状态节点暴露 `set`，也不把 action 变成绕过 mutation 的第二套写状态通道。
- 不提供隐式双向绑定；Signal ⇄ Stream 必须由显式节点和边构成。
- 不允许默认形成无边界的 Signal/Stream 混合反馈环。

## 变更内容（What Changes）

- 新增统一拓扑与 typed `SignalNodeRef<T>` / `StreamNodeRef<T>` 方向语义，所有节点注册在同一 `DataGraph`。
- 新增四类状态节点及其状态查询、typed mutations、typed actions 和 eager 生命周期。
- Signal 输出继续遵循 Signal 的 `Object.is` 去重；Stream 输出在每次成功输入/mutation transition 后都 emit，即使 `Object.is(prev, next)` 为 true，并向新订阅者立即 replay 当前状态。
- stream source/operator 默认 lazy，stream sink 默认 eager，四类状态节点默认 eager。
- action factory 使用 `(rt) => ({ ... })`；`rt` 包含 `mutations`、状态读取与 `bizRuntime`，action 只能通过 mutations 改状态。
- **BREAKING**：删除 `StreamGraph`、`GraphBridge`、`StreamBridgeManager`、`subscribeStreamToSignal`、`signalToStream`、`ReducerProjection`、`createReducerProjection`。
- **BREAKING**：现有 GraphRuntime 回调、JSON registry、builder、typed graph、测试、文档与 demo 中代表 runtime 的参数从 `ctx` 改为 `rt`；真正的 `MiddlewareContext` 仍使用 `ctx`。
- `AppendOnlyEventLog` 保留为可回放事件源，但 projection 由 `StreamDrivenStateSignalNode` 或 `StreamDrivenStateStreamNode` 表达。
- demo 中 `runtime.intents`、`increase` 等手写入口迁移为节点的 `mutations` / `actions`，并展示四类节点、日志 replay 与 Signal ⇄ Stream。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`unified-data-graph`。
- 受影响的核心代码：`packages/core/src/graph.ts`、`packages/core/src/stream.ts`、`packages/core/src/index.ts`、builders、typed graph、module identity、middleware/snapshot/validation 相关实现与测试。
- 受影响的生成与适配层：`packages/graph-codegen`、React/Vue/Solid/Vanilla adapters。
- 受影响的示例与文档：`examples/demo/**`、`README.md`、`README-CN.md`、`doc/architect/**`、`doc/support-stream/**`、各包 changelog。
- 兼容性：公共 API 大幅破坏性迁移，旧双图/桥接/ReducerProjection API 不保留兼容层。

## 验收（Conformance）

- 权威文档先完整描述目标态并通过人工确认，确认前核心运行时代码零改动。
- 单一 `DataGraph` 能注册、快照、验证并运行 Signal/Stream 四方向拓扑。
- 四类状态节点的类型、运行时、发射、replay、生命周期与 mutation/action 行为均有测试覆盖。
- 删除旧 API 后源码、导出、测试、demo 和文档无残留引用。
- `AppendOnlyEventLog` 的 projection 用新节点 API 实现并覆盖 replay/实时事件场景。
- 全仓 test、typecheck、lint、build 与 Codument strict validate 通过，最终 GapLoop 返回 `NO_GAP`。
