# 变更：dg 运行时重塑 — 删自带 ActorSystem + GraphContext→GraphRuntime + effect 成组（一次 breaking + 一个 codemod）

## 背景和动机 (Context And Why)

本 track 把 depa-data-graph（dg）core 的三处底座问题收敛为**一次破坏性变更 + 一个 codemod**，一次性迁移全部 in-repo 下游消费者：

1. **REC-1（删自带 ActorSystem）**：dg 自带 `ActorSystem` 是 depa-actor 的真子集、零独有项，且 dg 生产代码对它**零消费**——保留它只是孤岛 + 与 depa-actor 重复。actor 真源应归 depa-actor。
2. **REC-5（改名 GraphContext→GraphRuntime）**：`GraphContext` 实为 DataGraph 实例**统一的 runtime**（makeCtx 无 per-node 切分），"Context"命名失真；内层 `.runtime` 与外层 runtime 撞名。
3. **REC-6（effect 成组）**：`get/peek/set/batch` 是对图状态的**副作用操作**，扁平挂 runtime 顶层逼近"runtime 容器放逻辑"红线；成组为 `graph: GraphEffect` 契约后，runtime = 纯数据(`bizRuntime`) + effect(`graph`) 两桶，DEPA 更干净。

三处都改 dg core 同一文件群（`graph.ts` / `index.ts` / `typed-graph-v2.ts` / `graph-builders.ts`），合并一次发布最省协调成本，且用一个 codemod 一次性迁移所有消费者、保证迁移后全栈绿、不留半破坏中间态。

### 实测证据（2026-06-20 仓内复核，path:line）

> 复核仓：depa-data-graph（dg core）+ /Users/kongweixian/ai/eidolon/eidolon-workbench/frontend（下游消费者）。

**REC-1 — ActorSystem 零生产消费**
- 定义：`packages/core/src/actor.ts:53`（`export class ActorSystem<TRuntime, TMessage>`，全文件 182 行）。
- 再导出：`packages/core/src/index.ts:46`（`export { ActorSystem } from './actor';`）+ actor 类型再导出 `index.ts:47-55`。
- `grep -rn "ActorSystem" packages/*/src/` 仅 2 命中 = `actor.ts:53`（定义自身）+ `index.ts:46`（再导出自身）；`packages/*/src` 无其他消费者。
- 非生产命中（保留参考，随 codemod 处理）：`packages/core/test/actor.test.ts`、`examples/demo/src/app/runtime.ts`、`dist/`（构建产物）。
- dg core 包名（实测）：`depa-data-graph-core`（`packages/core/package.json:2`）。

**REC-5 — GraphContext 定义与改名阻力面**
- `GraphContext` 定义：`packages/core/src/graph.ts:58-70`（`runtime: TRuntime` + get/peek/set/batch 重载）。
- `makeCtx()`：`packages/core/src/graph.ts:917-925`（无 per-node 参数 → 统一 runtime，证明它不是 per-node 切面，`GraphRuntime` 比 `GraphContext` 准确）。
- public 导出：`packages/core/src/index.ts:12`（`GraphContext`）。
- `GraphContext` 总命中 dg 内 = **33 处 / 5 文件**：`graph.ts`、`graph-builders.ts`、`typed-graph-v2.ts`、`index.ts`、`examples/demo/src/app/graph/main-graph.logic.ts`。上层 frontend 引用该 type 名 = 0（回调靠类型推断）。
- 工厂层 `GraphContext<any>`：`packages/core/src/typed-graph-v2.ts:13` 与 `:25`。
- 命名巧合（不冲突）：`makeMiddlewareCtx`（`graph.ts:928`）返回 `{ graph: this, runtime }`——那个 `graph` 是 MiddlewareContext 的 DataGraph 实例引用，与本 track 节点 ctx 的 effect 组 `graph` 是不同对象、不同上下文。

**REC-6 — ctx.get/set 调用点计数（codemod 面）**
- dg 内 `ctx.get/peek/set/batch` = **41 处**（src+examples+test，excl dist；生产 src 命中在 `graph-builders.ts:107/:110/:120`）。
- 上层 `frontend/packages` `ctx.get/peek/set/batch` = **131 处**：
  - `dg-cell-mvi-core/src/streamSignalStore.ts:92`（回调内 `ctx.get`，在范围）。
  - `bastard/.../coreGraphDepa.ts` = **65 处**（重度 ctx.set / ctx.get，在范围）+ `bastard/.../coreGraph.ts`（在范围）。
- 合计 ≈ **~172 调用点**。

**codemod 精确边界（关键区分，实证）**
- **在范围（改）**：注入节点逻辑的 ctx 回调里的 `ctx.get/peek/set/batch` → `ctx.graph.*`。例 `streamSignalStore.ts:92` `(ctx) => ctx.get<S>(STATE_ID)`。
- **不在范围（不动）**：DataGraph **实例**自身命令式 public API `graph.get/set/peek`。实证 `streamSignalStore.ts:141`（`graph.peek`）、`:158`（`graph.set`）、`:190/:191`（`graph.get`）。

**bastard 未声明依赖（依赖卫生）**
- bastard 源码直接 import dg core：`bastard/src/flow-editor-layout/data-graph/coreGraphDepa.ts:14`（`import { DataGraph, createCodeGraphBuilder } from 'depa-data-graph-core';`）。
- `bastard/package.json` **无** `depa-data-graph` / `depa-data-graph-core` 依赖声明（`grep -nE "depa-data-graph|data-graph" package.json` 命中 0）→ 未声明依赖确证。codemod 时一并补声明。
- 备注：bastard 同时从内部别名包 `@data-graph-mvi/core` import（coreGraph.ts:1 等）；codemod 以"实际 import 了 dg core 公共 ctx 形态"界定改动文件。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**
- 删除 dg 自带 `ActorSystem`（`packages/core/src/actor.ts` + `index.ts:46-55` 导出）。
- 改名 `GraphContext → GraphRuntime`（`graph.ts:58-70`），内层 `.runtime → bizRuntime` 且标 `readonly`，工厂层（`typed-graph-v2.ts:13,25`）补 `TRuntime` 泛型消除 `<any>`。
- effect 成组：`get/peek/set/batch → graph: GraphEffect`（`GraphEffect = { get; peek; set; batch }`）；最终形态 `GraphRuntime<TBiz> = { readonly bizRuntime: TBiz; graph: GraphEffect }`，节点逻辑 `rt.graph.get(x)` / `rt.bizRuntime.svc`。effect 组名 = **`graph`**（已拍板 2026-06-20）。
- 提供一个 codemod，一次性迁移全部下游消费者 ctx 回调 `ctx.* → ctx.graph.*`（~172 点），含 dg-cell-mvi-core、bastard、demo；并为 bastard 补 depa-data-graph 依赖声明。
- 迁移后 dg core + dg-cell-mvi + bastard + demo 全部 build + 测试绿。

**非目标:**
- **不**拆 runtime/graph 为双参（候选②：严格 `fn(runtime, input, config)`），留 backlog。
- **不**改图机制行为 / 调度语义（纯结构迁移，零行为变更）。
- **不**改 DataGraph 实例自身命令式 public API（`graph.get/set/peek/batch`）的方法名——reshape 只动注入节点逻辑的 ctx。

## 变更内容（What Changes）

- **BREAKING**：删除 public `ActorSystem` 导出 + `actor.ts`（actor 真源归 depa-actor）。
- **BREAKING**：public type `GraphContext → GraphRuntime` 改名。
- **BREAKING**：runtime 形态 reshape——内层 `.runtime → bizRuntime`（readonly）；`get/peek/set/batch` 成组进 `graph: GraphEffect`。
- 工厂层 `typed-graph-v2.ts` 补 `TRuntime` 泛型，去 `<any>`。
- 新增/运行一个 codemod，一次性迁移所有 in-repo 消费者（dg 内 + dg-cell-mvi-core + bastard + demo）的 ctx 回调到 `ctx.graph.*`，并补 bastard 依赖声明。
- 需要 actor 的消费者（demo）改用 depa-actor。

## 影响范围（Impact）

- **受影响的能力（behaviors）**：`graph-runtime`（本 track 新建 capability：runtime-naming / biz-runtime-field / factory-generic / effect-grouping / instance-api-unchanged / drop-actor-system / downstream-codemod）。
- **受影响的代码（dg core）**：`packages/core/src/graph.ts`、`packages/core/src/index.ts`、`packages/core/src/typed-graph-v2.ts`、`packages/core/src/graph-builders.ts`、`packages/core/src/actor.ts`（删）、`packages/core/test/actor.test.ts`、`examples/demo/**`。
- **受影响的代码（下游，eidolon-workbench/frontend）**：`packages/dg-cell-mvi-core/src/streamSignalStore.ts`、`packages/bastard/src/flow-editor-layout/data-graph/coreGraphDepa.ts`、`coreGraph.ts`、`packages/bastard/package.json`（补依赖）；@dg-cell-mvi 其余包多经 @dg-cell-mvi/core 间接，需随版本 build 复核。
- **依赖序**：排在 **REC-4（depa-actor 复用 processor，track `reuse-depa-processor-component-dispatch`）之后**——删 ActorSystem 后需 actor 的消费者改用 depa-actor，应待 depa-actor 底座稳定。reshape（REC-5/6）本身独立，但合并为一条 track 统一发布。
- **破坏性等级**：大 BREAKING（public type 改名 + runtime 形态 reshape + 删 public ActorSystem），需 major bump；用一个 codemod 一次性迁移所有 in-repo 消费者保证迁移后全绿。

## 验收（Conformance）

- `GraphContext` 0 残留、`GraphRuntime` 全替；index.ts 导出 `GraphRuntime` 不再导出 `GraphContext`。
- `graphRuntime.bizRuntime` 撞名消除且 `readonly`。
- `ctx.get/peek/set/batch` 0 残留、全替为 `ctx.graph.*`（仅节点 ctx 回调；DataGraph 实例 API 不动）。
- 工厂层无 `<any>`。
- `actor.ts` 移除、`index.ts` 无 ActorSystem 及 actor 类型导出。
- codemod 后 dg core + dg-cell-mvi + bastard + demo 全部 build + 测试绿。
- bastard 补齐 depa-data-graph(-core) 依赖声明。
</content>
