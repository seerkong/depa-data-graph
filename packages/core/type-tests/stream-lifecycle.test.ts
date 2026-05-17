import type {
  SSEStreamOptions,
  StreamLifecycle,
  WebSocketStreamOptions,
} from '../src/stream/stream-factories';

type _Assert<T extends true> = T;
type AssertFalse<T extends false> = T;

type SSELifecycle = NonNullable<SSEStreamOptions<unknown>['lifecycle']>;
type _sseHasNoHeartbeat = AssertFalse<'heartbeat' extends keyof SSELifecycle ? true : false>;

declare const ws: WebSocket;

const lifecycle = {
  onDisconnect: (_event: CloseEvent | Event) => {
    // no-op
  },
  shouldReconnect: (_event: CloseEvent | Event) => true,
  reconnectStrategy: (_attempt: number) => 1000,
  heartbeat: {
    interval: 30_000,
    send: (_ws: WebSocket) => {
      void _ws;
    },
    onPong: (data: unknown) => data === 'pong',
  },
} satisfies StreamLifecycle;

void lifecycle;

const wsOptions = {
  protocols: ['proto'],
  parse: (s: string) => s,
  lifecycle,
  reconnect: true,
  reconnectDelay: 1000,
} satisfies WebSocketStreamOptions<string>;

void wsOptions;

const sseOptions = {
  eventType: 'message',
  withCredentials: true,
  parse: (s: string) => s,
  lifecycle: {
    onDisconnect: (_event: Event) => {
      // no-op
    },
    shouldReconnect: (_event: Event) => false,
    reconnectStrategy: (_attempt: number) => null,
  },
} satisfies SSEStreamOptions<string>;

void sseOptions;

// Ensure heartbeat.send accepts a WebSocket.
lifecycle.heartbeat?.send(ws);
