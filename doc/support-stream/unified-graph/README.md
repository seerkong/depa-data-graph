# Plan 1: Unified Graph - 统一图方案

## 概述

将 Signal 和 Stream 统一到同一个 DataGraph 中，作为不同类型的节点。图中的边可以连接任意类型的节点，通过自动桥接实现互操作。

## 核心思想

```
┌─────────────────────────────────────────────────────────────────┐
│                      Unified DataGraph                          │
│                                                                 │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │  Signal  │────▶│ Computed │────▶│ Consumer │               │
│   │ counter  │     │ doubled  │     │  logger  │               │
│   └──────────┘     └──────────┘     └──────────┘               │
│        │                                                        │
│        │ (auto bridge)                                          │
│        ▼                                                        │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │  Stream  │────▶│  Stream  │────▶│  Stream  │               │
│   │ counter$ │     │ debounce │     │  output$ │               │
│   └──────────┘     └──────────┘     └──────────┘               │
│        │                                                        │
│        │ (auto bridge)                                          │
│        ▼                                                        │
│   ┌──────────┐                                                  │
│   │  Signal  │  ← Stream 的最新值自动同步到 Signal              │
│   │ latest   │                                                  │
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 新增节点类型

```typescript
export type NodeKind =
  | 'signal' // 现有：同步状态
  | 'computed' // 现有：派生状态
  | 'processor' // 现有：副作用处理器
  | 'consumer' // 现有：消费者
  | 'async' // 现有：异步计算
  // 新增 Stream 相关
  | 'stream' // 事件流源
  | 'stream-op' // 流操作节点 (map/filter/merge/etc)
  | 'stream-sink'; // 流消费终点
```

## API 设计

### 1. 添加 Stream 节点

```typescript
// 创建一个 Stream 源节点
graph.addStream<T>(
  id: string,
  producer: () => Stream<T>,
  flags?: NodeFlags
): GraphNode<Stream<T>>;

// 示例：WebSocket 流
graph.addStream('ws-messages', () => {
  return xs.create({
    start(listener) {
      const ws = new WebSocket('wss://...');
      ws.onmessage = (e) => listener.next(JSON.parse(e.data));
      ws.onerror = (e) => listener.error(e);
      ws.onclose = () => listener.complete();
    },
    stop() { ws.close(); }
  });
});

// 示例：AI 流式响应
graph.addStream('ai-response', () => {
  return xs.create({
    start(listener) {
      fetchSSE('/api/chat', { ... }).then(stream => {
        stream.on('data', chunk => listener.next(chunk));
        stream.on('end', () => listener.complete());
      });
    },
    stop() { /* abort */ }
  });
});
```

### 2. Stream 操作节点

```typescript
// 流操作节点 - 类似 computed，但输入输出都是 Stream
graph.addStreamOp<TIn, TOut>(
  id: string,
  deps: string[],  // 依赖的 stream 节点
  operator: (inputs: Record<string, Stream<any>>) => Stream<TOut>,
  flags?: NodeFlags
): GraphNode<Stream<TOut>>;

// 示例：合并多个流
graph.addStreamOp('merged-events', ['ws-messages', 'ai-response'], (inputs) => {
  return xs.merge(inputs['ws-messages'], inputs['ai-response']);
});

// 示例：流处理 pipeline
graph.addStreamOp('parsed-content', ['ai-response'], (inputs) => {
  return inputs['ai-response']
    .map(chunk => parseChunk(chunk))
    .filter(parsed => parsed.type === 'content');
});
```

### 3. Signal ↔ Stream 桥接

```typescript
// Signal → Stream：将 Signal 变化转为事件流
graph.addSignalToStream<T>(
  id: string,
  signalId: string,
  options?: { debounce?: number; throttle?: number }
): GraphNode<Stream<T>>;

// Stream → Signal：将 Stream 最新值同步到 Signal
graph.addStreamToSignal<T>(
  id: string,
  streamId: string,
  initial: T,
  reducer?: (prev: T, event: any) => T
): GraphNode<T>;

// 示例
graph.addSignal('searchInput', '');
graph.addSignalToStream('searchInput$', 'searchInput', { debounce: 300 });
graph.addStreamOp('searchResults$', ['searchInput$'], (inputs) => {
  return inputs['searchInput$'].map(query => fetchSearch(query)).flatten();
});
graph.addStreamToSignal('searchResults', 'searchResults$', [], (prev, results) => results);
```

## Code DSL 扩展

```typescript
createCodeGraphBuilder(graph)
  // 现有 Signal API
  .signal('counter', 0)
  .computed('doubled', ['counter'], (ctx) => ctx.get('counter') * 2)

  // 新增 Stream API
  .stream('ws$', () => createWebSocketStream('wss://...'))
  .streamOp('parsed$', ['ws$'], (inputs) => inputs['ws$'].map(parseMessage))

  // 桥接 API
  .signalToStream('counter$', 'counter', { debounce: 100 })
  .streamToSignal('latestMessage', 'parsed$', null)

  // 混合依赖
  .consumer('logger', ['counter', 'latestMessage'], (ctx) => {
    console.log('Counter:', ctx.get('counter'));
    console.log('Latest:', ctx.get('latestMessage'));
  });
```

## 类型系统

```typescript
// 节点值类型区分
type NodeValue<K extends NodeKind, T> = K extends 'stream' | 'stream-op'
  ? Stream<T>
  : K extends 'signal' | 'computed' | 'async'
    ? T
    : void;

// GraphContext 扩展
interface GraphContext<TRuntime> {
  // 现有
  get<T>(id: string): T;
  set<T>(id: string, value: Setter<T>): void;

  // 新增 Stream 访问
  stream<T>(id: string): Stream<T>;

  // 类型安全的节点访问
  getNode<K extends NodeKind, T>(id: string): NodeValue<K, T>;
}
```

## 生命周期管理

```typescript
class DataGraph<TRuntime> {
  // Stream 订阅管理
  private streamSubscriptions = new Map<string, Subscription>();

  addStream<T>(id: string, producer: () => Stream<T>): GraphNode<Stream<T>> {
    const stream$ = producer();

    // 懒启动：首次订阅时才真正启动
    const lazyStream$ = xs.createWithMemory({
      start: (listener) => {
        const sub = stream$.subscribe(listener);
        this.streamSubscriptions.set(id, sub);
      },
      stop: () => {
        this.streamSubscriptions.get(id)?.unsubscribe();
        this.streamSubscriptions.delete(id);
      },
    });

    // ... 创建节点
  }

  dispose(): void {
    // 清理所有 Stream 订阅
    for (const sub of this.streamSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.streamSubscriptions.clear();

    // 现有清理逻辑
    for (const stop of this.disposers.splice(0)) {
      stop();
    }
  }
}
```

## Snapshot 扩展

```typescript
interface GraphSnapshot {
  revision: number;
  nodes: Array<{
    id: string;
    kind: NodeKind;
    flags: NodeFlags;
    deps: string[];
    outputs: string[];
    version: number;
    updatedAt: number;
    value: unknown;
    // 新增 Stream 状态
    streamState?: {
      isActive: boolean;
      lastEvent?: unknown;
      eventCount: number;
    };
  }>;
  edges: GraphEdge[];
  viewDeps: Record<string, string[]>;
}
```

## 优点

1. **统一的图模型**：所有数据流都在一个图中可视化和管理
2. **自动桥接**：Signal 和 Stream 之间的转换是声明式的
3. **一致的 API 风格**：学习成本低，API 设计一致
4. **强大的组合能力**：可以自由混合两种范式

## 缺点

1. **复杂度高**：类型系统复杂，需要处理两种不同语义的数据
2. **性能考量**：桥接可能引入额外开销
3. **调试困难**：混合模式下追踪数据流更复杂
4. **改动量大**：需要大幅修改现有 DataGraph 实现

## 适用场景

- 需要深度混合 Signal 和 Stream 的复杂应用
- 希望在一个统一视图中管理所有数据流
- 团队对两种范式都有经验

## 实现复杂度评估

| 模块            | 工作量 | 风险 |
| --------------- | ------ | ---- |
| 新节点类型定义  | 中     | 低   |
| Stream 节点实现 | 高     | 中   |
| 桥接机制        | 高     | 高   |
| 类型系统        | 高     | 中   |
| Snapshot 扩展   | 中     | 低   |
| 测试覆盖        | 高     | 中   |

**总体评估**：实现复杂度高，但提供最强大的统一能力。
