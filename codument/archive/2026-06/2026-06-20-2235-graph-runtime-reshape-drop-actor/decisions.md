# Decisions

## Usage
- 用于记录需要确认的决策问题、选项、最终结论与理由
- 问题标题不用字母前缀；字母只用于选项
- 后续执行过程中出现的新决策，也继续追加到本文件，不新建分散的决策记录

> 本 track 为非交互创建：以下决策多数已由 mission（refactor-using-depa-tao-fa-shu，2026-06-20 用户拍板）锁定，本 track 沿用并登记。

### 1. 【P0】effect 组命名
- 背景：get/peek/set/batch 成组为 effect 子对象后需定组名。
- 候选：A) `graph`（具体·自解释）  B) `effect`（贴"effect 实现"但抽象）  C) `io`/`ops`
- 最终决策：**A) `graph`**（节点逻辑 `rt.graph.get(x)`）。
- 决策理由：mission 2026-06-20 用户拍板；具体且自解释（"从 graph 取"）。
- 状态：decided

### 2. 【P0】REC-1/5/6 合并粒度
- 背景：三处底座改造可分多次破坏，也可合一次。
- 候选：A) 合为一条 track、一次 breaking + 一个 codemod  B) 拆多次破坏分别发布
- 最终决策：**A**——合一条 track，一次 breaking release + 一个 codemod 一次性迁移全部下游消费者。
- 决策理由：三处都改 dg core 同一文件群；一次发布最省协调、不留半破坏中间态。
- 状态：decided

### 3. 【P0】内层字段命名
- 背景：type 改 GraphRuntime 后内层 `.runtime` 撞名（runtime.runtime），须正名。
- 候选：A) `bizRuntime`（业务可读）  B) 中立名 `env`/`app`/`deps`/`userRuntime`（库中立）
- 最终决策：**A) `bizRuntime`**，并标 `readonly`。
- 决策理由：mission 已锁 `bizRuntime`；表意明确（"你的业务部分"）。中立性取舍由 mission 拍板偏业务可读。
- 状态：decided

### 4. 【P1】是否拆 runtime/graph 为双参
- 背景：候选②严格 `fn(runtime, input, config)`，runtime 提首参、图能力另传。
- 候选：A) 本 track 不做，留 backlog  B) 本 track 一并做
- 最终决策：**A**——非目标，留 backlog。
- 决策理由：高破坏（全仓 `(ctx)=>`）、收益小（底座已合规、上层对 ctx.runtime 零依赖）。
- 状态：decided

### 5. 【P0】DataGraph 实例命令式 API 是否改
- 背景：实例 public `graph.get/set/peek/batch`（外部驱动）与节点 ctx 回调形态相近。
- 候选：A) 不动实例 API，只动节点 ctx 回调  B) 一并 reshape
- 最终决策：**A**——reshape 只动注入节点逻辑的 ctx；实例 API 方法名不变。
- 决策理由：实例 API 是另一套面（命令式外部驱动），非节点 runtime；codemod 须精确区分（如 streamSignalStore.ts:141/158/190/191 不动）。
- 状态：decided

### 6. 【P1】依赖序
- 背景：删 ActorSystem 后需 actor 的消费者改用 depa-actor。
- 最终决策：本 track 排在 **REC-4（track `reuse-depa-processor-component-dispatch`）之后**。
- 决策理由：待 depa-actor 底座稳定再删 dg 自带 actor，消费者迁移有可靠落点。
- 状态：decided
</content>
