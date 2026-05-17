export type ActorLogKind = 'send' | 'deliver' | 'error';

export interface ActorEnvelope<TMessage> {
  id: number;
  ts: number;
  from: string;
  to: string;
  msg: TMessage;
}

export interface ActorLogEntry<TMessage> extends ActorEnvelope<TMessage> {
  kind: ActorLogKind;
  error?: string;
}

// ActorRef - 无管理权引用（可发送，from 已绑定）
export interface ActorRef<TMessage> {
  readonly id: string;
  send: (msg: TMessage) => void;
}

// ActorSelf - 有管理权引用（handler 参数）
export interface ActorSelf<TRuntime, TMessage, TState = void> {
  readonly id: string;
  readonly ref: ActorRef<TMessage>;
  readonly runtime: TRuntime;
  state: TState;
  send: (to: string, msg: TMessage) => void;
  broadcast: (msg: TMessage, opts?: { excludeSelf?: boolean }) => void;
}

// ActorHandler - 消息处理函数
export type ActorHandler<TRuntime, TMessage, TState = void> = (
  self: ActorSelf<TRuntime, TMessage, TState>,
  envelope: ActorEnvelope<TMessage>,
) => void | Promise<void>;

// ActorOptions - 带 state 的注册选项
export interface ActorOptions<TRuntime, TMessage, TState> {
  initialState: TState;
  handler: ActorHandler<TRuntime, TMessage, TState>;
}

// ActorCell - 内部存储（不暴露）
type ActorCell<TRuntime, TMessage, TState = void> = {
  id: string;
  handler: ActorHandler<TRuntime, TMessage, TState>;
  state: TState;
  queue: ActorEnvelope<TMessage>[];
  processing: boolean;
};

export class ActorSystem<TRuntime, TMessage> {
  private seq = 0;
  private actorMesh = new Map<string, ActorCell<TRuntime, TMessage, unknown>>();

  constructor(
    private getRuntime: () => TRuntime,
    private onLog?: (entry: ActorLogEntry<TMessage>) => void,
  ) {}

  ids(): string[] {
    return Array.from(this.actorMesh.keys()).sort();
  }

  has(id: string): boolean {
    return this.actorMesh.has(id);
  }

  register<TState = void>(
    id: string,
    handlerOrOptions:
      | ActorHandler<TRuntime, TMessage, TState>
      | ActorOptions<TRuntime, TMessage, TState>,
  ): void {
    if (this.actorMesh.has(id)) {
      throw new Error(`Actor already registered: ${id}`);
    }

    const isOptions = typeof handlerOrOptions === 'object' && 'handler' in handlerOrOptions;
    const handler = isOptions ? handlerOrOptions.handler : handlerOrOptions;
    const state = isOptions ? handlerOrOptions.initialState : (undefined as TState);

    this.actorMesh.set(id, {
      id,
      handler: handler as ActorHandler<TRuntime, TMessage, unknown>,
      state,
      queue: [],
      processing: false,
    });
  }

  unregister(id: string): void {
    this.actorMesh.delete(id);
  }

  refFrom(from: string, to: string): ActorRef<TMessage> | undefined {
    if (!this.actorMesh.has(to)) {
      return undefined;
    }
    return {
      id: to,
      send: (msg: TMessage) => this.sendFrom(from, to, msg),
    };
  }

  sendFrom(from: string, to: string, msg: TMessage): void {
    const target = this.actorMesh.get(to);
    const envelope: ActorEnvelope<TMessage> = {
      id: ++this.seq,
      ts: Date.now(),
      from,
      to,
      msg,
    };

    if (!target) {
      this.onLog?.({ kind: 'error', ...envelope, error: `Unknown actor: ${to}` });
      return;
    }

    this.onLog?.({ kind: 'send', ...envelope });

    target.queue.push(envelope);
    this.scheduleDrain(target);
  }

  broadcastFrom(from: string, msg: TMessage, opts?: { excludeSelf?: boolean }): void {
    for (const id of this.actorMesh.keys()) {
      if (opts?.excludeSelf && id === from) {
        continue;
      }
      this.sendFrom(from, id, msg);
    }
  }

  private scheduleDrain(cell: ActorCell<TRuntime, TMessage, unknown>): void {
    if (cell.processing) {
      return;
    }

    cell.processing = true;
    queueMicrotask(() => {
      void this.drain(cell);
    });
  }

  private async drain(cell: ActorCell<TRuntime, TMessage, unknown>): Promise<void> {
    try {
      while (cell.queue.length > 0) {
        const envelope = cell.queue.shift()!;

        const selfRef: ActorRef<TMessage> = {
          id: cell.id,
          send: (msg: TMessage) => this.sendFrom(cell.id, envelope.from, msg),
        };

        const self: ActorSelf<TRuntime, TMessage, unknown> = {
          id: cell.id,
          ref: selfRef,
          runtime: this.getRuntime(),
          state: cell.state,
          send: (to, msg) => this.sendFrom(cell.id, to, msg),
          broadcast: (msg, opts) => this.broadcastFrom(cell.id, msg, opts),
        };

        try {
          await cell.handler(self, envelope);
          this.onLog?.({ kind: 'deliver', ...envelope });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.onLog?.({ kind: 'error', ...envelope, error: message });
        }
      }
    } finally {
      cell.processing = false;
      if (cell.queue.length > 0) {
        this.scheduleDrain(cell);
      }
    }
  }
}
