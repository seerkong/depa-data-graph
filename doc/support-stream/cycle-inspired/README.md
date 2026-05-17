# Plan 4: Cycle-Inspired - 借鉴 Cycle.js 的方案

## 概述

借鉴 Cycle.js 的 Sources/Sinks + Drivers 架构，将整个应用建模为纯函数 `main(sources) => sinks`。所有副作用通过 Drivers 隔离，数据流完全基于 Stream。

## 核心思想

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                        main(sources) => sinks                   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                      Pure Function                       │   │
│   │                                                          │   │
│   │   sources.DOM.select('.btn').events('click')            │   │
│   │       │                                                  │   │
│   │       ▼                                                  │   │
│   │   ┌─────────┐    ┌─────────┐    ┌─────────┐            │   │
│   │   │ intent  │───▶│  model  │───▶│  view   │            │   │
│   │   └─────────┘    └─────────┘    └─────────┘            │   │
│   │       │              │              │                    │   │
│   │       │              │              ▼                    │   │
│   │       │              │         sinks.DOM                 │   │
│   │       │              │                                   │   │
│   │       │              ▼                                   │   │
│   │       │         sinks.state                              │   │
│   │       │                                                  │   │
│   │       ▼                                                  │   │
│   │   sinks.HTTP                                             │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│   │  DOM Driver  │ │ HTTP Driver  │ │ State Driver │           │
│   │  (snabbdom)  │ │   (fetch)    │ │  (signal)    │           │
│   └──────────────┘ └──────────────┘ └──────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 架构设计

### 1. Driver 接口

```typescript
// packages/core/src/cycle/types.ts

import { Stream } from 'xstream';

/**
 * Driver 是一个函数：接收 sink stream，返回 source
 */
export type Driver<Sink, Source> = (sink$: Stream<Sink>) => Source;

/**
 * Drivers 集合
 */
export type Drivers = {
  [name: string]: Driver<any, any>;
};

/**
 * 从 Drivers 推导 Sources 类型
 */
export type Sources<D extends Drivers> = {
  [K in keyof D]: D[K] extends Driver<any, infer Source> ? Source : never;
};

/**
 * 从 Drivers 推导 Sinks 类型
 */
export type Sinks<D extends Drivers> = {
  [K in keyof D]?: D[K] extends Driver<infer Sink, any> ? Stream<Sink> : never;
};

/**
 * Main 函数类型
 */
export type Main<D extends Drivers> = (sources: Sources<D>) => Sinks<D>;
```

### 2. 核心 Run 函数

```typescript
// packages/core/src/cycle/run.ts

import xs, { Stream } from 'xstream';
import { Drivers, Sources, Sinks, Main } from './types';

export interface RunOutput<D extends Drivers> {
  sources: Sources<D>;
  sinks: Sinks<D>;
  dispose: () => void;
}

/**
 * 运行 Cycle 应用
 */
export function run<D extends Drivers>(main: Main<D>, drivers: D): RunOutput<D> {
  // 创建 sink 代理
  const sinkProxies: Record<string, Stream<any>> = {};
  for (const name of Object.keys(drivers)) {
    sinkProxies[name] = xs.create<any>();
  }

  // 调用 drivers 获取 sources
  const sources: Record<string, any> = {};
  for (const [name, driver] of Object.entries(drivers)) {
    sources[name] = driver(sinkProxies[name]);
  }

  // 调用 main 获取 sinks
  const sinks = main(sources as Sources<D>);

  // 连接 sinks 到 proxies
  const subscriptions: Array<{ unsubscribe: () => void }> = [];
  for (const [name, sink$] of Object.entries(sinks)) {
    if (sink$ && sinkProxies[name]) {
      const sub = (sink$ as Stream<any>).subscribe({
        next: (value) => (sinkProxies[name] as any).shamefullySendNext(value),
        error: (err) => (sinkProxies[name] as any).shamefullySendError(err),
        complete: () => (sinkProxies[name] as any).shamefullySendComplete(),
      });
      subscriptions.push(sub);
    }
  }

  return {
    sources: sources as Sources<D>,
    sinks: sinks as Sinks<D>,
    dispose: () => {
      for (const sub of subscriptions) {
        sub.unsubscribe();
      }
    },
  };
}
```

### 3. State Driver (基于 DataGraph)

```typescript
// packages/core/src/cycle/drivers/state.ts

import xs, { Stream, MemoryStream } from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import { DataGraph } from '../../graph';

export type Reducer<S> = (state: S | undefined) => S | undefined;

export interface StateSource<S> {
  stream: MemoryStream<S>;
  select<R>(lens: Lens<S, R>): StateSource<R>;
}

export interface Lens<S, R> {
  get: (state: S) => R;
  set: (state: S, value: R) => S;
}

/**
 * 创建 State Driver
 *
 * 将 Cycle.js 的 state 模式与 DataGraph 结合
 */
export function makeStateDriver<S>(
  initialState: S,
): (reducer$: Stream<Reducer<S>>) => StateSource<S> {
  return function stateDriver(reducer$: Stream<Reducer<S>>): StateSource<S> {
    // 使用 DataGraph 作为底层存储
    const graph = new DataGraph(() => ({}));
    graph.addSignal('state', initialState);

    // 订阅 reducer stream
    reducer$.subscribe({
      next: (reducer) => {
        graph.set('state', (prev: S) => {
          const next = reducer(prev);
          return next === undefined ? prev : next;
        });
      },
    });

    // 创建 state stream
    const state$ = xs
      .create<S>({
        start: (listener) => {
          listener.next(graph.peek('state'));
          graph.addConsumer('__state_listener', ['state'], (ctx) => {
            listener.next(ctx.get('state'));
          });
        },
        stop: () => {},
      })
      .compose(dropRepeats())
      .remember();

    function createStateSource<T>(stream$: MemoryStream<T>): StateSource<T> {
      return {
        stream: stream$,
        select<R>(lens: Lens<T, R>): StateSource<R> {
          const selected$ = stream$
            .map((state) => lens.get(state))
            .compose(dropRepeats())
            .remember();
          return createStateSource(selected$);
        },
      };
    }

    return createStateSource(state$);
  };
}
```

### 4. HTTP Driver

```typescript
// packages/core/src/cycle/drivers/http.ts

import xs, { Stream, MemoryStream } from 'xstream';

export interface HTTPRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  category?: string;
  streaming?: boolean;
}

export interface HTTPResponse {
  request: HTTPRequest;
  status: number;
  headers: Headers;
  body: any;
}

export interface HTTPStreamChunk {
  request: HTTPRequest;
  chunk: string;
  done: boolean;
}

export interface HTTPSource {
  select(category?: string): {
    response$: Stream<HTTPResponse>;
    streaming$: Stream<HTTPStreamChunk>;
  };
}

/**
 * HTTP Driver - 支持普通请求和流式响应
 */
export function makeHTTPDriver(): (request$: Stream<HTTPRequest>) => HTTPSource {
  return function httpDriver(request$: Stream<HTTPRequest>): HTTPSource {
    const response$$ = request$.map((request) => {
      if (request.streaming) {
        // 流式响应
        return xs.create<HTTPStreamChunk>({
          start(listener) {
            const controller = new AbortController();

            fetch(request.url, {
              method: request.method || 'GET',
              headers: request.headers,
              body: request.body ? JSON.stringify(request.body) : undefined,
              signal: controller.signal,
            })
              .then(async (response) => {
                const reader = response.body?.getReader();
                if (!reader) {
                  listener.complete();
                  return;
                }

                const decoder = new TextDecoder();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    listener.next({ request, chunk: '', done: true });
                    listener.complete();
                    break;
                  }
                  listener.next({
                    request,
                    chunk: decoder.decode(value, { stream: true }),
                    done: false,
                  });
                }
              })
              .catch((err) => listener.error(err));

            (listener as any).__abort = () => controller.abort();
          },
          stop(listener) {
            (listener as any).__abort?.();
          },
        });
      } else {
        // 普通响应
        return xs.fromPromise(
          fetch(request.url, {
            method: request.method || 'GET',
            headers: request.headers,
            body: request.body ? JSON.stringify(request.body) : undefined,
          }).then(async (response) => ({
            request,
            status: response.status,
            headers: response.headers,
            body: await response.json(),
          })),
        );
      }
    });

    return {
      select(category?: string) {
        const filtered$$ = category
          ? response$$.filter((r$) => {
              // 需要检查 request.category
              return true; // 简化实现
            })
          : response$$;

        return {
          response$: filtered$$.flatten() as Stream<HTTPResponse>,
          streaming$: filtered$$.flatten() as Stream<HTTPStreamChunk>,
        };
      },
    };
  };
}
```

### 5. AI Stream Driver

```typescript
// packages/core/src/cycle/drivers/ai.ts

import xs, { Stream } from 'xstream';

export interface AIRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  stream?: boolean;
}

export interface AIChunk {
  type: 'content' | 'tool_call' | 'thinking' | 'done' | 'error';
  content?: string;
  toolCall?: { id: string; name: string; arguments: string };
  thinking?: string;
  error?: string;
}

export interface AISource {
  response$: Stream<AIChunk>;
  content$: Stream<string>;
  toolCall$: Stream<{ id: string; name: string; arguments: string }>;
  thinking$: Stream<string>;
  accumulated$: Stream<string>;
}

/**
 * AI Stream Driver - 专门处理 AI 流式响应
 */
export function makeAIDriver(
  endpoint: string,
  defaultOptions: Partial<AIRequest> = {},
): (request$: Stream<AIRequest>) => AISource {
  return function aiDriver(request$: Stream<AIRequest>): AISource {
    const response$ = request$
      .map((request) => {
        return xs.create<AIChunk>({
          start(listener) {
            const controller = new AbortController();

            fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...defaultOptions, ...request, stream: true }),
              signal: controller.signal,
            })
              .then(async (response) => {
                const reader = response.body?.getReader();
                if (!reader) {
                  listener.next({ type: 'done' });
                  listener.complete();
                  return;
                }

                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || '';

                  for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);

                    if (data === '[DONE]') {
                      listener.next({ type: 'done' });
                      continue;
                    }

                    try {
                      const parsed = JSON.parse(data);
                      const delta = parsed.choices?.[0]?.delta;

                      if (delta?.content) {
                        listener.next({ type: 'content', content: delta.content });
                      }
                      if (delta?.tool_calls?.[0]) {
                        const tc = delta.tool_calls[0];
                        listener.next({
                          type: 'tool_call',
                          toolCall: {
                            id: tc.id || '',
                            name: tc.function?.name || '',
                            arguments: tc.function?.arguments || '',
                          },
                        });
                      }
                      // 处理 thinking (如 Claude 的 extended thinking)
                      if (parsed.thinking) {
                        listener.next({ type: 'thinking', thinking: parsed.thinking });
                      }
                    } catch {
                      // 忽略解析错误
                    }
                  }
                }

                listener.complete();
              })
              .catch((err) => {
                listener.next({ type: 'error', error: err.message });
                listener.complete();
              });

            (listener as any).__abort = () => controller.abort();
          },
          stop(listener) {
            (listener as any).__abort?.();
          },
        });
      })
      .flatten();

    const content$ = response$
      .filter((chunk) => chunk.type === 'content')
      .map((chunk) => chunk.content || '');

    const toolCall$ = response$
      .filter((chunk) => chunk.type === 'tool_call')
      .map((chunk) => chunk.toolCall!);

    const thinking$ = response$
      .filter((chunk) => chunk.type === 'thinking')
      .map((chunk) => chunk.thinking || '');

    const accumulated$ = content$.fold((acc, chunk) => acc + chunk, '');

    return {
      response$,
      content$,
      toolCall$,
      thinking$,
      accumulated$,
    };
  };
}
```

### 6. 框架适配器 Driver

```typescript
// packages/core/src/cycle/drivers/framework.ts

import xs, { Stream, MemoryStream } from 'xstream';

/**
 * 框架无关的 View 描述
 */
export interface ViewDescriptor {
  framework: 'vanilla' | 'vue' | 'react' | 'solid';
  component: string;
  props: Record<string, any>;
  children?: ViewDescriptor[];
}

/**
 * DOM 事件
 */
export interface DOMEvent {
  type: string;
  target: string;
  value?: any;
  data?: any;
}

export interface FrameworkSource {
  events(selector: string, eventType: string): Stream<DOMEvent>;
  state$: MemoryStream<any>;
}

/**
 * Framework Driver - 连接到各种前端框架
 */
export function makeFrameworkDriver(
  mountPoint: HTMLElement,
  renderers: {
    vanilla?: (view: ViewDescriptor, container: HTMLElement) => void;
    vue?: (view: ViewDescriptor, container: HTMLElement) => void;
    react?: (view: ViewDescriptor, container: HTMLElement) => void;
    solid?: (view: ViewDescriptor, container: HTMLElement) => void;
  },
): (view$: Stream<ViewDescriptor>) => FrameworkSource {
  return function frameworkDriver(view$: Stream<ViewDescriptor>): FrameworkSource {
    const eventSubject = xs.create<DOMEvent>();

    // 订阅 view 更新
    view$.subscribe({
      next: (view) => {
        const renderer = renderers[view.framework];
        if (renderer) {
          renderer(view, mountPoint);
        }
      },
    });

    // 设置全局事件委托
    mountPoint.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const selector = target.dataset.selector || target.className;
      eventSubject.shamefullySendNext({
        type: 'click',
        target: selector,
        data: target.dataset,
      });
    });

    mountPoint.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const selector = target.dataset.selector || target.className;
      eventSubject.shamefullySendNext({
        type: 'input',
        target: selector,
        value: target.value,
      });
    });

    return {
      events(selector: string, eventType: string): Stream<DOMEvent> {
        return eventSubject.filter((e) => e.type === eventType && e.target.includes(selector));
      },
      state$: xs.empty().remember(), // 由 state driver 提供
    };
  };
}
```

## 完整示例：AI 聊天应用

```typescript
// app/main.ts

import xs from 'xstream';
import { run } from 'depa-data-graph-core/cycle';
import {
  makeStateDriver,
  makeAIDriver,
  makeFrameworkDriver,
} from 'depa-data-graph-core/cycle/drivers';

// 类型定义
interface AppState {
  messages: Array<{ role: string; content: string }>;
  input: string;
  isLoading: boolean;
  currentResponse: string;
}

// Drivers
const drivers = {
  state: makeStateDriver<AppState>({
    messages: [],
    input: '',
    isLoading: false,
    currentResponse: '',
  }),
  ai: makeAIDriver('/api/chat'),
  framework: makeFrameworkDriver(document.getElementById('app')!, {
    // 渲染器配置
  }),
};

// Main 函数
function main(
  sources: typeof drivers extends infer D
    ? D extends Record<string, any>
      ? {
          [K in keyof D]: D[K] extends (sink$: any) => infer S ? S : never;
        }
      : never
    : never,
) {
  const { state, ai, framework } = sources;

  // Intent
  const sendClick$ = framework.events('.send-btn', 'click');
  const inputChange$ = framework.events('.message-input', 'input');

  // Model
  const inputReducer$ = inputChange$.map((e) => (state: AppState) => ({
    ...state,
    input: e.value || '',
  }));

  const sendReducer$ = sendClick$
    .map(() => state.stream.take(1))
    .flatten()
    .filter((s) => s.input.trim().length > 0)
    .map((s) => (state: AppState) => ({
      ...state,
      messages: [...state.messages, { role: 'user', content: s.input }],
      input: '',
      isLoading: true,
      currentResponse: '',
    }));

  // AI 请求
  const aiRequest$ = sendReducer$
    .map(() => state.stream.take(1))
    .flatten()
    .map((s) => ({
      messages: s.messages,
    }));

  // AI 响应处理
  const aiContentReducer$ = ai.content$.map((chunk) => (state: AppState) => ({
    ...state,
    currentResponse: state.currentResponse + chunk,
  }));

  const aiDoneReducer$ = ai.response$
    .filter((chunk) => chunk.type === 'done')
    .map(() => state.stream.take(1))
    .flatten()
    .map((s) => (state: AppState) => ({
      ...state,
      messages: [...state.messages, { role: 'assistant', content: s.currentResponse }],
      currentResponse: '',
      isLoading: false,
    }));

  // 合并所有 reducer
  const reducer$ = xs.merge(inputReducer$, sendReducer$, aiContentReducer$, aiDoneReducer$);

  // View
  const view$ = state.stream.map((s) => ({
    framework: 'vanilla' as const,
    component: 'ChatApp',
    props: {
      messages: s.messages,
      input: s.input,
      isLoading: s.isLoading,
      currentResponse: s.currentResponse,
    },
  }));

  return {
    state: reducer$,
    ai: aiRequest$,
    framework: view$,
  };
}

// 运行
const { dispose } = run(main, drivers);

// 清理
window.addEventListener('beforeunload', dispose);
```

## MVI 模式详解

```typescript
// Model-View-Intent 分离

function main(sources) {
  // ============ INTENT ============
  // 将用户交互转换为意图流
  const intent = {
    send$: sources.framework.events('.send', 'click'),
    input$: sources.framework.events('.input', 'input').map((e) => e.value),
    clear$: sources.framework.events('.clear', 'click'),
  };

  // ============ MODEL ============
  // 将意图转换为状态变更
  const model = {
    inputReducer$: intent.input$.map((value) => (state: AppState) => ({ ...state, input: value })),

    sendReducer$: intent.send$
      .map(() => sources.state.stream.take(1))
      .flatten()
      .map((s) => (state: AppState) => ({
        ...state,
        messages: [...state.messages, { role: 'user', content: s.input }],
        input: '',
      })),

    clearReducer$: intent.clear$.map(() => () => ({
      messages: [],
      input: '',
      isLoading: false,
      currentResponse: '',
    })),
  };

  const reducer$ = xs.merge(model.inputReducer$, model.sendReducer$, model.clearReducer$);

  // ============ VIEW ============
  // 将状态转换为视图描述
  const view$ = sources.state.stream.map((state) => ({
    framework: 'vanilla',
    component: 'App',
    props: state,
  }));

  return {
    state: reducer$,
    framework: view$,
  };
}
```

## 与现有 DataGraph 的集成

```typescript
// 混合模式：Cycle 架构 + DataGraph 作为 State Driver 的底层

import { DataGraph } from 'depa-data-graph-core';

function makeDataGraphStateDriver<S>(graph: DataGraph<any>, signalId: string, initialState: S) {
  // 初始化 Signal
  graph.addSignal(signalId, initialState);

  return function stateDriver(reducer$: Stream<Reducer<S>>): StateSource<S> {
    // 订阅 reducer
    reducer$.subscribe({
      next: (reducer) => {
        graph.set(signalId, (prev: S) => reducer(prev) ?? prev);
      },
    });

    // 创建 state stream
    const state$ = xs
      .create<S>({
        start: (listener) => {
          listener.next(graph.peek(signalId));
          graph.addConsumer(`__cycle_${signalId}`, [signalId], (ctx) => {
            listener.next(ctx.get(signalId));
          });
        },
        stop: () => {},
      })
      .remember();

    return createStateSource(state$);
  };
}

// 使用
const graph = new DataGraph(() => runtime);
const drivers = {
  state: makeDataGraphStateDriver(graph, 'appState', initialState),
  // ... 其他 drivers
};
```

## 优点

1. **纯函数架构**：main 是纯函数，易于测试
2. **副作用隔离**：所有副作用在 Drivers 中
3. **完全响应式**：数据流清晰，无隐式状态
4. **可组合性强**：组件就是函数，易于组合
5. **时间旅行调试**：状态变更可追溯

## 缺点

1. **学习曲线陡**：需要理解响应式编程和 Cycle 架构
2. **改动量大**：需要重新设计应用架构
3. **生态较小**：相比 React/Vue，社区资源少
4. **调试工具**：需要专门的 DevTools

## 适用场景

- 新项目，愿意全面拥抱响应式
- 团队对 FRP (Functional Reactive Programming) 有经验
- 需要高度可测试性的应用
- 复杂的实时数据流应用

## 实现复杂度评估

| 模块              | 工作量 | 风险 |
| ----------------- | ------ | ---- |
| run 函数          | 中     | 低   |
| State Driver      | 中     | 中   |
| HTTP Driver       | 中     | 低   |
| AI Driver         | 中     | 低   |
| Framework Driver  | 高     | 高   |
| 与 DataGraph 集成 | 中     | 中   |
| 测试覆盖          | 高     | 中   |

**总体评估**：实现复杂度较高，但提供最纯粹的响应式架构。
