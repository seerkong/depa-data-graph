# depa-data-graph

一个框架无关的状态管理库，具有显式数据图、MVI（Model-View-Intent）模式和基于 Actor 的跨框架消息传递。

中文 | [English](./README.md)

## 包

| 包                                      | 描述                                   | npm                                                                                                             |
| --------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [depa-data-graph-core](./packages/core) | 核心库：DataGraph、ActorSystem、构建器 | [![npm](https://img.shields.io/npm/v/depa-data-graph-core)](https://www.npmjs.com/package/depa-data-graph-core) |

## 示例

| 示例                    | 描述                                            |
| ----------------------- | ----------------------------------------------- |
| [demo](./examples/demo) | 混合技术栈演示（Vanilla + Vue + React + Solid） |

## 特性

- **显式数据图**：依赖关系预先声明，而非运行时追踪
- **框架无关**：核心状态管理可与任何 UI 框架配合使用
- **多种构建模式**：JSON DSL、Code DSL 和命令式 API
- **基于 Actor 的消息传递**：通过类型化消息实现跨框架通信
- **子图隔离**：每个框架拥有独立状态，通过 effect 桥接
- **MVI 模式**：单向数据流，使用命名的 intent
- **Timeline / Event Log 基础设施**：支持按序追加、channel fanout 和 reducer 投影
- **模块化节点标识**：支持结构化 node ref、公开端口与作用域化挂载

## 快速开始

```bash
# 安装依赖
pnpm install

# 构建核心包
pnpm build:core

# 启动演示开发服务器
pnpm dev

# 构建所有包
pnpm build
```

## 项目结构

```
depa-data-graph/
├── packages/
│   └── core/                    # depa-data-graph-core
│       ├── src/
│       │   ├── graph.ts         # DataGraph 类
│       │   ├── graph-builders.ts # JSON DSL + Code DSL 构建器
│       │   ├── actor.ts         # ActorSystem
│       │   ├── watch.ts         # watch() 和 untracked() 工具
│       │   └── index.ts         # 公开导出
│       ├── package.json
│       └── tsconfig.json
├── examples/
│   └── demo/                    # 演示应用
│       ├── src/
│       │   ├── app/             # Runtime、intents、图配置
│       │   └── views/           # Vanilla/Vue/React/Solid 视图
│       ├── index.html
│       ├── package.json
│       └── vite.config.ts
├── doc/
│   └── architect/               # 架构文档
├── package.json                 # 根工作区配置
├── pnpm-workspace.yaml
└── tsconfig.json
```

## 安装

```bash
# 使用 pnpm
pnpm add depa-data-graph-core alien-signals

# 使用 npm
npm install depa-data-graph-core alien-signals

# 使用 yarn
yarn add depa-data-graph-core alien-signals
```

## 使用

```typescript
import { DataGraph, createCodeGraphBuilder } from 'depa-data-graph-core';

// 创建数据图
const graph = new DataGraph(() => runtime);

// 使用 Code DSL 构建
createCodeGraphBuilder(graph)
  .signal('counter', 0)
  .computed('doubled', ['counter'], (ctx) => ctx.get('counter') * 2)
  .consumer('logger', ['counter'], (ctx) => {
    console.log('Counter:', ctx.get('counter'));
  });

// 读写
graph.get('counter'); // 0
graph.set('counter', 1); // 触发 computed + consumer
graph.get('doubled'); // 2
```

## Ordered Timeline 与事件投影

`depa-data-graph-core` 现在也暴露低层 stream foundation，可用于 append-only timeline、channel fanout 和 reducer-style projection：

```ts
import {
  AppendOnlyEventLog,
  OrderedTimeline,
  createReducerProjection,
} from 'depa-data-graph-core';

const timeline = new OrderedTimeline<string>();
const content = timeline.createChannel('content');
content.append('hello');
content.append('world');

const log = new AppendOnlyEventLog<number>();
log.append(2);
log.append(3);

const projection = createReducerProjection(log, {
  initial: 0,
  reducer: (state, entry) => state + entry.value,
});

projection.getState(); // 5
```

如果你需要“全局有序追加 + 按 channel fanout”，使用 `OrderedTimeline`。如果你需要“可 replay 的事件历史 + 派生快照”，使用 `AppendOnlyEventLog` 与 `createReducerProjection`。

## 类型化模型/ID 辅助（可选）

如果你希望在编译期约束节点 ID 与 value 类型，可以先定义 schema，再把 graph 包装成类型化版本：

```ts
import { DataGraph, asTypedGraph, defineModel, types } from 'depa-data-graph-core';

const MODEL = defineModel({
  counter: types.number(),
  name: types.string(),
} as const);

const graph = asTypedGraph(new DataGraph(() => runtime), MODEL);

graph.addSignal('counter', 0);
graph.set('counter', 1); // ok
// graph.set('counter', 'x'); // TS 报错
// graph.get('missing');      // TS 报错
```

## 模块化节点标识（可选）

如果你在构建可复用子图、派生图或多实例图，不想长期维护裸字符串 ID，可以先定义结构化 ref，再按 scope 挂载：

```ts
import { defineGraphModule, input, mountGraph, output, state, toNodeId } from 'depa-data-graph-core';

const StageModule = defineGraphModule('stage', {
  inputs: {
    lexicalEvents: input<string[]>(),
  },
  outputs: {
    semanticEvents: output<string[]>(),
  },
  state: {
    lexicalSeq: state<number>(),
  },
} as const);

const main = mountGraph(StageModule, { scope: 'agent/main' });

toNodeId(main.inputs.lexicalEvents);
// 'agent/main::stage.inputs.lexicalEvents'
```

这样运行时仍然保留 canonical string 供调试、快照和持久化使用，但业务代码的长期 identity 可以基于 ref 对象而不是手写字符串。

## 迁移说明（Breaking Changes）

### 显式 deps 被强制执行

`computed` / `processor` / `consumer` / `async` 只会在声明的 `deps` 变化时触发。逻辑内部读取其他节点将不再形成隐式订阅。

可以开启 deps 审计来定位未声明读取：

```ts
graph.setDepsAudit('warn'); // 或 'throw'
```

迁移前：

```ts
graph.addComputed('c', ['a'], (ctx) => ctx.get('a') + ctx.get('b'));
```

迁移后：

```ts
graph.addComputed('c', ['a', 'b'], (ctx) => ctx.get('a') + ctx.get('b'));
```

### computed 默认是 lazy

computed 只有在被读取（`graph.get('id')`）时才会执行。如果你依赖“预热/后台计算”，可以在启动时显式读取一次，或用 `consumer` / `processor` 来表达副作用。

## 节点类型

| 类型          | 描述                            | 输出                                        |
| ------------- | ------------------------------- | ------------------------------------------- |
| **Signal**    | 基础响应式状态                  | 可读可写                                    |
| **Computed**  | 从依赖派生的值                  | 只读，自动添加 `computed` 标志              |
| **Processor** | 写入多个输出的副作用            | 声明的输出信号                              |
| **Consumer**  | 仅消费数据的副作用              | 无输出（用于日志、分析等）                  |
| **Async**     | 带 loading/error 状态的异步计算 | `{id}/result`、`{id}/loading`、`{id}/error` |

## 三种构建模式

### 1. JSON DSL

```json
{
  "version": 1,
  "nodes": [
    { "kind": "signal", "id": "counter", "initial": 1 },
    { "kind": "computed", "id": "doubled", "deps": ["counter"], "logicKey": "doubled" }
  ]
}
```

### 2. Code DSL

```typescript
createCodeGraphBuilder(graph)
  .signal('counter', 1)
  .computed('doubled', ['counter'], (ctx) => ctx.get('counter') * 2)
  .consumer('logger', ['counter'], (ctx) => console.log(ctx.get('counter')));
```

### 3. 命令式 API

```typescript
graph.addSignal('counter', 1);
graph.addComputed('doubled', ['counter'], (ctx) => ctx.get('counter') * 2);
graph.addConsumer('logger', ['counter'], (ctx) => console.log(ctx.get('counter')));
```

## Actor 消息传递

框架之间通过类型化消息通信：

```typescript
// 注册 actor（无 state）
actorMesh.register('vue', (self, envelope) => {
  if (envelope.msg.type === 'ping') {
    self.send(envelope.from, { type: 'pong', text: 'hello' });
  }
});

// 注册 actor（带 state）
actorMesh.register('react', {
  initialState: { count: 0 },
  handler: (self, envelope) => {
    self.state.count++;
    if (envelope.msg.type === 'ping') {
      // 传递 self.ref 作为回复地址
      self.send(envelope.from, { type: 'pong', replyTo: self.ref });
    }
  },
});

// 外部：使用 sendFrom（from 是显式的）
actorMesh.sendFrom('system', 'vue', { type: 'ping' });

// 外部：使用 refFrom 获取绑定的 ActorRef
const vueRef = actorMesh.refFrom('system', 'vue');
vueRef?.send({ type: 'ping' }); // from 绑定为 'system'

// 广播给所有
actorMesh.broadcastFrom('system', { type: 'ping' });
```

## 文档

详细架构文档请参阅 [doc/architect/](./doc/architect/)：

- [概述](./doc/architect/overview.md) - 高层架构
- [DataGraph](./doc/architect/data-graph.md) - 节点类型、边、快照
- [图构建器](./doc/architect/graph-builders.md) - 三种构建模式
- [Actor 系统](./doc/architect/actor-system.md) - 跨框架消息传递
- [框架适配器](./doc/architect/framework-adapters.md) - 每框架集成
- [子图](./doc/architect/subgraphs.md) - 子图桥接
- [MVI 流程](./doc/architect/mvi-flow.md) - 单向数据流

## 技术栈

- [alien-signals](https://github.com/nicksrandall/alien-signals) - 响应式原语
- [pnpm](https://pnpm.io/) - 支持工作区的包管理器
- [TypeScript](https://www.typescriptlang.org/) - 类型安全
- [Vite](https://vitejs.dev/) - 构建工具（用于示例）

## 许可证

MIT
