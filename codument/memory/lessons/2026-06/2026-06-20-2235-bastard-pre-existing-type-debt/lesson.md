# Lesson: bastard 预存类型债会污染 tsc 验收信号，须前/后对照证明零引入

> `memory://lessons/bastard-pre-existing-type-debt`
> 来源：track `graph-runtime-reshape-drop-actor`（archive/2026-06/2026-06-20-2235-...，T5.2 记录）
> 类别：lessons · 时间锚：2026-06-20

## 事实

bastard 在本 track 改造**前**就带大量 tsc 类型错误（预存类型债）。本 track 的 codemod 前/后对照：

- 改造前 tsc 错 = **193**。
- codemod 后 tsc 错 = **125**（修 68、引入 0）。
- 剩余 125 全为**改动外文件**的预存债：`FsCrudDemo` / `pipeline-debug` contract / monaco / fast-crud tests / vendor `actor.ts` 等。

vitest 侧全绿（bastard 16 files / 289 tests），dg core / dg-cell-mvi-core 亦绿。

## 教训 / 对未来 track 的影响

- **预存类型债会污染 tsc 验收**：在带历史类型债的包（如 bastard）里做改造，不能用"tsc 全绿"当验收门——会被改动外的预存错卡死。
- **以前/后对照 + 改动文件 tsc 0 错为验收口径**：本 track 用「codemod 把错从 193→125（修 68、引入 0）」+「改动文件（coreGraphDepa.ts）tsc 0 错」证明零引入。未来在脏基线包里改造，复用此口径：先快照基线错数，验收时证明 (a) 改动文件 0 错、(b) 总错数不增、(c) 测试绿。

## 关联

bastard 预存债的存在与"两套图引擎并存"（见 `memory://lessons/bastard-two-graph-engines`）共同构成 bastard 的清理候选面。
