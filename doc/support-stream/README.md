# Stream Support for DataGraph - Design Plans

本目录包含为 DataGraph 添加流式处理支持的多种设计方案。

## 背景

在当前大语言模型 AI 应用开发井喷的状态下，前端应用开发中流式处理变得越来越重要。后端已经使用 xstream 实现了面向数据流 pipeline 的编程模式（参见 minimal-modular-ai-agent 项目）。

现在需要在前端也利用这种思想，实现面向数据的流式处理编程，让数据+核心逻辑与具体的前端框架解耦。

## 核心问题

**Signal vs Stream 的本质区别：**

| 特性     | Signal (当前 DataGraph) | Stream (xstream/RxJS)                   |
| -------- | ----------------------- | --------------------------------------- |
| 语义     | 当前值 (current value)  | 事件序列 (event sequence)               |
| 访问     | 同步读取 `get()`        | 异步订阅 `subscribe()`                  |
| 内存     | 始终持有最新值          | 事件流过即消失（除非 remember）         |
| 适用场景 | UI 状态、表单、配置     | 实时数据流、WebSocket、SSE、AI 流式响应 |
| 组合方式 | 依赖追踪、computed      | map/filter/merge/fold                   |

## 方案概览

| 方案                                    | 核心思路                                  | 复杂度 | 推荐场景               |
| --------------------------------------- | ----------------------------------------- | ------ | ---------------------- |
| [unified-graph](./unified-graph/)       | 统一图，Signal 和 Stream 作为不同节点类型 | 高     | 需要深度混合的复杂应用 |
| [dual-layer](./dual-layer/)             | 双层架构，Signal 层 + Stream 层独立运行   | 中     | 清晰分离关注点         |
| [stream-as-source](./stream-as-source/) | Stream 作为 Signal 的数据源，桥接模式     | 低     | 渐进式迁移，最小改动   |
| [cycle-inspired](./cycle-inspired/)     | 借鉴 Cycle.js，Sources/Sinks + Drivers    | 中高   | 全面拥抱响应式         |

## 快速对比

```
┌─────────────────────────────────────────────────────────────────┐
│                        方案对比矩阵                              │
├─────────────────┬──────────┬──────────┬──────────┬─────────────┤
│                 │ unified  │ dual     │ stream   │ cycle       │
│                 │ -graph   │ -layer   │ -source  │ -inspired   │
├─────────────────┼──────────┼──────────┼──────────┼─────────────┤
│ 改动量          │ 大       │ 中       │ 小       │ 大          │
│ 类型安全        │ 复杂     │ 好       │ 好       │ 好          │
│ 学习曲线        │ 陡       │ 中       │ 缓       │ 陡          │
│ Signal/Stream   │ 统一     │ 分离     │ 桥接     │ 全 Stream   │
│ 现有代码兼容    │ 需重构   │ 兼容     │ 完全兼容 │ 需重构      │
│ AI 流式场景     │ ★★★★★   │ ★★★★☆   │ ★★★☆☆   │ ★★★★★      │
│ 传统 UI 场景    │ ★★★★☆   │ ★★★★★   │ ★★★★★   │ ★★★☆☆      │
└─────────────────┴──────────┴──────────┴──────────┴─────────────┘
```

## 推荐阅读顺序

1. 如果你想**最小改动**引入流式处理 → [stream-as-source](./stream-as-source/)
2. 如果你想**清晰分层**管理两种数据 → [dual-layer](./dual-layer/)
3. 如果你想**深度统一**两种范式 → [unified-graph](./unified-graph/)
4. 如果你想**全面拥抱**响应式编程 → [cycle-inspired](./cycle-inspired/)

## 参考资料

- [Cycle.js Documentation](https://cycle.js.org/)
- [xstream](https://github.com/staltz/xstream)
- [alien-signals](https://github.com/nicksrandall/alien-signals)
- 后端实现参考：`minimal-modular-ai-agent/packages/libs/src/toolcall_streams.ts`
