# Plan 2: Dual Layer - 双层架构方案

## 概述

保持现有 DataGraph (Signal 层) 不变，新增独立的 StreamGraph (Stream 层)。两层通过明确的桥接点连接，各自保持独立的语义和 API。

## 核心思想

```
┌─────────────────────────────────────────────────────────────────┐
│                         View Layer                              │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│   │ Vanilla  │ │   Vue    │ │  React   │ │  Solid   │          │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│        └────────────┴─────┬──────┴────────────┘                 │
├───────────────────────────┼─────────────────────────────────────┤
│                     Actor System                                │
├───────────────────────────┼─────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Signal Layer (DataGraph)                    │   │
│  │   signal | computed | processor | consumer | async       │   │
│  │                                                          │   │
│  │   ┌─────────┐    ┌─────────┐    ┌─────────┐             │   │
│  │   │ counter │───▶│ doubled │───▶│ display │             │   │
│  │   └─────────┘    └─────────┘    └─────────┘             │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                       │
│                    Bridge Layer                                 │
│              ┌──────────┴──────────┐                           │
│              │  signalToStream()   │                           │
│              │  streamToSignal()   │                           │
│              └──────────┬──────────┘                           │
│                         │                                       │
│  ┌──────────────────────┴───────────────────────────────────┐   │
│  │              Stream Layer (StreamGraph)                  │   │
│  │   source | operator | sink | pipeline                    │   │
│  │                                                          │   │
│  │   ┌─────────┐    ┌─────────┐    ┌─────────┐             │   │
│  │   │   ws$   │───▶│ parse$  │───▶│ output$ │             │   │
│  │   └─────────┘    └─────────┘    └─────────┘             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                      alien-signals + xstream                    │
└─────────────────────────────────────────────────────────────────┘
```

## 新增 StreamGraph 类

```typescript
// packages/core/src/stream-graph.ts

import xs, { Stream, Subscription } from 'xstream';

export type StreamNodeKind = 'source' | 'operator' | 'sink' | 'pipeline';

export interface StreamNode<T = unknown> {
  id: string;
  kind: StreamNodeKind;
  deps: string[];
  stream$: Stream<T>;
  meta: {
    eventCount: number;
    lastEvent?: T;
    lastEventAt?: number;
    isActive: boolean;
  };
}

export interface StreamGraphSnapshot {
  nodes: Array<{
    id: string;
    kind: StreamNodeKind;
    deps: string[];
    eventCount: number;
    lastEvent?: unknown;
    isActive: boolean;
  }>;
}

export class StreamGraph {
  private nodes = new Map<string, StreamNode<any>>();
  private subscriptions = new Map<string, Subscription>();

  /**
   * 添加流源节点
   */
  addSource<T>(id: string, producer: xs.Producer<T>): StreamNode<T> {
    this.assertNewId(id);

    const stream$ = xs.create(producer);
    const node: StreamNode<T> = {
      id,
      kind: 'source',
      deps: [],
      stream$,
      meta: { eventCount: 0, isActive: false },
    };

    this.nodes.set(id, node);
    return node;
  }

  /**
   * 添加流操作节点
   */
  addOperator<TIn, TOut>(
    id: string,
    deps: string[],
    operator: (inputs: Record<string, Stream<any>>) => Stream<TOut>,
  ): StreamNode<TOut> {
    this.assertNewId(id);

    const inputs: Record<string, Stream<any>> = {};
    for (const dep of deps) {
      inputs[dep] = this.get(dep);
    }

    const stream$ = operator(inputs);
    const node: StreamNode<TOut> = {
      id,
      kind: 'operator',
      deps: [...deps],
      stream$,
      meta: { eventCount: 0, isActive: false },
    };

    this.nodes.set(id, node);
    return node;
  }

  /**
   * 添加流消费节点
   */
  addSink<T>(id: string, deps: string[], handler: (value: T) => void): StreamNode<void> {
    this.assertNewId(id);

    const inputs: Record<string, Stream<any>> = {};
    for (const dep of deps) {
      inputs[dep] = this.get(dep);
    }

    // 合并所有依赖流
    const merged$ = deps.length === 1 ? inputs[deps[0]] : xs.merge(...Object.values(inputs));

    const stream$ = merged$.map((value) => {
      handler(value);
      return undefined;
    });

    const node: StreamNode<void> = {
      id,
      kind: 'sink',
      deps: [...deps],
      stream$,
      meta: { eventCount: 0, isActive: false },
    };

    this.nodes.set(id, node);
    return node;
  }

  /**
   * 获取流
   */
  get<T>(id: string): Stream<T> {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Unknown stream node: ${id}`);
    }
    return node.stream$ as Stream<T>;
  }

  /**
   * 启动流（订阅）
   */
  start(id: string): void {
    const node = this.nodes.get(id);
    if (!node || this.subscriptions.has(id)) return;

    const sub = node.stream$.subscribe({
      next: (value) => {
        node.meta.eventCount++;
        node.meta.lastEvent = value;
        node.meta.lastEventAt = Date.now();
      },
      error: (err) => console.error(`Stream ${id} error:`, err),
      complete: () => {
        node.meta.isActive = false;
      },
    });

    node.meta.isActive = true;
    this.subscriptions.set(id, sub);
  }

  /**
   * 停止流
   */
  stop(id: string): void {
    const sub = this.subscriptions.get(id);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(id);
      const node = this.nodes.get(id);
      if (node) node.meta.isActive = false;
    }
  }

  /**
   * 启动所有 sink 节点
   */
  startAll(): void {
    for (const [id, node] of this.nodes) {
      if (node.kind === 'sink') {
        this.start(id);
      }
    }
  }

  /**
   * 快照
   */
  snapshot(): StreamGraphSnapshot {
    return {
      nodes: Array.from(this.nodes.values()).map((node) => ({
        id: node.id,
        kind: node.kind,
        deps: [...node.deps],
        eventCount: node.meta.eventCount,
        lastEvent: node.meta.lastEvent,
        isActive: node.meta.isActive,
      })),
    };
  }

  /**
   * 清理
   */
  dispose(): void {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
    this.nodes.clear();
  }

  private assertNewId(id: string): void {
    if (this.nodes.has(id)) {
      throw new Error(`Duplicate stream node id: ${id}`);
    }
  }
}
```

## Bridge Layer 实现

```typescript
// packages/core/src/graph-bridge.ts

import { Stream } from 'xstream';
import { DataGraph } from './graph';
import { StreamGraph } from './stream-graph';

export interface BridgeOptions {
  debounce?: number;
  throttle?: number;
}

export class GraphBridge<TRuntime> {
  constructor(
    private dataGraph: DataGraph<TRuntime>,
    private streamGraph: StreamGraph,
  ) {}

  /**
   * Signal → Stream
   * 将 Signal 的变化转换为事件流
   */
  signalToStream<T>(signalId: string, streamId: string, options: BridgeOptions = {}): void {
    const { debounce, throttle } = options;

    this.streamGraph.addSource<T>(streamId, {
      start: (listener) => {
        // 使用 alien-signals 的 effect 监听变化
        const stop = this.dataGraph.addConsumer(`__bridge_${streamId}`, [signalId], (ctx) => {
          listener.next(ctx.get(signalId));
        });

        // 存储 stop 函数以便清理
        (listener as any).__stop = stop;
      },
      stop: (listener) => {
        (listener as any).__stop?.();
      },
    });

    // 应用 debounce/throttle
    if (debounce || throttle) {
      const original$ = this.streamGraph.get<T>(streamId);
      let modified$ = original$;

      if (debounce) {
        modified$ = modified$.compose(xs.debounce(debounce));
      }
      if (throttle) {
        modified$ = modified$.compose(xs.throttle(throttle));
      }

      // 替换节点的 stream$
      const node = (this.streamGraph as any).nodes.get(streamId);
      if (node) node.stream$ = modified$;
    }
  }

  /**
   * Stream → Signal
   * 将 Stream 的最新值同步到 Signal
   */
  streamToSignal<T>(
    streamId: string,
    signalId: string,
    initial: T,
    reducer?: (prev: T, event: any) => T,
  ): void {
    // 创建 Signal
    this.dataGraph.addSignal(signalId, initial);

    // 订阅 Stream 并更新 Signal
    const stream$ = this.streamGraph.get<any>(streamId);

    this.streamGraph.addSink(`__bridge_${signalId}`, [streamId], (event) => {
      if (reducer) {
        this.dataGraph.set(signalId, (prev: T) => reducer(prev, event));
      } else {
        this.dataGraph.set(signalId, event as T);
      }
    });
  }

  /**
   * 双向绑定
   */
  bidirectional<T>(signalId: string, streamId: string, options: BridgeOptions = {}): void {
    // Signal → Stream
    this.signalToStream(signalId, `${streamId}_from_signal`, options);

    // Stream → Signal (需要外部提供 stream)
    // 这里只设置监听，实际的 stream 需要外部创建
  }
}
```

## Runtime 集成

```typescript
// 扩展 Runtime 类型
interface DemoRuntime {
  graph: DataGraph<DemoRuntime>;
  streamGraph: StreamGraph;
  bridge: GraphBridge<DemoRuntime>;
  actorMesh: ActorSystem;
  intents: DemoIntents;
}

// 初始化
function createRuntime(): DemoRuntime {
  const runtime: DemoRuntime = {} as DemoRuntime;

  runtime.graph = new DataGraph(() => runtime);
  runtime.streamGraph = new StreamGraph();
  runtime.bridge = new GraphBridge(runtime.graph, runtime.streamGraph);
  runtime.actorMesh = new ActorSystem();

  return runtime;
}
```

## 使用示例：AI 流式响应

```typescript
// 1. 创建 Stream 层的 AI 响应处理 pipeline
function setupAIStreamPipeline(runtime: DemoRuntime) {
  const { streamGraph, bridge, graph } = runtime;

  // 源：AI SSE 流
  streamGraph.addSource('ai-raw$', {
    start(listener) {
      // 假设有一个 fetchSSE 函数
      const controller = new AbortController();
      fetchSSE('/api/chat', {
        signal: controller.signal,
        onMessage: (chunk) => listener.next(chunk),
        onError: (err) => listener.error(err),
        onComplete: () => listener.complete(),
      });
      (listener as any).__abort = () => controller.abort();
    },
    stop(listener) {
      (listener as any).__abort?.();
    },
  });

  // 操作：解析 chunk
  streamGraph.addOperator('ai-parsed$', ['ai-raw$'], (inputs) => {
    return inputs['ai-raw$'].map((chunk) => {
      try {
        return JSON.parse(chunk);
      } catch {
        return { type: 'text', content: chunk };
      }
    });
  });

  // 操作：分类内容
  streamGraph.addOperator('ai-content$', ['ai-parsed$'], (inputs) => {
    return inputs['ai-parsed$']
      .filter((parsed) => parsed.type === 'content' || parsed.type === 'text')
      .map((parsed) => parsed.content || parsed.text || '');
  });

  // 操作：累积文本
  streamGraph.addOperator('ai-accumulated$', ['ai-content$'], (inputs) => {
    return inputs['ai-content$'].fold((acc, chunk) => acc + chunk, '');
  });

  // 桥接：将累积文本同步到 Signal 层
  bridge.streamToSignal('ai-accumulated$', 'aiResponse', '', (prev, text) => text);

  // Signal 层：UI 可以直接读取
  graph.addComputed('aiResponseLength', ['aiResponse'], (ctx) => {
    return ctx.get<string>('aiResponse').length;
  });
}

// 2. 在 Vue/React 组件中使用
// Vue
const aiResponse = computed(() => runtime.graph.get('aiResponse'));

// React
function useAIResponse() {
  const [response, setResponse] = useState('');
  useEffect(() => {
    return watch(() => runtime.graph.get('aiResponse'), setResponse);
  }, []);
  return response;
}
```

## Code DSL 扩展

```typescript
// 为 StreamGraph 创建 Builder
function createStreamGraphBuilder(streamGraph: StreamGraph) {
  return {
    source<T>(id: string, producer: xs.Producer<T>) {
      streamGraph.addSource(id, producer);
      return this;
    },

    operator<T>(
      id: string,
      deps: string[],
      op: (inputs: Record<string, Stream<any>>) => Stream<T>,
    ) {
      streamGraph.addOperator(id, deps, op);
      return this;
    },

    sink(id: string, deps: string[], handler: (value: any) => void) {
      streamGraph.addSink(id, deps, handler);
      return this;
    },

    // Pipeline DSL - 链式操作
    pipeline<T>(sourceId: string) {
      return new PipelineBuilder<T>(streamGraph, sourceId);
    },
  };
}

class PipelineBuilder<T> {
  private steps: Array<{ id: string; op: Function }> = [];
  private currentId: string;

  constructor(
    private streamGraph: StreamGraph,
    sourceId: string,
  ) {
    this.currentId = sourceId;
  }

  map<U>(id: string, fn: (value: T) => U): PipelineBuilder<U> {
    this.streamGraph.addOperator(id, [this.currentId], (inputs) => {
      return inputs[this.currentId].map(fn);
    });
    this.currentId = id;
    return this as unknown as PipelineBuilder<U>;
  }

  filter(id: string, predicate: (value: T) => boolean): PipelineBuilder<T> {
    this.streamGraph.addOperator(id, [this.currentId], (inputs) => {
      return inputs[this.currentId].filter(predicate);
    });
    this.currentId = id;
    return this;
  }

  fold<U>(id: string, reducer: (acc: U, value: T) => U, initial: U): PipelineBuilder<U> {
    this.streamGraph.addOperator(id, [this.currentId], (inputs) => {
      return inputs[this.currentId].fold(reducer, initial);
    });
    this.currentId = id;
    return this as unknown as PipelineBuilder<U>;
  }

  debounce(id: string, ms: number): PipelineBuilder<T> {
    this.streamGraph.addOperator(id, [this.currentId], (inputs) => {
      return inputs[this.currentId].compose(xs.debounce(ms));
    });
    this.currentId = id;
    return this;
  }

  sink(id: string, handler: (value: T) => void): void {
    this.streamGraph.addSink(id, [this.currentId], handler);
  }

  toSignal(bridge: GraphBridge<any>, signalId: string, initial: T): void {
    bridge.streamToSignal(this.currentId, signalId, initial);
  }
}

// 使用示例
createStreamGraphBuilder(runtime.streamGraph)
  .source('ws$', createWebSocketProducer('wss://...'))
  .pipeline('ws$')
  .map('parsed$', JSON.parse)
  .filter('content$', (msg) => msg.type === 'content')
  .fold('accumulated$', (acc, msg) => acc + msg.text, '')
  .toSignal(runtime.bridge, 'wsContent', '');
```

## 优点

1. **关注点分离**：Signal 和 Stream 各自独立，语义清晰
2. **渐进式采用**：可以逐步引入 Stream 层，不影响现有代码
3. **类型安全**：两层各自有清晰的类型定义
4. **易于理解**：开发者可以选择熟悉的范式
5. **独立测试**：两层可以独立测试

## 缺点

1. **两套 API**：需要学习两套不同的 API
2. **桥接开销**：Signal ↔ Stream 转换有一定开销
3. **状态分散**：状态分布在两层，需要明确管理

## 适用场景

- 希望清晰分离 UI 状态和事件流
- 渐进式引入流式处理
- 团队成员对两种范式熟悉程度不同

## 实现复杂度评估

| 模块           | 工作量 | 风险 |
| -------------- | ------ | ---- |
| StreamGraph 类 | 中     | 低   |
| GraphBridge 类 | 中     | 中   |
| Pipeline DSL   | 中     | 低   |
| Runtime 集成   | 低     | 低   |
| 测试覆盖       | 中     | 低   |

**总体评估**：实现复杂度中等，提供清晰的分层架构。
