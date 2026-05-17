import { Stream, Listener } from 'xstream';

export interface StreamHeartbeat {
  interval: number;
  send: (ws: WebSocket) => void;
  onPong?: (data: unknown) => boolean;
  timeout?: number;
}

export interface StreamLifecycle {
  onDisconnect?: (event: CloseEvent | Event) => void;
  shouldReconnect?: (event: CloseEvent | Event) => boolean;
  reconnectStrategy?: (attempt: number) => number | null;
  heartbeat?: StreamHeartbeat;
}

export interface WebSocketStreamOptions<T = any> {
  protocols?: string | string[];
  parse?: (data: string) => T;
  lifecycle?: StreamLifecycle;

  // Legacy options (kept for backwards compatibility).
  reconnect?: boolean;
  reconnectDelay?: number;
}

export interface SSEStreamOptions<T = any> {
  parse?: (data: string) => T;
  eventType?: string;
  withCredentials?: boolean;
  lifecycle?: Omit<StreamLifecycle, 'heartbeat'>;
}

export function createWebSocketStream<T = any>(
  url: string,
  options: WebSocketStreamOptions<T> = {},
): Stream<T> {
  const {
    protocols,
    parse = JSON.parse as (data: string) => T,
    lifecycle,
    reconnect = false,
    reconnectDelay = 1000,
  } = options;

  let ws: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;

  let reconnectAttempt = 0;
  let shouldReconnect = true;
  let activeListener: Listener<T> | null = null;

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = undefined;
    }
    if (heartbeatTimeout) {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = undefined;
    }
  };

  const startHeartbeat = (socket: WebSocket) => {
    const hb = lifecycle?.heartbeat;
    if (!hb) {
      return;
    }

    stopHeartbeat();

    heartbeatInterval = setInterval(() => {
      if (!shouldReconnect || !activeListener || ws !== socket) {
        return;
      }

      hb.send(socket);

      if (hb.timeout !== undefined && hb.onPong) {
        if (heartbeatTimeout) {
          clearTimeout(heartbeatTimeout);
        }

        heartbeatTimeout = setTimeout(() => {
          try {
            socket.close();
          } catch {
            // ignore
          }
        }, hb.timeout);
      }
    }, hb.interval);
  };

  const cleanup = () => {
    shouldReconnect = false;

    stopHeartbeat();

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }

    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      ws = undefined;
    }
  };

  const shouldTryReconnect = (event: CloseEvent | Event) => {
    if (lifecycle?.shouldReconnect) {
      return lifecycle.shouldReconnect(event);
    }
    return reconnect;
  };

  const nextReconnectDelay = (attempt: number): number | null => {
    if (lifecycle?.reconnectStrategy) {
      return lifecycle.reconnectStrategy(attempt);
    }
    return reconnect ? reconnectDelay : null;
  };

  const connect = () => {
    if (!shouldReconnect || !activeListener) return;

    ws = new WebSocket(url, protocols);

    ws.onopen = () => {
      reconnectAttempt = 0;
      startHeartbeat(ws!);
    };

    ws.onmessage = (event) => {
      const hb = lifecycle?.heartbeat;
      if (hb?.onPong && hb.onPong((event as MessageEvent).data)) {
        if (heartbeatTimeout) {
          clearTimeout(heartbeatTimeout);
          heartbeatTimeout = undefined;
        }
        return;
      }

      try {
        const data = (event as MessageEvent).data;
        activeListener?.next(parse(typeof data === 'string' ? data : String(data)));
      } catch (err) {
        activeListener?.error(err);
      }
    };

    ws.onerror = (event) => {
      activeListener?.error(event);
    };

    ws.onclose = (event?: CloseEvent) => {
      const ev = (event ?? {}) as CloseEvent;
      lifecycle?.onDisconnect?.(ev);

      stopHeartbeat();
      ws = undefined;

      if (!activeListener || !shouldReconnect) {
        return;
      }

      if (!shouldTryReconnect(ev)) {
        activeListener?.complete();
        return;
      }

      const delay = nextReconnectDelay(reconnectAttempt);
      if (delay === null) {
        activeListener?.complete();
        return;
      }

      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  };

  return Stream.create<T>({
    start(listener: Listener<T>) {
      shouldReconnect = true;
      reconnectAttempt = 0;
      activeListener = listener;
      connect();
    },
    stop() {
      activeListener = null;
      cleanup();
    },
  });
}

export function createSSEStream<T = any>(
  url: string,
  options: SSEStreamOptions<T> = {},
): Stream<T> {
  const {
    parse = JSON.parse as (data: string) => T,
    eventType = 'message',
    withCredentials = false,
    lifecycle,
  } = options;

  let eventSource: EventSource | undefined;
  let handler: ((event: MessageEvent) => void) | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let shouldReconnect = true;
  let activeListener: Listener<T> | null = null;

  const cleanupSource = () => {
    if (eventSource) {
      if (handler) {
        eventSource.removeEventListener(eventType, handler);
      }
      eventSource.onerror = null;
      eventSource.close();
      eventSource = undefined;
      handler = undefined;
    }
  };

  const cleanup = () => {
    shouldReconnect = false;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }

    cleanupSource();
  };

  const connect = () => {
    if (!shouldReconnect || !activeListener) {
      return;
    }

    cleanupSource();

    eventSource = new EventSource(url, { withCredentials });

    handler = (event: MessageEvent) => {
      try {
        activeListener?.next(parse((event as MessageEvent).data as string));
      } catch (err) {
        activeListener?.error(err);
      }
    };

    eventSource.addEventListener(eventType, handler);

    eventSource.onerror = (event?: Event) => {
      const ev = (event ?? {}) as Event;
      lifecycle?.onDisconnect?.(ev);

      if (!shouldReconnect || !activeListener) {
        return;
      }

      const wantsReconnect = lifecycle?.shouldReconnect ? lifecycle.shouldReconnect(ev) : false;
      if (wantsReconnect) {
        const delay = lifecycle?.reconnectStrategy
          ? lifecycle.reconnectStrategy(reconnectAttempt)
          : 1000;
        if (delay === null) {
          activeListener.complete();
          cleanup();
          return;
        }

        reconnectAttempt += 1;
        cleanupSource();
        reconnectTimer = setTimeout(connect, delay);
        return;
      }

      if (eventSource?.readyState === EventSource.CLOSED) {
        activeListener?.complete();
      }
    };
  };

  return Stream.create<T>({
    start(listener: Listener<T>) {
      activeListener = listener;
      shouldReconnect = true;
      reconnectAttempt = 0;
      connect();
    },
    stop() {
      activeListener = null;
      cleanup();
    },
  });
}

export function createFetchStream<T = string>(
  url: string,
  options: RequestInit & {
    parse?: (chunk: string) => T;
    onProgress?: (loaded: number) => void;
  } = {},
): Stream<T> {
  const {
    parse = ((x: string) => x) as (chunk: string) => T,
    onProgress,
    ...fetchOptions
  } = options;

  let controller: AbortController | null = null;
  let activeListener: Listener<T> | null = null;

  const abort = () => {
    controller?.abort();
    controller = null;
  };

  return Stream.create<T>({
    start(listener: Listener<T>) {
      activeListener = listener;
      controller = new AbortController();

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
            activeListener?.next(parse(chunk));
          }

          activeListener?.complete();
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            activeListener?.error(err);
          }
        });
    },
    stop() {
      activeListener = null;
      abort();
    },
  });
}

export interface AIStreamChunk {
  type: 'content' | 'tool_call' | 'thinking' | 'done' | 'error';
  content?: string;
  toolCall?: { id: string; name: string; arguments: string };
  thinking?: string;
  error?: string;
}

export function createAIStream(
  url: string,
  body: object,
  options: RequestInit = {},
): Stream<AIStreamChunk> {
  let controller: AbortController | null = null;
  let activeListener: Listener<AIStreamChunk> | null = null;

  const abort = () => {
    controller?.abort();
    controller = null;
  };

  return Stream.create<AIStreamChunk>({
    start(listener: Listener<AIStreamChunk>) {
      activeListener = listener;
      controller = new AbortController();

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify(body),
        signal: controller.signal,
        ...options,
      })
        .then(async (response) => {
          if (!response.ok) {
            activeListener?.next({ type: 'error', error: `HTTP ${response.status}` });
            activeListener?.complete();
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            activeListener?.next({ type: 'error', error: 'No response body' });
            activeListener?.complete();
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
                activeListener?.next({ type: 'done' });
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                if (delta?.content) {
                  activeListener?.next({ type: 'content', content: delta.content });
                }
                if (delta?.tool_calls?.[0]) {
                  const tc = delta.tool_calls[0];
                  activeListener?.next({
                    type: 'tool_call',
                    toolCall: {
                      id: tc.id || '',
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    },
                  });
                }
                if (parsed.thinking) {
                  activeListener?.next({ type: 'thinking', thinking: parsed.thinking });
                }
              } catch {
                // Ignore malformed/incomplete SSE JSON chunks.
              }
            }
          }

          activeListener?.complete();
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            activeListener?.next({ type: 'error', error: err.message });
          }
          activeListener?.complete();
        });
    },
    stop() {
      activeListener = null;
      abort();
    },
  });
}
