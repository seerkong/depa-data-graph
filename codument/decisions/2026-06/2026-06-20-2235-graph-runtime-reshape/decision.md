# Decision: dg core 运行时形态 — GraphRuntime + GraphEffect 成组 + 删自带 ActorSystem

> `decision://graph-runtime-reshape`
> 提升来源：track `graph-runtime-reshape-drop-actor`（archive/2026-06/2026-06-20-2235-graph-runtime-reshape-drop-actor）
> 状态：decided · 拍板日：2026-06-20（mission `refactor-using-depa-tao-fa-shu` 用户拍板，本 track 沿用）
> 破坏性：大 BREAKING（public type 改名 + runtime 形态 reshape + 删 public ActorSystem），需 major bump

承重内容：以下取舍已从"一次性"升为"dg core 以后都按这个来"的长期约束，未来 track 改 dg core runtime / actor / 下游迁移时须遵循。

## 1. dg core 注入节点逻辑的统一运行时形态

最终形态固定为：

```ts
interface GraphRuntime<TBiz> { readonly bizRuntime: TBiz; graph: GraphEffect }
interface GraphEffect { get; peek; set; batch }
```

- type 名 = `GraphRuntime`（取代 `GraphContext`）：它是 DataGraph 实例**统一**的 runtime（makeCtx 无 per-node 切分），非 per-node 切面，故"Context"失真。
- 内层业务依赖字段 = `bizRuntime`（取代内层 `runtime`），且 `readonly`：消除 `graphRuntime.runtime`（runtime.runtime）撞名；表意"你的业务部分"。中立性取舍由 mission 拍板偏业务可读。
- 图状态副作用 `get/peek/set/batch` 成组进 `graph: GraphEffect`：runtime = 纯数据(`bizRuntime`) + effect 契约(`graph`) 两桶；effect 组名 = `graph`（具体·自解释，节点逻辑写法 `rt.graph.get(x)`）。
- 工厂层（typed-graph-v2 ComputedSchema.getter / computed()）以显式 `TRuntime` 泛型参数化 `GraphRuntime`，消除 `<any>`。

行为契约真源见 `behavior://graph-runtime`（codument/behaviors/graph-runtime.xml）。

## 2. DataGraph 实例命令式 public API 不动（边界承重）

`graph.get/peek/set/batch`（DataGraph **实例**自身、外部命令式驱动用）与节点 ctx 回调形态相近，但**是另一套面**。reshape 与任何后续 codemod 只动注入节点逻辑的 ctx 回调，**不改实例 API 方法名**。codemod 须按变量来源/类型精确区分（如 streamSignalStore.ts:141/158/190/191 + coreGraphDepa.ts:487-504 的实例 graph.* 保持不动）。

## 3. 删 dg 自带 ActorSystem，actor 真源归 depa-actor

dg 自带 `ActorSystem` 是 depa-actor 的真子集、零独有项，且生产代码零消费——删除 `packages/core/src/actor.ts` 及 index.ts 导出。需要 actor 的消费者改用 depa-actor。依赖序：本变更排在 REC-4（track `reuse-depa-processor-component-dispatch`）之后，待 depa-actor 底座稳定。

> 落地偏差（记入 archive）：depa-actor 不在本仓 pnpm workspace（workspaces=packages/*+examples/*），无法 workspace:* 解析；demo 按备用方案删除 actor 面（保留 counter/hello/async/subgraph）。"消费者改用 depa-actor"在跨仓接线落地前对本仓 demo 暂以删除替代。

## 4. 合并粒度 + 一次 codemod 协调（承重的迁移协议）

REC-1+5+6 三处底座改造（同改 dg core 同一文件群）合为**一条 track、一次 breaking release + 一个 codemod**，一次性迁移全部 in-repo 下游消费者（dg-cell-mvi-core / bastard / demo），**不留半破坏中间态**。验收要求全栈同时绿（不接受单仓绿）。codemod 一并补 bastard 的 depa-data-graph(-core) 依赖声明（依赖卫生）。

未来再动 dg core public runtime/actor 时复用此协议：dg major 发版与下游迁移同批落地 + 一个 codemod + 全栈绿门。

## 非目标（明确不做，留 backlog）

- 不拆 runtime/graph 为双参（严格 `fn(runtime, input, config)`）：高破坏、收益小，留 backlog。
- 不改图机制行为 / 调度语义（纯结构迁移，零行为变更）。
