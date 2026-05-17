# Stream Lifecycle

The stream factories (`createWebSocketStream`, `createSSEStream`) support lifecycle hooks for disconnect handling, reconnection strategies, and (for WebSocket) heartbeats.

These hooks are designed to be _extensible_:

- The core provides the hook points.
- Application code provides the strategy.

## WebSocket lifecycle

```ts
import { createWebSocketStream } from 'depa-data-graph-core';

const ws$ = createWebSocketStream('wss://example.invalid', {
  lifecycle: {
    onDisconnect: (event) => {
      console.log('disconnected', event);
    },
    shouldReconnect: (event) => {
      // Example: only reconnect for abnormal closures.
      return (event as CloseEvent).code !== 1000;
    },
    reconnectStrategy: (attempt) => {
      // Exponential backoff, stop after 5 attempts.
      return attempt < 5 ? 250 * 2 ** attempt : null;
    },
    heartbeat: {
      interval: 30_000,
      send: (ws) => ws.send('ping'),
      onPong: (data) => data === 'pong',
      timeout: 5_000,
    },
  },
});
```

Notes:

- If `heartbeat.onPong` is provided and returns `true`, that message is treated as the heartbeat response and is not forwarded to subscribers.
- If `heartbeat.timeout` is configured and a pong is not detected in time, the socket is closed to trigger the normal reconnect path.

## SSE lifecycle

```ts
import { createSSEStream } from 'depa-data-graph-core';

const sse$ = createSSEStream('/sse', {
  lifecycle: {
    onDisconnect: (event) => console.log('sse disconnect', event),
    shouldReconnect: () => true,
    reconnectStrategy: (attempt) => (attempt < 10 ? 1000 : null),
  },
});
```

SSE lifecycle hooks intentionally exclude heartbeat support.
