## 上下文

dg core 三处底座（REC-1 删 ActorSystem / REC-5 改名 GraphRuntime / REC-6 effect 成组）合并为一次破坏性变更 + 一个 codemod，一次性迁移全部 in-repo 下游消费者。约束：大 BREAKING（需 major bump）；不留半破坏中间态（codemod 后全栈 build + 测试绿）；纯结构迁移、零图机制行为变更。下游消费者跨两仓：dg 自带 examples/demo + eidolon-workbench/frontend（dg-cell-mvi-* 7 包 + bastard）。证据见 proposal「实测证据」段。

## 方案概览

1. **基线 phase**：锁定改造前事实快照与全栈基线绿（dg core + 下游）。
  - 复核改造前计数（GraphContext=33/5 文件、ctx.* dg=41 + 上层=131、ActorSystem 生产消费=0），作为 codemod 完工对照。
  - 跑 dg core + dg-cell-mvi + bastard + demo build/test，确认改造前已绿（避免把既有红当成本 track 引入）。
2. **REC-1 删 ActorSystem**（dg core）。
  - 删 `packages/core/src/actor.ts`；从 `index.ts:46-55` 移除 `ActorSystem` + actor 类型导出。
  - test（`actor.test.ts`）与 demo 用法改用 depa-actor（依赖 REC-4 底座已稳）。
3. **REC-5 改名 GraphRuntime / bizRuntime**（dg core）。
  - type `GraphContext → GraphRuntime`（`graph.ts:58-70`，33 处机械改名）。
  - 内层 `runtime → bizRuntime`，标 `readonly`；`makeCtx`（`graph.ts:917-925`）相应改字段名。
  - 工厂层 `typed-graph-v2.ts:13,25` `GraphContext<any> → GraphRuntime<TRuntime>` 补泛型去 `any`。
  - index.ts 导出名同步（`index.ts:12`）。
4. **REC-6 effect 成组 graph**（dg core）。
  - 定义 `interface GraphEffect { get; peek; set; batch }`。
  - reshape `GraphRuntime<TBiz> = { readonly bizRuntime: TBiz; graph: GraphEffect }`。
  - `makeCtx` 把 get/peek/set/batch 收进 `graph` 子对象；dg 内 41 处 `ctx.* → ctx.graph.*`（graph-builders.ts 等）。
5. **codemod 全消费者**（跨仓）。
  - 编写 codemod（AST 级，jscodeshift/ts-morph 实现期定）：仅改注入节点逻辑的 ctx 回调 `ctx.get/peek/set/batch → ctx.graph.*`；**不动** DataGraph 实例命令式 `graph.*`（区分依据见风险段）。
  - 跑 codemod：dg-cell-mvi-core（streamSignalStore.ts:92）+ bastard（coreGraphDepa.ts 65 处 + coreGraph.ts）+ demo。
  - bastard 补 `package.json` 对 depa-data-graph(-core) 的显式依赖声明。
6. **验收全栈绿**。
  - 残留扫描：GraphContext=0、ctx.get/peek/set/batch(回调)=0、工厂层 `<any>`=0、ActorSystem 导出=0。
  - 全栈 build + test：dg core + dg-cell-mvi + bastard + demo 全绿。

## 影响范围与修改点（Impact）

- dg core：`graph.ts`、`index.ts`、`typed-graph-v2.ts`、`graph-builders.ts`、`actor.ts`(删)、`test/actor.test.ts`、`examples/demo/**`。
- 下游：`dg-cell-mvi-core/src/streamSignalStore.ts`、`bastard/.../coreGraphDepa.ts`、`bastard/.../coreGraph.ts`、`bastard/package.json`。

## 决策摘要

- 详见 `decisions.md`。
- 关键结论：① effect 组名 = `graph`（mission 2026-06-20 拍板）；② REC-1+5+6 合一条 track、一次 breaking + 一个 codemod（不拆多次破坏）；③ 内层字段 = `bizRuntime`（readonly）；④ 不拆双参（backlog）；⑤ 不动 DataGraph 实例命令式 API。

## 风险 / 权衡

- **codemod 误伤实例 API**（最大风险）：`ctx.get`（回调，改）vs `graph.get`（DataGraph 实例，不改）形态相近。
  → 缓解：codemod 按变量来源/类型判定——只改形参为节点回调 ctx（`addComputed/addProcessor/addAsync/addConsumer` 等回调参数，或类型为 GraphRuntime）的成员访问；对 DataGraph 实例变量的 `.get/.set` 保持不动。对每个改动文件 build + test 复核（如 streamSignalStore.ts:141/:158/:190/:191 须保持 graph.*）。
- **跨仓协调 / 半破坏**：dg major 发版与下游迁移须同批落地。
  → 缓解：codemod 一次跑全消费者；验收 phase 要求全栈同时绿，不接受单仓绿。
- **bastard 依赖卫生**：未声明依赖，若漏补会在 CI/构建隔离环境暴雷。
  → 缓解：codemod 步骤显式包含补 package.json 依赖声明，并以 bastard build 绿验证。
- **DX 冗余**：每处访问 +`.graph`。
  → 缓解：回调内可 `const { get, set } = rt.graph` 解构保持简洁（用法非平行 API，DEPA 仍单一形态）。

## 迁移计划

1. 在 REC-4（`reuse-depa-processor-component-dispatch`）稳定后启动本 track。
2. 按 phase 序 P0 基线 → P1 删 ActorSystem → P2 改名 → P3 成组 → P4 codemod → P5 验收。
3. 回滚：本 track 为单次 major；回滚 = revert dg core 改动 + 反向 codemod（保留 codemod 脚本以便反向）。

## 兼容性设计

- 大 BREAKING，需 major bump。in-repo 消费者随同 codemod 一次迁移。
- npm 外缘下游（本生态外）须按 CHANGELOG 自行迁移（`GraphContext→GraphRuntime`、`ctx.*→ctx.graph.*`、`runtime→bizRuntime`、改用 depa-actor）。

## 待解决问题

- codemod 工具选型（jscodeshift vs ts-morph）——实现期定，本 track 只规定语义与边界。
</content>
