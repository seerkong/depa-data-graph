import type { Stream } from 'xstream';

import { createSSEStream, createWebSocketStream } from 'depa-data-graph-core';

// Non-executed examples for the Stream lifecycle options.
// These are meant to show the API shape without requiring a live server.

export function createWebSocketStreamExample<T = unknown>(): Stream<T> {
  return createWebSocketStream<T>('wss://example.invalid', {
    // Legacy options still supported.
    reconnect: true,
    reconnectDelay: 500,
    lifecycle: {
      onDisconnect: (event: CloseEvent | Event) => {
        console.log('ws disconnected', event);
      },
      shouldReconnect: (event: CloseEvent | Event) => {
        // Example: only reconnect for non-normal closures.
        return (event as CloseEvent).code !== 1000;
      },
      reconnectStrategy: (attempt: number) => {
        // Exponential backoff, stop after 5 attempts.
        return attempt < 5 ? 250 * 2 ** attempt : null;
      },
      heartbeat: {
        interval: 30_000,
        send: (ws: WebSocket) => ws.send('ping'),
        onPong: (data: unknown) => data === 'pong',
        timeout: 5_000,
      },
    },
  });
}

export function createSSEStreamExample<T = unknown>(): Stream<T> {
  return createSSEStream<T>('/sse', {
    eventType: 'message',
    withCredentials: false,
    lifecycle: {
      onDisconnect: (event: Event) => {
        console.log('sse disconnected', event);
      },
      shouldReconnect: () => true,
      reconnectStrategy: (attempt: number) => (attempt < 10 ? 1000 : null),
    },
  });
}
