# depa-data-graph

一个框架无关的响应式状态库，在同一个显式 `DataGraph` 中统一建模 Signal 当前值与 Stream 事件。

中文 | [English](./README.md)

## 包

| 包                                                  | 说明                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| [depa-data-graph-core](./packages/core)             | Unified DataGraph runtime、状态节点、builders、typed refs、middleware 与 Stream |
| [depa-data-graph-codegen](./packages/graph-codegen) | JSON 图校验与 TypeScript identity/facade 生成                                   |
| [depa-data-graph-react](./packages/react)           | React hooks                                                                     |
| [depa-data-graph-vue](./packages/vue)               | Vue composables                                                                 |
| [depa-data-graph-solid](./packages/solid)           | Solid accessors                                                                 |
| [depa-data-graph-vanilla](./packages/vanilla)       | DOM bindings 与 reactive stores                                                 |

[demo](./examples/demo) 让 Vanilla、Vue、React、Solid 共同使用同一张图和同一套状态节点操作。

## 设计

- 唯一的 `DataGraph` 统一管理 Signal/Stream 节点、边、校验、snapshot 与生命周期。
- `SignalNodeRef<T>` / `StreamNodeRef<T>` 在类型上表达输出语义。
- Signal source/computed 与 Stream source/operator/sink 可以显式构成四个方向的拓扑。
- 四类状态节点正交组合 Signal/Stream 输入与 Signal/Stream 状态输出。
- 状态节点提供 `getState()`、typed `mutations`、typed `actions`、typed `dispatch` 与 `dispose()`，不提供 `set`。
- runtime 回调统一使用 `rt`：`rt.graph` 是图 effect capability，`rt.bizRuntime` 是应用服务。
- Signal 状态输出对 `Object.is` 相同值去重；Stream 状态输出每次成功 transition 都 emit，新订阅者只 replay 当前状态。
- Stream source/operator 默认 lazy，sink 与四类状态节点默认 eager；混合反馈环必须经过显式 feedback/delay/scheduler boundary。

## 安装

```bash
pnpm add depa-data-graph-core alien-signals xstream
```

框架 adapter 独立发布：

```bash
pnpm add depa-data-graph-react react
pnpm add depa-data-graph-vue vue
pnpm add depa-data-graph-solid solid-js
pnpm add depa-data-graph-vanilla
```

## Unified DataGraph

```ts
import { DataGraph } from 'depa-data-graph-core';

const bizRuntime = { logger: console };
const graph = new DataGraph(() => bizRuntime);

const count = graph.addSignal('count', 1);
const doubled = graph.addComputed('doubled', [count.ref], (rt) => rt.graph.get(count.ref) * 2);

const countEvents = graph.addSignalToStream('count-events', count.ref);
const latestCount = graph.addStreamToSignal(
  'latest-count',
  countEvents.ref,
  0,
  (_state, value) => value,
);

graph.get(doubled.ref); // 2
graph.stream(countEvents.ref).subscribe({ next: (value) => console.log(value) });
graph.get(latestCount.ref); // 1
```

普通可写 Signal 仍可由外部 driver 调用 `graph.set(...)`。状态节点 output ref 是只读的，不能作为 `set` 目标。

## 四类状态节点

输入语义与输出语义相互独立：

| 输入   | 输出 Signal                   | 输出 Stream                   |
| ------ | ----------------------------- | ----------------------------- |
| Signal | `SignalDrivenStateSignalNode` | `SignalDrivenStateStreamNode` |
| Stream | `StreamDrivenStateSignalNode` | `StreamDrivenStateStreamNode` |

```ts
const input = graph.addSignal('counter-input', 2);

const counter = graph.addSignalDrivenStateSignalNode({
  id: 'counter-state',
  input: input.ref,
  initial: 0,
  reducer: (state, value) => state + value,
  mutations: {
    increment: (state, by: number) => state + by,
    replace: (_state, value: number) => value,
  },
  actions: (rt) => ({
    incrementByConfiguredStep() {
      return rt.mutations.increment(10);
    },
  }),
});

counter.getState(); // Signal bootstrap 后为 2
counter.mutations.increment(3); // 5
counter.actions.incrementByConfiguredStep(); // 15
counter.dispatch(counter.operations.mutations.replace(1));
graph.get(counter.output); // 1
```

mutation 是有名字、同步、纯的 transition。action 可以执行 effect，但只能通过 `rt.mutations` 或 typed `rt.dispatch` 更新当前节点。`.mutations`、`.actions` 和 `.dispatch` 进入同一条可观察 operation 管线。

## Event Log Projection

`AppendOnlyEventLog` 继续作为有序、可 replay 的 Stream source；projection 由一等 Stream-driven state node 表达：

```ts
import { AppendOnlyEventLog, DataGraph } from 'depa-data-graph-core';

const graph = new DataGraph(() => ({}));
const log = new AppendOnlyEventLog<number>();
log.append(2);
log.append(3);

const source = graph.addSource('counter-events', log.stream());
const projection = graph.addStreamDrivenStateSignalNode({
  id: 'counter-projection',
  input: source.ref,
  initial: 0,
  reducer: (state, entry) => state + entry.value,
  mutations: { reset: () => 0 },
});

projection.getState(); // 5，注册返回前已同步归约历史
log.append(4);
projection.getState(); // 9
```

下游需要 transition Stream 时使用 `StreamDrivenStateStreamNode`。晚订阅者只收到订阅时当前状态一次，不会收到过去所有 transition；历史事件仍由 event log 持有。

## 构建方式

命令式 API、Code DSL、JSON DSL、schema-first API、module refs 与 codegen 都支持 Signal/Stream refs 和四类状态节点。

```ts
import {
  createStateNodeSchemaBuilder,
  createTypedGraph,
  signal,
} from 'depa-data-graph-core';

type AppRuntime = { defaultStep: number };
const stateNodes = createStateNodeSchemaBuilder<AppRuntime>();

const typed = createTypedGraph(
  {
    input: signal(1),
    counter: stateNodes.signalDrivenStateSignal({
      input: 'input',
      initial: 0,
      reducer: (state, value: number) => state + value,
      mutations: { add: (state: number, by: number) => state + by },
      actions: (rt) => ({ addDefault: () => rt.mutations.add(rt.bizRuntime.defaultStep) }),
    }),
  } as const,
  () => ({ defaultStep: 2 }),
);

typed.nodes.counter.mutations.add(2);
typed.nodes.counter.actions.addDefault();
typed.get(typed.nodes.counter.output);
```

module identity 提供 `signalInput`、`streamInput`、`signalOutput`、`streamOutput`、`signalState`、`streamState`、`signalInternal` 与 `streamInternal`。

## 框架 Adapters

adapter 消费 Signal ref，包括状态节点的只读 Signal output；更新仍然显式调用状态节点 handle：

```tsx
function CounterView({ graph, counter }) {
  const value = useGraphSignal(graph, counter.output);
  return <button onClick={() => counter.mutations.increment(1)}>{value}</button>;
}
```

Vue/Solid 的 `useGraphSignal` 与 Vanilla 的 `bindElement`/`createReactiveStore` 遵循相同边界：adapter 只读取图状态，不创造第二条 mutation 通道。

## Breaking Migration

本版本删除独立的 Stream graph、图 bridge manager/function，以及 reducer projection wrapper：

- Stream source/operator/sink 直接注册到 `DataGraph`。
- bridge 调用改为显式 `addSignalToStream` / `addStreamToSignal` 节点，或四类状态节点之一。
- reducer projection helper 改为 `StreamDrivenStateSignalNode` 或 `StreamDrivenStateStreamNode`。
- GraphRuntime 回调形参从 `ctx` 改为 `rt`；真正的 `MiddlewareContext ctx` 保持不变。
- 应用的 `intents` 包装改为 typed `.mutations.xxx()` / `.actions.xxx()`。

完整旧 API 到新 API 对照见 [迁移文档](./doc/architect/migration-unified-state.md)。

## 开发

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev
```

架构文档入口为 [doc/architect/index.md](./doc/architect/index.md)，核心契约见 [统一图](./doc/architect/data-graph.md)、[状态节点](./doc/architect/state-nodes.md)、[状态操作](./doc/architect/state-operations.md) 与 [生命周期](./doc/architect/stream-lifecycle.md)。

## 许可证

MIT
