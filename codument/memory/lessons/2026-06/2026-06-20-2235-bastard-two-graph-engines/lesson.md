# Lesson: bastard 同时跑两套图引擎（@data-graph-mvi/core 旧 vs depa-data-graph-core 新）待统一

> `memory://lessons/bastard-two-graph-engines`
> 来源：track `graph-runtime-reshape-drop-actor`（archive/2026-06/2026-06-20-2235-...，T4.1/T4.2/T5.1 记录）
> 类别：lessons · 时间锚：2026-06-20

## 事实

bastard 的 flow-editor-layout/data-graph 下并存两套图引擎，ctx 形态不同：

- **新引擎** `depa-data-graph-core`（dg core）：`coreGraphDepa.ts` 走它，ctx 已成组为 `ctx.graph.*`（本 track codemod 迁移 65 处回调）。
- **旧引擎** `@data-graph-mvi/core`（内部别名包）：`coreGraph.ts` 走它，ctx **仍是扁平**（`ctx.get/set` 直接挂顶层，65 处）。本 track **未动**它——它不是 dg core 形态，不在 reshape/codemod 范围。

codemod 的文件边界因此以"是否实际 import dg core（depa-data-graph-core）"界定，而非按目录或方法名。

## 教训 / 对未来 track 的影响

- **两套图引擎待统一**：bastard 维持新旧两套并存（coreGraphDepa.ts vs coreGraph.ts），ctx 形态已分叉（成组 vs 扁平）。未来若做"图引擎统一"track，须把 `@data-graph-mvi/core` 旧引擎消费者迁到 dg core 形态（含 `ctx.* → ctx.graph.*`），届时 coreGraph.ts 的 65 处扁平 ctx 才一并收口。
- **codemod 边界判据复用**：跨"新旧引擎并存"代码做形态迁移时，按 import 来源（而非目录/方法名）界定改动文件，避免误伤旧引擎扁平 ctx 或 DataGraph 实例命令式 API。

## 状态

未统一（本 track 非目标）。属跨 track 候选，统一工作应另起 track。
