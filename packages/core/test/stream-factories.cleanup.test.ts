import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAIStream,
  createFetchStream,
  createSSEStream,
  createWebSocketStream,
} from '../src/stream/stream-factories';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  close = vi.fn(() => {
    this.onclose?.();
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

  onerror: (() => void) | null = null;

  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  addEventListener(type: string, handler: (event: MessageEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, handler: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(handler);
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
    // @ts-expect-error - minimal signal mock
    this.signal.aborted = true;
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
});

function flushXstreamStop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('stream factories stop/cleanup', () => {
  it('createWebSocketStream: unsubscribe closes WebSocket', async () => {
    (globalThis as any).WebSocket = MockWebSocket;

    const stream$ = createWebSocketStream('ws://example.test');
    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].close).not.toHaveBeenCalled();

    sub.unsubscribe();

    await flushXstreamStop();

    expect(MockWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('createSSEStream: unsubscribe closes EventSource', async () => {
    (globalThis as any).EventSource = MockEventSource;

    const stream$ = createSSEStream('https://example.test/sse');
    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].close).not.toHaveBeenCalled();

    sub.unsubscribe();

    await flushXstreamStop();

    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('createFetchStream: unsubscribe aborts underlying request', async () => {
    globalThis.AbortController = MockAbortController as any;
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;

    const stream$ = createFetchStream('https://example.test/stream');
    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(MockAbortController.instances.length).toBe(1);
    // @ts-ignore - minimal signal mock
    expect((MockAbortController.instances[0].signal as any).aborted).toBe(false);

    sub.unsubscribe();

    await flushXstreamStop();

    expect(MockAbortController.instances[0].abort).toHaveBeenCalledTimes(1);
    // @ts-ignore - minimal signal mock
    expect((MockAbortController.instances[0].signal as any).aborted).toBe(true);
  });

  it('createAIStream: unsubscribe aborts underlying request', async () => {
    globalThis.AbortController = MockAbortController as any;
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;

    const stream$ = createAIStream('https://example.test/ai', { foo: 'bar' });
    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(MockAbortController.instances.length).toBe(1);

    sub.unsubscribe();

    await flushXstreamStop();

    expect(MockAbortController.instances[0].abort).toHaveBeenCalledTimes(1);
  });
});
