import { Stream, Subscription, Producer } from 'xstream';

export type StreamNodeKind = 'source' | 'operator' | 'sink';

export interface StreamNode<T = unknown> {
  id: string;
  kind: StreamNodeKind;
  deps: string[];
  stream$: Stream<T>;
  meta: {
    eventCount: number;
    lastEvent?: T;
    lastEventAt?: number;
    isActive: boolean;
  };
}

export interface StreamGraphSnapshot {
  nodes: Array<{
    id: string;
    kind: StreamNodeKind;
    deps: string[];
    eventCount: number;
    lastEvent?: unknown;
    isActive: boolean;
  }>;
}

export class StreamGraph {
  private nodes = new Map<string, StreamNode<any>>();
  private subscriptions = new Map<string, Subscription>();

  addSource<T>(id: string, producer: Producer<T>): StreamNode<T> {
    this.assertNewId(id);

    const stream$ = Stream.create<T>(producer);
    const node: StreamNode<T> = {
      id,
      kind: 'source',
      deps: [],
      stream$,
      meta: { eventCount: 0, isActive: false },
    };

    this.nodes.set(id, node);
    return node;
  }

  addOperator<TOut>(
    id: string,
    deps: string[],
    operator: (inputs: Record<string, Stream<any>>) => Stream<TOut>,
  ): StreamNode<TOut> {
    this.assertNewId(id);

    const inputs: Record<string, Stream<any>> = {};
    for (const dep of deps) {
      inputs[dep] = this.get(dep);
    }

    const stream$ = operator(inputs);
    const node: StreamNode<TOut> = {
      id,
      kind: 'operator',
      deps: [...deps],
      stream$,
      meta: { eventCount: 0, isActive: false },
    };

    this.nodes.set(id, node);
    return node;
  }

  addSink<T>(id: string, deps: string[], handler: (value: T) => void): StreamNode<void> {
    this.assertNewId(id);

    const depStreams = deps.map((dep) => this.get<T>(dep));
    const merged$ = deps.length === 1 ? depStreams[0] : Stream.merge(...depStreams);

    const stream$ = merged$.map((value) => {
      handler(value);
      return undefined;
    });

    const node: StreamNode<void> = {
      id,
      kind: 'sink',
      deps: [...deps],
      stream$: stream$ as Stream<void>,
      meta: { eventCount: 0, isActive: false },
    };

    this.nodes.set(id, node);
    return node;
  }

  get<T>(id: string): Stream<T> {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Unknown stream node: ${id}`);
    }
    return node.stream$ as Stream<T>;
  }

  node<T>(id: string): StreamNode<T> {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Unknown stream node: ${id}`);
    }
    return node as StreamNode<T>;
  }

  replaceStream<T>(id: string, stream$: Stream<T>): void {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Unknown stream node: ${id}`);
    }

    const wasActive = this.subscriptions.has(id);
    if (wasActive) {
      this.stop(id);
    }

    node.stream$ = stream$ as Stream<any>;

    if (wasActive) {
      this.start(id);
    }
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  start(id: string): void {
    const node = this.nodes.get(id);
    if (!node || this.subscriptions.has(id)) return;

    const sub = node.stream$.subscribe({
      next: (value) => {
        node.meta.eventCount++;
        node.meta.lastEvent = value;
        node.meta.lastEventAt = Date.now();
      },
      error: (err) => console.error(`Stream ${id} error:`, err),
      complete: () => {
        node.meta.isActive = false;
      },
    });

    node.meta.isActive = true;
    this.subscriptions.set(id, sub);
  }

  stop(id: string): void {
    const sub = this.subscriptions.get(id);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(id);
      const node = this.nodes.get(id);
      if (node) node.meta.isActive = false;
    }
  }

  startAll(): void {
    for (const [id, node] of this.nodes) {
      if (node.kind === 'sink') {
        this.start(id);
      }
    }
  }

  stopAll(): void {
    for (const id of this.subscriptions.keys()) {
      this.stop(id);
    }
  }

  snapshot(): StreamGraphSnapshot {
    return {
      nodes: Array.from(this.nodes.values()).map((node) => ({
        id: node.id,
        kind: node.kind,
        deps: [...node.deps],
        eventCount: node.meta.eventCount,
        lastEvent: node.meta.lastEvent,
        isActive: node.meta.isActive,
      })),
    };
  }

  dispose(): void {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
    this.nodes.clear();
  }

  private assertNewId(id: string): void {
    if (this.nodes.has(id)) {
      throw new Error(`Duplicate stream node id: ${id}`);
    }
  }
}
