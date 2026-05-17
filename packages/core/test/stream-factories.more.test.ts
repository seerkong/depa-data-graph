import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAIStream,
  createFetchStream,
  createSSEStream,
  createWebSocketStream,
} from '../src/stream/stream-factories';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushStops(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await tick();
  }
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;

  send = vi.fn((_data?: unknown) => {
    // no-op
  });

  close = vi.fn(() => {
    this.onclose?.({ code: 1000 });
  });

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    MockWebSocket.instances.push(this);
  }
}

class MockEventSource {
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = 1;

  onerror: ((event?: unknown) => void) | null = null;

  addEventListener = vi.fn((type: string, handler: (event: MessageEvent) => void) => {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  });

  removeEventListener = vi.fn((type: string, handler: (event: MessageEvent) => void) => {
    this.listeners.get(type)?.delete(handler);
  });

  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  emit(type: string, data: string): void {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    const event = { data } as MessageEvent;
    for (const handler of handlers) {
      handler(event);
    }
  }

  constructor(
    public url: string,
    public options?: { withCredentials?: boolean },
  ) {
    MockEventSource.instances.push(this);
  }
}

class MockAbortController {
  static instances: MockAbortController[] = [];

  signal = { aborted: false } as AbortSignal;

  abort = vi.fn(() => {
    (this.signal as any).aborted = true;
  });

  constructor() {
    MockAbortController.instances.push(this);
  }
}

const originalWebSocket = (globalThis as any).WebSocket;
const originalEventSource = (globalThis as any).EventSource;
const originalAbortController = globalThis.AbortController;
const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as any).WebSocket = originalWebSocket;
  (globalThis as any).EventSource = originalEventSource;
  globalThis.AbortController = originalAbortController;
  globalThis.fetch = originalFetch;

  MockWebSocket.instances = [];
  MockEventSource.instances = [];
  MockAbortController.instances = [];

  vi.useRealTimers();
});

describe('stream factories (branches)', () => {
  it('createWebSocketStream reports parse errors', async () => {
    (globalThis as any).WebSocket = MockWebSocket;

    const err = new Error('parse');
    const stream$ = createWebSocketStream('ws://example.test', {
      parse: () => {
        throw err;
      },
    });

    let got: unknown;

    const sub = stream$.subscribe({
      next: () => {},
      error: (e) => {
        got = e;
      },
      complete: () => {},
    });

    expect(MockWebSocket.instances.length).toBe(1);

    MockWebSocket.instances[0].onmessage?.({ data: 'x' });

    expect(got).toBe(err);

    sub.unsubscribe();
    await flushStops();
  });

  it('createWebSocketStream reconnects on close when enabled', async () => {
    vi.useFakeTimers();
    (globalThis as any).WebSocket = MockWebSocket;

    const onDisconnect = vi.fn();
    const shouldReconnect = vi.fn(() => true);
    const reconnectStrategy = vi.fn(() => 10);

    const stream$ = createWebSocketStream('ws://example.test', {
      lifecycle: {
        onDisconnect,
        shouldReconnect,
        reconnectStrategy,
      },
    });
    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(MockWebSocket.instances.length).toBe(1);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(shouldReconnect).toHaveBeenCalledTimes(1);
    expect(reconnectStrategy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10);

    expect(MockWebSocket.instances.length).toBe(2);

    sub.unsubscribe();
    vi.runAllTimers();
  });

  it('createWebSocketStream cancels scheduled reconnect on stop', async () => {
    vi.useFakeTimers();
    (globalThis as any).WebSocket = MockWebSocket;

    const stream$ = createWebSocketStream('ws://example.test', {
      lifecycle: {
        shouldReconnect: () => true,
        reconnectStrategy: () => 10,
      },
    });
    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(MockWebSocket.instances.length).toBe(1);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });

    sub.unsubscribe();

    vi.runAllTimers();

    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('createWebSocketStream stops reconnecting when reconnectStrategy returns null', async () => {
    vi.useFakeTimers();
    (globalThis as any).WebSocket = MockWebSocket;

    let completed = 0;

    const stream$ = createWebSocketStream('ws://example.test', {
      lifecycle: {
        shouldReconnect: () => true,
        reconnectStrategy: () => null,
      },
    });

    const sub = stream$.subscribe({
      next: () => {},
      error: () => {},
      complete: () => (completed += 1),
    });

    expect(MockWebSocket.instances.length).toBe(1);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    vi.runAllTimers();

    expect(MockWebSocket.instances.length).toBe(1);
    expect(completed).toBe(1);

    sub.unsubscribe();
  });

  it('createWebSocketStream sends heartbeats and filters pong messages', async () => {
    vi.useFakeTimers();
    (globalThis as any).WebSocket = MockWebSocket;

    const values: string[] = [];

    const stream$ = createWebSocketStream('ws://example.test', {
      parse: (s) => s,
      lifecycle: {
        heartbeat: {
          interval: 10,
          send: (ws) => ws.send('ping'),
          onPong: (data) => data === 'pong',
        },
      },
    });

    const sub = stream$.subscribe({
      next: (v) => values.push(v),
      error: () => {},
      complete: () => {},
    });

    expect(MockWebSocket.instances.length).toBe(1);

    // Heartbeats start after open.
    MockWebSocket.instances[0].onopen?.();

    vi.advanceTimersByTime(35);
    expect(MockWebSocket.instances[0].send).toHaveBeenCalled();

    MockWebSocket.instances[0].onmessage?.({ data: 'pong' });
    MockWebSocket.instances[0].onmessage?.({ data: 'hello' });

    expect(values).toEqual(['hello']);

    sub.unsubscribe();
    vi.runAllTimers();
  });

  it('createWebSocketStream completes on close when reconnect disabled', async () => {
    (globalThis as any).WebSocket = MockWebSocket;

    const stream$ = createWebSocketStream('ws://example.test');

    let completed = 0;

    const sub = stream$.subscribe({
      next: () => {},
      error: () => {},
      complete: () => (completed += 1),
    });

    MockWebSocket.instances[0].onclose?.();

    expect(completed).toBe(1);

    sub.unsubscribe();
    await flushStops();
  });

  it('createSSEStream reports parse errors', async () => {
    (globalThis as any).EventSource = MockEventSource;

    const err = new Error('parse');

    const stream$ = createSSEStream('https://example.test/sse', {
      parse: () => {
        throw err;
      },
    });

    let got: unknown;
    let completed = 0;

    stream$.subscribe({
      next: () => {},
      error: (e) => {
        got = e;
      },
      complete: () => {
        completed += 1;
      },
    });

    expect(MockEventSource.instances.length).toBe(1);

    MockEventSource.instances[0].emit('message', 'x');

    expect(got).toBe(err);
    expect(completed).toBe(0);

    await flushStops();

    expect(MockEventSource.instances[0].removeEventListener).toHaveBeenCalled();
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('createSSEStream completes on CLOSED', async () => {
    (globalThis as any).EventSource = MockEventSource;

    const stream$ = createSSEStream('https://example.test/sse', {
      withCredentials: true,
      eventType: 'custom',
      parse: (s) => s,
    });

    const seen: string[] = [];
    let completed = 0;

    stream$.subscribe({
      next: (v) => seen.push(v),
      error: () => {},
      complete: () => {
        completed += 1;
      },
    });

    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].options?.withCredentials).toBe(true);

    MockEventSource.instances[0].emit('custom', 'x');
    expect(seen).toEqual(['x']);

    MockEventSource.instances[0].readyState = MockEventSource.CLOSED;
    MockEventSource.instances[0].onerror?.({ type: 'error' });

    expect(completed).toBe(1);

    await flushStops();

    expect(MockEventSource.instances[0].removeEventListener).toHaveBeenCalled();
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('createSSEStream reconnects using lifecycle hooks', async () => {
    vi.useFakeTimers();
    (globalThis as any).EventSource = MockEventSource;

    const onDisconnect = vi.fn();
    const shouldReconnect = vi.fn(() => true);
    const reconnectStrategy = vi.fn(() => 10);

    const stream$ = createSSEStream('https://example.test/sse', {
      lifecycle: {
        onDisconnect,
        shouldReconnect,
        reconnectStrategy,
      },
    });

    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(MockEventSource.instances.length).toBe(1);

    MockEventSource.instances[0].onerror?.({ type: 'error' });

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(shouldReconnect).toHaveBeenCalledTimes(1);
    expect(reconnectStrategy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10);
    expect(MockEventSource.instances.length).toBe(2);

    sub.unsubscribe();
    vi.runAllTimers();
  });

  it('createFetchStream emits parsed chunks, progress, and completes', async () => {
    globalThis.AbortController = MockAbortController as any;

    const encoder = new TextEncoder();

    const chunks = [encoder.encode('a'), encoder.encode('bc')];

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                const next = chunks.shift();
                if (!next) {
                  return { done: true, value: undefined };
                }
                return { done: false, value: next };
              },
            };
          },
        },
      } as any;
    }) as any;

    const progress: number[] = [];
    const values: string[] = [];

    const stream$ = createFetchStream('https://example.test/stream', {
      parse: (chunk) => chunk.toUpperCase(),
      onProgress: (n) => progress.push(n),
    });

    await new Promise<void>((resolve, reject) => {
      stream$.subscribe({
        next: (v) => values.push(v),
        error: (e) => reject(e),
        complete: () => resolve(),
      });
    });

    expect(values).toEqual(['A', 'BC']);
    expect(progress).toEqual([1, 3]);

    expect(MockAbortController.instances.length).toBe(1);
  });

  it('createFetchStream reports HTTP errors', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as any;

    const stream$ = createFetchStream('https://example.test/stream');

    let got: unknown;

    const sub = stream$.subscribe({
      next: () => {},
      error: (e) => {
        got = e;
      },
      complete: () => {},
    });

    await tick();

    expect(got).toBeInstanceOf(Error);
    expect((got as Error).message).toBe('HTTP 500');

    sub.unsubscribe();
    await flushStops();
  });

  it('createFetchStream reports missing response body', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, body: null })) as any;

    const stream$ = createFetchStream('https://example.test/stream');

    let got: unknown;

    const sub = stream$.subscribe({
      next: () => {},
      error: (e) => {
        got = e;
      },
      complete: () => {},
    });

    await tick();

    expect(got).toBeInstanceOf(Error);
    expect((got as Error).message).toBe('No response body');

    sub.unsubscribe();
    await flushStops();
  });

  it('createAIStream parses SSE chunks', async () => {
    globalThis.AbortController = MockAbortController as any;

    const encoder = new TextEncoder();

    const payload = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"t1","function":{"name":"tool","arguments":"{}"}}]}}]}',
      'data: {"thinking":"hmm"}',
      'data: [DONE]',
      'data: {not json}',
      'ignored',
      '',
    ].join('\n');

    const chunks = [encoder.encode(payload)];

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                const next = chunks.shift();
                if (!next) {
                  return { done: true, value: undefined };
                }
                return { done: false, value: next };
              },
            };
          },
        },
      } as any;
    }) as any;

    const events: any[] = [];

    const stream$ = createAIStream('https://example.test/ai', { foo: 'bar' });

    await new Promise<void>((resolve, reject) => {
      stream$.subscribe({
        next: (e) => events.push(e),
        error: (e) => reject(e),
        complete: () => resolve(),
      });
    });

    expect(events[0]).toEqual({ type: 'content', content: 'hi' });
    expect(events[1]).toEqual({
      type: 'tool_call',
      toolCall: { id: 't1', name: 'tool', arguments: '{}' },
    });
    expect(events[2]).toEqual({ type: 'thinking', thinking: 'hmm' });
    expect(events[3]).toEqual({ type: 'done' });
  });

  it('createAIStream reports HTTP errors', async () => {
    globalThis.AbortController = MockAbortController as any;
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400 })) as any;

    const events: any[] = [];

    const stream$ = createAIStream('https://example.test/ai', { foo: 'bar' });

    await new Promise<void>((resolve) => {
      stream$.subscribe({
        next: (e) => events.push(e),
        error: () => {},
        complete: () => resolve(),
      });
    });

    expect(events).toEqual([{ type: 'error', error: 'HTTP 400' }]);
  });

  it('createAIStream reports missing response body', async () => {
    globalThis.AbortController = MockAbortController as any;
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, body: null })) as any;

    const events: any[] = [];

    const stream$ = createAIStream('https://example.test/ai', { foo: 'bar' });

    await new Promise<void>((resolve) => {
      stream$.subscribe({
        next: (e) => events.push(e),
        error: () => {},
        complete: () => resolve(),
      });
    });

    expect(events).toEqual([{ type: 'error', error: 'No response body' }]);
  });
});
