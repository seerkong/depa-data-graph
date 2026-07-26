# Unified DataGraph 与状态节点设计

## 上下文

当前代码同时存在基于 Signal 的 `DataGraph` 与基于 xstream 的 `StreamGraph`。桥接层能完成若干 Signal/Stream 转换，但它把节点身份、边、快照、生命周期和反馈环分散在两个 graph runtime 中。目标不是增加更多桥接，而是让 Signal 与 Stream 成为同一 `DataGraph` 内的两种节点输出语义。

现有 `AppendOnlyEventLog + ReducerProjection` 证明了“从事件流归约为状态”的需求，但它只覆盖 Stream 输入、Signal 风格状态查询这一种业务特例。新底座应把输入类型与输出类型正交组合为四类节点。

## 方案概览

### 1. 唯一图与四方向拓扑

系统只有一个 `DataGraph`：

```text
                              Unified DataGraph

  SignalNodeRef<T> ──▶ SignalDrivenStateSignalNode ──▶ SignalNodeRef<S>
         │
         └────────────▶ SignalDrivenStateStreamNode ──▶ StreamNodeRef<S>

  StreamNodeRef<T> ──▶ StreamDrivenStateSignalNode ──▶ SignalNodeRef<S>
         │
         └────────────▶ StreamDrivenStateStreamNode ──▶ StreamNodeRef<S>

  SignalNodeRef<T> ◀──────────────── explicit nodes/edges ───────────────▶ StreamNodeRef<U>
```

`SignalNodeRef<T>` 与 `StreamNodeRef<T>` 表达输出语义和可连接方向；运行时字符串 ID 可继续作为调试/序列化身份，但长期业务代码优先使用 typed ref。建议读取 API 为：

```ts
graph.get(signalRef);
graph.stream(streamRef);
```

双向能力表示图中可以显式声明两个方向的节点和边，不表示隐式 two-way binding。

### 2. 四类状态节点

| 输入 | 输出 Signal | 输出 Stream |
|---|---|---|
| Signal | `SignalDrivenStateSignalNode` | `SignalDrivenStateStreamNode` |
| Stream | `StreamDrivenStateSignalNode` | `StreamDrivenStateStreamNode` |

共同能力：

```ts
node.getState(): TState;
node.mutations.someMutation(...payload);
node.actions.someAction(...payload);
```

共同约束：

- 具备 `initial` 状态。
- 根据输入和 reducer/transition 更新内部状态。
- 不暴露 `set`。
- mutation/action 成功后的状态是节点唯一事实源。
- 默认 eager，以免无人订阅时丢失输入导致状态与图历史不一致。

`SignalDrivenStateSignalNode` 的典型场景是“配置或选择信号驱动、但需要保留跨输入历史的聚合状态”。例如搜索筛选条件是 Signal，每次条件变化都更新一个带缓存、页码和最近成功结果的状态对象；输出仍是 Signal，供 UI 读取当前快照：

```ts
const searchState = graph.addSignalDrivenStateSignalNode({
  input: searchCriteriaRef,
  initial: { criteria: emptyCriteria, page: 1, cached: [] },
  reducer: (state, criteria) => ({ ...state, criteria, page: 1 }),
  mutations: {
    cacheResults: (state, rows: Row[]) => ({ ...state, cached: rows }),
    goToPage: (state, page: number) => ({ ...state, page }),
  },
  actions: (rt) => ({
    async refresh() {
      const rows = await rt.bizRuntime.api.search(rt.getState().criteria);
      rt.mutations.cacheResults(rows);
    },
  }),
});
```

### 3. Mutation 模型

mutation 定义采用注册表和 typed payload：

```ts
mutations: {
  increment: (state, by: number) => state + by,
  replace: (_state, next: number) => next,
}
```

公共调用由类型系统派生：

```ts
node.mutations.increment(2);
node.mutations.replace(10);
```

规则：

- 同步、确定性、无 effect。
- 函数签名为 `(state, ...payload) => nextState`。
- 业务调用者不输入字符串。
- 不公开任意 `(state) => nextState`，避免绕过可观察、可记录、可扩展的 mutation 名称边界。
- 内部可保留 mutation name 用于日志、中间件、replay 和 devtools，但它不是业务调用 API。

### 4. Action 模型与 `rt`

action 是允许编排异步和业务 effect 的命名入口：

```ts
actions: (rt) => ({
  async load(id: string) {
    rt.mutations.markLoading(true);
    try {
      const count = await rt.bizRuntime.api.loadCount(id);
      rt.mutations.replace(count);
    } finally {
      rt.mutations.markLoading(false);
    }
  },
});
```

规则：

- 公共 DX 为 `node.actions.load(id)`。
- action 可异步、可调用业务 runtime，但只能通过 `rt.mutations` 改写状态。
- action runtime 至少提供 typed `mutations`、`getState()` 和 `bizRuntime`；如需要 dispatch 统一管线，`dispatch` 作为 action/mutation 调度扩展点，而不是第二个裸写状态入口。
- 代表 runtime 的回调参数统一命名为 `rt`。适用范围包括 `GraphRuntime<TBiz>` 节点回调、JSON logic registry、builders、typed graph、测试、文档、demo 和新 action factory。
- `makeCtx()` 应改为 `makeRuntime()`。真正的 `MiddlewareContext` 及其他真实上下文对象仍可命名 `ctx`。

### 5. 输出语义

Signal 输出：

- 状态可通过 `getState()` 同步读取。
- 状态发布遵循 Signal 语义；若 `Object.is(prev, next)` 为 true，不触发新的 Signal 变更传播。

Stream 输出：

- 每次成功的输入 transition 或 mutation transition 都 emit `nextState`，即使 `Object.is(prev, next)` 为 true。
- 新订阅者立即收到当前状态 replay，然后继续接收后续 transition。
- `getState()` 与 replay 的首个值必须一致。

action 若调用多个 mutation，每个成功 mutation 都是独立 transition；若未来支持显式事务/batch，应由独立扩展协议定义，而不是暗中合并。

### 6. 生命周期

默认生命周期：

```text
stream source/operator = lazy
stream sink            = eager
four state nodes       = eager
```

状态节点 eager 的理由是它们承载当前状态事实；即使没有下游订阅者，也必须持续消费已声明输入。dispose 后必须解除输入订阅、停止输出并拒绝或明确处理后续 mutation/action 调用。

### 7. 反馈环与调度

Signal/Stream 混合反馈环默认禁止。验证器必须识别跨语义环：

```text
Signal → Stream → Signal
Stream → Signal → Stream
```

允许反馈时必须出现显式 feedback/delay/scheduler boundary，使时间推进、队列与取消语义可见。单纯存在双向转换能力不构成允许环路。

### 8. Snapshot、edge 与 ref

统一 snapshot 应同时包含 Signal 与 Stream 节点，并至少表达：

- 节点输出语义：`signal | stream`。
- 节点 kind，包括四类状态节点。
- 输入 ref、输出 ref、edge kind 与生命周期状态。
- 状态节点的当前 state（按现有 snapshot/persistence 安全边界处理）。
- Stream 订阅/启动状态，以及显式 feedback boundary。

现有仅针对 `StreamGraphSnapshot` 的信息应合并到统一 `GraphSnapshot`，不再保留第二套 graph snapshot。

### 9. `AppendOnlyEventLog` 迁移

`AppendOnlyEventLog<T>` 保留为有序、可回放的 Stream 事件源。旧写法：

```ts
const state = createReducerProjection(log, {
  initial: 0,
  reducer: (state, entry) => reduceCounter(state, entry.value),
});
```

目标写法使用 `StreamDrivenStateSignalNode`：

```ts
const counterState = graph.addStreamDrivenStateSignalNode({
  input: log.streamRef(),
  initial: 0,
  reducer: (state, entry) => reduceCounter(state, entry.value),
  mutations: {
    reset: () => 0,
  },
});
```

若业务需要 transition 序列而不是只读当前快照，则使用 `StreamDrivenStateStreamNode`。`ReducerProjection` 与 `createReducerProjection` 删除，不提供兼容层。

### 10. 破坏性 API 迁移

删除：

- `StreamGraph`
- `GraphBridge`
- `StreamBridgeManager`
- `subscribeStreamToSignal`
- `signalToStream`
- `ReducerProjection`
- `createReducerProjection`

替代原则：

- Stream 节点直接注册进 `DataGraph`。
- Signal → Stream 与 Stream → Signal 使用显式统一图节点。
- event projection 使用 Stream-driven state node。
- 原桥接清理、debounce/throttle 与生命周期行为迁入统一节点/operator 生命周期测试。

### 11. Builder、codegen 与 demo

- Imperative API、Code DSL、JSON DSL、schema-first typed graph、module identity 与 codegen 都必须能声明/引用新的 Signal/Stream node kind。
- schema-first 场景若 action 需要业务 runtime，先用 `createStateNodeSchemaBuilder<TRuntime>()` 绑定 runtime 类型，再声明四类节点；这样每个 config 仍可独立推断 mutation/action registry，并让 inline action factory 获得 typed `rt`。
- JSON 中可保存 mutation/action registry key，但业务 TS 调用应由生成的 typed facade 暴露 `.mutations.xxx()` / `.actions.xxx()`。
- demo 移除 `runtime.intents`，统一展示节点 mutation/action 调用。
- demo 至少展示四类状态节点、`AppendOnlyEventLog` projection、Stream replay、相同状态仍 emit、Signal 去重、action 访问 `rt.bizRuntime` 与显式 Signal ⇄ Stream。

### 12. `set`、reducer、mutation、action 与 dispatch 的边界

五个概念必须保持不同职责：

| 概念 | 入口 | 命名 | effect | 状态写入 | 公共范围 |
|---|---|---|---|---|---|
| input reducer | 输入边 | 否 | 禁止 | 返回 `nextState` | 节点配置 |
| mutation | `node.mutations.xxx(payload)` | 是 | 禁止 | 返回 `nextState` | 状态节点公共 API |
| action | `node.actions.xxx(payload)` | 是 | 允许 | 只能调用 mutation | 状态节点公共 API |
| dispatch | `node.dispatch(typedOperation)` | 是 | 负责调度/扩展 | 不接受裸 state/updater | 状态节点公共底层 API |
| `graph.set` | 外部 driver | 否 | 禁止 | 直接写普通 Signal | DataGraph 普通 Signal API |

`graph.set` 继续服务于普通可写 Signal Node 和外部 driver；它不得以状态节点的 output ref 为目标。状态节点的事实源是 reducer/mutation transition，若允许 `set`，会绕过命名、payload 类型、middleware、日志、replay 与 devtools，因此状态节点 handle 和 output ref 都不提供直接 set。

input reducer 与 mutation 都是纯 transition，但触发来源不同：reducer 由输入 edge 驱动，mutation 由显式命名操作驱动。action 只做 effect/编排。dispatch 是 typed operation 管线，不是第二套状态写入口。

### 13. Node handle、output ref 与 typed dispatch

四类注册 API 返回一个 node handle，而不是仅返回 output ref：

```ts
interface StateNodeHandle<
  TState,
  TOutputRef extends SignalNodeRef<TState> | StreamNodeRef<TState>,
  TMutations,
  TActions,
  TOperation,
> {
  readonly output: TOutputRef;
  getState(): TState;
  readonly mutations: MutationFacade<TMutations>;
  readonly actions: ActionFacade<TActions>;
  readonly operations: StateNodeOperationCreators<TMutations, TActions>;
  dispatch(operation: TOperation): unknown;
  dispose(): void;
}
```

读取与操作分开：

```ts
graph.get(node.output);       // Signal output
graph.stream(node.output);    // Stream output
node.getState();              // 四类节点都可同步查询当前状态
node.mutations.increment(1);  // typed convenience API
node.actions.load('id');      // typed convenience API
```

`.mutations.xxx()` 与 `.actions.xxx()` 都在内部构造 typed operation 并进入同一个 dispatch 管线。高级集成可显式调用：

```ts
node.dispatch(node.operations.mutations.increment(1));
node.dispatch(node.operations.actions.load('id'));
```

调用者不输入字符串；`dispatch` 只接受由本节点 registry 推导出的封闭 discriminated union，不接受任意对象、next state 或 updater。内部 operation 至少保留 node id、kind、name、typed payload 与调用时序信息，供 middleware/log/replay/devtools 扩展。

### 14. reducer 与 ActionRuntime 的正式签名

input reducer 与 mutation 不接收 runtime：

```ts
type InputReducer<TState, TInput> = (
  state: TState,
  input: TInput,
) => TState;

type MutationRegistry<TState> = Record<
  string,
  (state: TState, ...payload: never[]) => TState
>;
```

JSON/Code DSL 可以用 registry key 定位 reducer/mutation 定义，但不能改变其纯函数签名。只有 action factory 接收专用 runtime：

```ts
interface StateNodeActionRuntime<TState, TBiz, TMutations, TOperation> {
  readonly bizRuntime: TBiz;
  readonly graph: GraphEffect;
  getState(): TState;
  readonly mutations: MutationFacade<TMutations>;
  dispatch(operation: TOperation): unknown;
}
```

它不是第二张图或第二套 runtime；它是 `GraphRuntime<TBiz>` 在当前状态节点上的 typed capability view。代表该 runtime 的形参统一叫 `rt`。现有 `makeCtx()` 改为 `makeRuntime()`；真正的 `MiddlewareContext` 仍使用 `ctx`。

### 15. 初始化、bootstrap、live 与 replay 时序

状态节点生命周期按顺序表达：

```text
initial state → eager activation → input bootstrap → live input → dispose
```

- 创建时先建立 `initial` state 和 output publisher，再以 eager 方式连接输入。
- Signal-driven 节点在 activation 时把输入 Signal 的当前值作为一次 bootstrap input，同步执行 reducer；注册 API 返回后，`getState()` 反映该 bootstrap 结果。
- Stream-driven 节点立即订阅输入。对于同步 replayable source（包括 `AppendOnlyEventLog`），已有历史 entry 在 bootstrap 阶段按原顺序归约；注册 API 返回后，`getState()` 是已消费历史后的当前状态。异步 source 后续值进入 live 阶段。
- Stream-output state node 的订阅者始终先得到“订阅时当前状态”一次 replay；它不会自动重放该状态节点过去的全部 transition。需要完整事件历史时仍订阅原始 `AppendOnlyEventLog`。
- 若尚无输入，Stream-output 新订阅者 replay `initial`；Signal-output 可通过 `graph.get(node.output)` 读取当前状态。
- bootstrap/live 阶段每个成功 transition 都遵循同一发布规则：Signal 用 `Object.is` 去重，Stream 即使同值也 emit。
- `dispose()` 后解除输入、停止输出，并拒绝 mutation/action/dispatch；具体错误类型由实现阶段 type/runtime tests 固化。

mutation 对 event-log projection 是显式的 live state override：后续 event 从 override 后状态继续 reducer。若重新创建节点并从日志 replay，只有写入日志的事实会恢复；需要持久化 reset/correction 时，应把它建模为日志 event，而不是依赖脱离日志的 mutation。

### 16. 完整 Unified DataGraph 节点体系

四类状态节点不是全部节点。权威架构图必须同时表达：

```text
                                      Unified DataGraph

  Signal Source/State ──▶ Computed / Processor / Consumer ──▶ Signal
          │                         │
          │                         ├──▶ SignalDrivenStateSignalNode ──▶ Signal
          │                         └──▶ SignalDrivenStateStreamNode ──▶ Stream
          │
          └── explicit Signal→Stream node/operator ───────────────────▶ Stream

  Stream Source ──▶ Stream Operator ──▶ Stream Sink
          │                  │
          │                  ├──▶ StreamDrivenStateSignalNode ────────▶ Signal
          │                  └──▶ StreamDrivenStateStreamNode ────────▶ Stream
          │
          └── explicit Stream→Signal node/projection ─────────────────▶ Signal

  Any mixed cycle ──▶ explicit feedback / delay / scheduler boundary required
```

Signal 与 Stream 是输出语义，source/operator/sink/computed/state 是 node kind/role；它们共享 DataGraph 注册表、typed identity、edge、validation、lifecycle 和 snapshot。

### 17. Node naming rationale

名称采用四段语义组合：

```text
<SignalDriven | StreamDriven> + <State> + <Signal | Stream> + Node
```

- `SignalDriven` / `StreamDriven` 明确主要输入语义，解决只叫 `StatefulSignalNode`/`StatefulStreamNode` 无法判断输入的问题。
- `StateSignal` / `StateStream` 明确输出语义，而不是输入语义。
- 使用 `Node` 而不是 `Operator`，因为四者都是注册进 DataGraph、拥有 identity/edge/lifecycle/snapshot/state 的一等节点；其中 Signal-output 节点也不应被误称为 Stream operator。
- 名称虽然较长，但在类型、codegen、snapshot 和文档中无歧义；业务代码通过 typed handle/ref 使用，不需要频繁手写 kind 字符串。

### 18. Snapshot、edge、feedback 与迁移制品

实现阶段必须把下列目标形状固化为公开类型与测试，而不是只保留 prose：

```ts
type GraphOutputSemantic = 'signal' | 'stream';

interface UnifiedGraphNodeSnapshot {
  id: string;
  kind: NodeKind;
  output: GraphOutputSemantic;
  lifecycle: 'inactive' | 'active' | 'disposed';
  state?: unknown;
  subscriberCount?: number;
}

interface UnifiedGraphEdge {
  from: SignalNodeRef<unknown> | StreamNodeRef<unknown>;
  to: GraphNodeRef<unknown>;
  kind: GraphEdgeKind;
  boundary?: 'feedback' | 'delay' | 'scheduler';
}
```

精确字段名可以在 P1 type tests 中收敛，但不得丢失 output semantic、node kind、typed endpoints、lifecycle、eligible state、Stream activation/subscriber information 与 explicit boundary。

mixed cycle 默认验证失败。合法环必须包含显式 boundary node/edge；boundary 至少声明调度时机、队列策略、取消/dispose 行为。首版不隐式推断 boundary，也不把“存在双向节点”当作合法环。

breaking migration 文档必须提供逐 API 映射，并说明 bridge 的 cleanup/debounce/throttle/error 等行为迁往统一 operator/lifecycle 测试。demo 文档必须给出 `runtime.intents.increase/setInput/submit/reset` 到具体 node mutation/action 的映射，以及四类节点、同值 emit、replay、event-log projection 和 `rt.bizRuntime` action 的可观察场景。

## 决策摘要

关键结论已由用户确认，并记录在 `decisions.xnl`：

- 单一 `DataGraph`，不拆 SignalGraph/StreamGraph。
- 四类状态节点全部实现。
- 状态节点不暴露 `set`，但暴露 typed mutations/actions 和只读状态查询。
- Stream 输出同值仍 emit 并 replay 当前状态；Signal 输出保持去重。
- 状态节点 eager；混合反馈环默认禁止，必须显式 boundary。
- 旧双图、桥接与 ReducerProjection API 直接删除。
- 先完成 `doc/` 权威设计并经过人工确认，再实现代码。

## 风险 / 权衡

- **公共 API 面较大**：四类节点、ref、snapshot、builder/codegen 同时变化。缓解：分 phase 建立 characterization/type tests，最后做全局残留扫描与 GapLoop。
- **eager 状态节点资源占用**：无人订阅时仍消费输入。缓解：明确 dispose 与图生命周期，避免隐式常驻泄漏。
- **Stream 同值 emit 与 Signal 去重不同**：用户可能误以为统一图等于统一发布语义。缓解：类型、文档与测试都显式区分 output semantics。
- **action 并发竞态**：多个异步 action 可能交错 mutation。缓解：首版保持显式调用顺序，记录 dispatch 扩展点；需要取消/序列化时通过 middleware/scheduler 扩展，不暗含策略。
- **混合反馈环**：跨 Signal/Stream 的时间语义可能制造同步递归或异步无限循环。缓解：默认拒绝，显式 boundary 才允许。

## 迁移计划

1. P0：重写 `doc/` 为目标态，标记旧方案为历史替代，人工确认。
2. P1：统一图的 node/ref/edge/snapshot/lifecycle 基础与反馈环验证。
3. P2：四类状态节点、typed mutation/action/dispatch 扩展点。
4. P3：删除旧双图/桥接/ReducerProjection，迁移 AppendOnlyEventLog 与全局 `ctx → rt`。
5. P4：builder/codegen/typed graph/demo/README/changelog 同步。
6. P5：全仓验证、残留扫描、独立 verify 与最终 GapLoop。

回滚以 phase 为单位由手动提交管理；不在发布产物中保留双图兼容层。

## 待解决问题

- typed ref 和 builder 的精确泛型形态在实现阶段以 type tests 收敛，但不得改变本设计的四方向、单图和公共 DX。
- action 并发控制、事务 mutation 与 devtools 协议作为扩展点设计，本 track 只要求当前 API 可扩展且不引入第二个裸写状态通道。
