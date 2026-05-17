# Plan 3: Stream as Source - 流作为数据源方案

## 概述

最小改动方案：保持现有 DataGraph 完全不变，仅添加工具函数将 Stream 桥接为 Signal 的数据源。Stream 在 DataGraph 外部处理，只在需要时将结果注入到 Signal 中。

## 核心思想

```
┌─────────────────────────────────────────────────────────────────┐
│                      External Stream Processing                 │
│                                                                 │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │   ws$    │────▶│  parse$  │────▶│ content$ │               │
│   └──────────┘     └──────────┘     └─────┬────┘               │
│                                           │                     │
│                                    subscribeToSignal()          │
│                                           │                     │
├───────────────────────────────────────────┼─────────────────────┤
│                      DataGraph (unchanged)│                     │
│                                           ▼                     │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │  Signal  │────▶│ Computed │────▶│ Consumer │               │
│   │ content  │     │ display  │     │  render  │               │
│   └──────────┘     └──────────┘     └──────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 实现

### 核心工具函数

```typescript
// packages/core/src/stream-bridge.ts

import xs, { Stream, Subscription } from 'xstream';
import { DataGraph, Setter } from './graph';

export interface StreamBridgeOptions<T, S> {
  /** 初始值 */
  initial: S;
  /** 如何将 stream 事件转换为 signal 值 */
  reducer?: (prev: S, event: T) => S;
  /** 是否在 complete 时重置 */
  resetOnComplete?: boolean;
  /** 错误处理 */
  onError?: (error: any) => void;
}

/**
 * 将 Stream 订阅到 DataGraph 的 Signal
 *
 * @returns 取消订阅函数
 */
export function subscribeStreamToSignal<TRuntime, T, S = T>(
  graph: DataGraph<TRuntime>,
  signalId: string,
  stream$: Stream<T>,
  options: StreamBridgeOptions<T, S>,
): () => void {
  const { initial, reducer, resetOnComplete, onError } = options;

  // 确保 Signal 存在
  try {
    graph.node(signalId);
  } catch {
    graph.addSignal(signalId, initial);
  }

  const subscription = stream$.subscribe({
    next: (event) => {
      if (reducer) {
        graph.set(signalId, (prev: S) => reducer(prev, event));
      } else {
        graph.set(signalId, event as unknown as Setter<S>);
      }
    },
    error: (err) => {
      if (onError) {
        onError(err);
      } else {
        console.error(`Stream error for signal ${signalId}:`, err);
      }
    },
    complete: () => {
      if (resetOnComplete) {
        graph.set(signalId, initial);
      }
    },
  });

  // 注册清理函数
  graph.addCleanup(() => subscription.unsubscribe());

  return () => subscription.unsubscribe();
}

/**
 * 将 Signal 变化转换为 Stream
 */
export function signalToStream<TRuntime, T>(
  graph: DataGraph<TRuntime>,
  signalId: string,
): Stream<T> {
  return xs.create<T>({
    start: (listener) => {
      // 立即发送当前值
      listener.next(graph.peek(signalId));

      // 监听变化
      const stop = graph.addConsumer(`__stream_${signalId}_${Date.now()}`, [signalId], (ctx) => {
        listener.next(ctx.get(signalId));
      });

      (listener as any).__stop = stop;
    },
    stop: (listener) => {
      // Consumer 会在 graph.dispose() 时自动清理
    },
  });
}

/**
 * 创建一个管理多个 Stream 订阅的 Manager
 */
export class StreamBridgeManager<TRuntime> {
  private subscriptions = new Map<string, () => void>();

  constructor(private graph: DataGraph<TRuntime>) {}

  /**
   * 订阅 Stream 到 Signal
   */
  subscribe<T, S = T>(
    id: string,
    stream$: Stream<T>,
    signalId: string,
    options: StreamBridgeOptions<T, S>,
  ): this {
    // 取消之前的订阅
    this.unsubscribe(id);

    const unsub = subscribeStreamToSignal(this.graph, signalId, stream$, options);

    this.subscriptions.set(id, unsub);
    return this;
  }

  /**
   * 取消订阅
   */
  unsubscribe(id: string): this {
    const unsub = this.subscriptions.get(id);
    if (unsub) {
      unsub();
      this.subscriptions.delete(id);
    }
    return this;
  }

  /**
   * 取消所有订阅
   */
  dispose(): void {
    for (const unsub of this.subscriptions.values()) {
      unsub();
    }
    this.subscriptions.clear();
  }
}
```

### 便捷工厂函数

```typescript
// packages/core/src/stream-factories.ts

import xs, { Stream } from 'xstream';

/**
 * 创建 WebSocket Stream
 */
export function createWebSocketStream<T = any>(
  url: string,
  options: {
    protocols?: string | string[];
    parse?: (data: string) => T;
    reconnect?: boolean;
    reconnectDelay?: number;
  } = {},
): Stream<T> {
  const { protocols, parse = JSON.parse, reconnect = false, reconnectDelay = 1000 } = options;

  return xs.create<T>({
    start(listener) {
      let ws: WebSocket;
      let shouldReconnect = true;

      const connect = () => {
        ws = new WebSocket(url, protocols);

        ws.onmessage = (event) => {
          try {
            listener.next(parse(event.data));
          } catch (err) {
            listener.error(err);
          }
        };

        ws.onerror = (event) => {
          listener.error(event);
        };

        ws.onclose = () => {
          if (reconnect && shouldReconnect) {
            setTimeout(connect, reconnectDelay);
          } else {
            listener.complete();
          }
        };
      };

      connect();

      (listener as any).__cleanup = () => {
        shouldReconnect = false;
        ws?.close();
      };
    },
    stop(listener) {
      (listener as any).__cleanup?.();
    },
  });
}

/**
 * 创建 SSE (Server-Sent Events) Stream
 */
export function createSSEStream<T = any>(
  url: string,
  options: {
    parse?: (data: string) => T;
    eventType?: string;
    withCredentials?: boolean;
  } = {},
): Stream<T> {
  const { parse = JSON.parse, eventType = 'message', withCredentials = false } = options;

  return xs.create<T>({
    start(listener) {
      const eventSource = new EventSource(url, { withCredentials });

      const handler = (event: MessageEvent) => {
        try {
          listener.next(parse(event.data));
        } catch (err) {
          listener.error(err);
        }
      };

      eventSource.addEventListener(eventType, handler);

      eventSource.onerror = (event) => {
        if (eventSource.readyState === EventSource.CLOSED) {
          listener.complete();
        } else {
          listener.error(event);
        }
      };

      (listener as any).__cleanup = () => {
        eventSource.removeEventListener(eventType, handler);
        eventSource.close();
      };
    },
    stop(listener) {
      (listener as any).__cleanup?.();
    },
  });
}

/**
 * 创建 Fetch Stream (用于流式 API 响应)
 */
export function createFetchStream<T = string>(
  url: string,
  options: RequestInit & {
    parse?: (chunk: string) => T;
    onProgress?: (loaded: number) => void;
  } = {},
): Stream<T> {
  const { parse = (x) => x as T, onProgress, ...fetchOptions } = options;

  return xs.create<T>({
    start(listener) {
      const controller = new AbortController();

      fetch(url, { ...fetchOptions, signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body');
          }

          const decoder = new TextDecoder();
          let loaded = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            loaded += value.length;
            onProgress?.(loaded);

            const chunk = decoder.decode(value, { stream: true });
            listener.next(parse(chunk));
          }

          listener.complete();
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            listener.error(err);
          }
        });

      (listener as any).__abort = () => controller.abort();
    },
    stop(listener) {
      (listener as any).__abort?.();
    },
  });
}

/**
 * 创建 AI 流式响应 Stream (OpenAI 兼容格式)
 */
export interface AIStreamChunk {
  type: 'content' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  error?: string;
}

export function createAIStream(
  url: string,
  body: object,
  options: RequestInit = {},
): Stream<AIStreamChunk> {
  return createFetchStream<AIStreamChunk>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(body),
    ...options,
    parse: (chunk) => {
      // 解析 SSE 格式的 chunk
      const lines = chunk.split('\n').filter((line) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6); // 移除 'data: '
        if (data === '[DONE]') {
          return { type: 'done' };
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          if (delta?.content) {
            return { type: 'content', content: delta.content };
          }
          if (delta?.tool_calls?.[0]) {
            const tc = delta.tool_calls[0];
            return {
              type: 'tool_call',
              toolCall: {
                id: tc.id || '',
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            };
          }
        } catch {
          // 忽略解析错误
        }
      }

      return { type: 'content', content: '' };
    },
  });
}
```

## 使用示例

### 基础用法

```typescript
import {
  DataGraph,
  subscribeStreamToSignal,
  createWebSocketStream,
} from 'depa-data-graph-core';
import xs from 'xstream';

const graph = new DataGraph(() => runtime);

// 1. 创建 Signal
graph.addSignal('messages', [] as string[]);
graph.addSignal('connectionStatus', 'disconnected');

// 2. 创建 Stream (在 DataGraph 外部)
const ws$ = createWebSocketStream<{ type: string; text: string }>('wss://...');

// 3. 桥接 Stream 到 Signal
subscribeStreamToSignal(graph, 'messages', ws$, {
  initial: [],
  reducer: (prev, event) => [...prev, event.text].slice(-100), // 保留最近 100 条
});

// 4. 使用 computed 派生状态
graph.addComputed('messageCount', ['messages'], (ctx) => {
  return ctx.get<string[]>('messages').length;
});

graph.addComputed('lastMessage', ['messages'], (ctx) => {
  const msgs = ctx.get<string[]>('messages');
  return msgs[msgs.length - 1] || '';
});
```

### AI 流式响应

```typescript
import { createAIStream, subscribeStreamToSignal, StreamBridgeManager } from 'depa-data-graph-core';
import xs from 'xstream';

// 设置 Graph
graph.addSignal('aiContent', '');
graph.addSignal('aiLoading', false);
graph.addSignal('aiError', null as string | null);

// 创建 Bridge Manager
const bridgeManager = new StreamBridgeManager(graph);

// Intent: 发送消息
function sendMessage(message: string) {
  // 重置状态
  graph.batch(() => {
    graph.set('aiContent', '');
    graph.set('aiLoading', true);
    graph.set('aiError', null);
  });

  // 创建 AI Stream
  const ai$ = createAIStream('/api/chat', {
    messages: [{ role: 'user', content: message }]
  });

  // 处理 Stream
  const content$ = ai$
    .filter(chunk => chunk.type === 'content')
    .map(chunk => chunk.content || '');

  // 桥接到 Signal
  bridgeManager.subscribe('ai-response', content$, 'aiContent', {
    initial: '',
    reducer: (prev, chunk) => prev + chunk,
    onError: (err) => {
      graph.batch(() => {
        graph.set('aiLoading', false);
        graph.set('aiError', err.message);
      });
    }
  });

  // 监听完成
  ai$.filter(chunk => chunk.type === 'done').subscribe({
    next: () => {
      graph.set('aiLoading', false);
    }
  });
}

// 在组件中使用
// Vue
const aiContent = computed(() => runtime.graph.get('aiContent'));
const aiLoading = computed(() => runtime.graph.get('aiLoading'));

// React
function ChatComponent() {
  const content = useSignal('aiContent');
  const loading = useSignal('aiLoading');

  return (
    <div>
      {loading && <Spinner />}
      <div>{content}</div>
    </div>
  );
}
```

### 复杂 Pipeline 示例

```typescript
import xs from 'xstream';
import debounce from 'xstream/extra/debounce';
import { signalToStream, subscribeStreamToSignal } from 'depa-data-graph-core';

// 搜索功能：Signal → Stream → 处理 → Signal

// 1. 输入 Signal
graph.addSignal('searchInput', '');
graph.addSignal('searchResults', [] as SearchResult[]);
graph.addSignal('searchLoading', false);

// 2. 将 Signal 转为 Stream
const searchInput$ = signalToStream<typeof runtime, string>(graph, 'searchInput');

// 3. Stream 处理 pipeline
const searchResults$ = searchInput$
  .compose(debounce(300)) // 防抖
  .filter((query) => query.length > 2) // 最少 3 个字符
  .map((query) => {
    graph.set('searchLoading', true);
    return xs.fromPromise(
      fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json()),
    );
  })
  .flatten() // 展平 Promise
  .map((results) => {
    graph.set('searchLoading', false);
    return results;
  });

// 4. 桥接回 Signal
subscribeStreamToSignal(graph, 'searchResults', searchResults$, {
  initial: [],
  onError: (err) => {
    graph.set('searchLoading', false);
    console.error('Search error:', err);
  },
});
```

## 导出扩展

```typescript
// packages/core/src/index.ts

// 现有导出
export { DataGraph, type GraphNode, type GraphContext, type GraphSnapshot } from './graph';
export { createJsonGraphBuilder, createCodeGraphBuilder } from './graph-builders';
export { ActorSystem } from './actor';
export { watch, untracked } from './watch';

// 新增 Stream 桥接导出
export {
  subscribeStreamToSignal,
  signalToStream,
  StreamBridgeManager,
  type StreamBridgeOptions,
} from './stream-bridge';

export {
  createWebSocketStream,
  createSSEStream,
  createFetchStream,
  createAIStream,
  type AIStreamChunk,
} from './stream-factories';
```

## 优点

1. **零侵入**：DataGraph 完全不变，现有代码 100% 兼容
2. **简单直接**：只是工具函数，没有新概念
3. **灵活性高**：Stream 处理完全在外部，可以使用任何 xstream 操作
4. **渐进式**：可以逐步引入，不需要一次性重构
5. **易于理解**：桥接逻辑清晰，就是订阅 + 更新

## 缺点

1. **无统一视图**：Stream 不在 DataGraph 的 snapshot 中
2. **手动管理**：需要手动管理 Stream 订阅的生命周期
3. **类型分离**：Stream 和 Signal 的类型系统是分离的
4. **调试困难**：Stream 部分不在 DevTools 中可见

## 适用场景

- 现有项目想快速引入流式处理
- 流式处理场景相对简单
- 不想大幅改动现有架构
- 团队对 xstream 已经熟悉

## 实现复杂度评估

| 模块                    | 工作量 | 风险 |
| ----------------------- | ------ | ---- |
| subscribeStreamToSignal | 低     | 低   |
| signalToStream          | 低     | 低   |
| StreamBridgeManager     | 低     | 低   |
| Stream 工厂函数         | 中     | 低   |
| 测试覆盖                | 低     | 低   |

**总体评估**：实现复杂度最低，适合快速落地。
