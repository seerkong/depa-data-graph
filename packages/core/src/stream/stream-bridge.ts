/**
 * Stream Bridge - 将 xstream Stream 桥接到 DataGraph Signal
 * @module
 */

import { Stream, Listener } from 'xstream';
import { DataGraph, Setter } from '../graph';
import { watch } from '../watch';

export interface StreamBridgeOptions<T, S> {
  initial: S;
  reducer?: (prev: S, event: T) => S;
  resetOnComplete?: boolean;
  onError?: (error: unknown) => void;
  onComplete?: () => void;
}

/**
 * @example
 * ```ts
 * subscribeStreamToSignal(graph, 'messages', ws$, {
 *   initial: [],
 *   reducer: (prev, msg) => [...prev, msg].slice(-100)
 * });
 * ```
 */
export function subscribeStreamToSignal<TRuntime, T, S = T>(
  graph: DataGraph<TRuntime>,
  signalId: string,
  stream$: Stream<T>,
  options: StreamBridgeOptions<T, S>,
): () => void {
  const { initial, reducer, resetOnComplete, onError, onComplete } = options;

  try {
    graph.node(signalId);
  } catch {
    graph.addSignal(signalId, initial);
  }

  const subscription = stream$.subscribe({
    next: (event) => {
      if (reducer) {
        graph.set(signalId, ((prev: S) => reducer(prev, event)) as Setter<S>);
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
        graph.set(signalId, initial as Setter<S>);
      }
      onComplete?.();
    },
  });

  const unsubscribe = () => subscription.unsubscribe();
  graph.addCleanup(unsubscribe);

  return unsubscribe;
}

/**
 * @example
 * ```ts
 * const counter$ = signalToStream(graph, 'counter');
 * counter$.subscribe({ next: (v) => console.log('Counter:', v) });
 * ```
 */
export function signalToStream<TRuntime, T>(
  graph: DataGraph<TRuntime>,
  signalId: string,
  options: { emitCurrent?: boolean } = {},
): Stream<T> {
  const { emitCurrent = true } = options;

  let stopWatch: (() => void) | null = null;

  graph.addCleanup(() => {
    stopWatch?.();
    stopWatch = null;
  });

  return Stream.create<T>({
    start(listener: Listener<T>) {
      stopWatch?.();
      stopWatch = null;

      if (emitCurrent) {
        try {
          listener.next(graph.peek(signalId));
        } catch {
          // Intentionally ignore: allow streams to be created before the signal exists.
        }
      }

      try {
        stopWatch = watch(
          () => graph.get<T>(signalId),
          (value) => listener.next(value),
        );
      } catch (err) {
        listener.error(err);
      }
    },
    stop() {
      stopWatch?.();
      stopWatch = null;
    },
  });
}

/**
 * @example
 * ```ts
 * const manager = new StreamBridgeManager(graph);
 * manager
 *   .subscribe('ws', ws$, 'wsMessages', { initial: [], reducer: (p, m) => [...p, m] })
 *   .subscribe('ai', ai$, 'aiContent', { initial: '', reducer: (p, c) => p + c });
 * manager.dispose();
 * ```
 */
export class StreamBridgeManager<TRuntime> {
  private subscriptions = new Map<string, () => void>();

  constructor(private graph: DataGraph<TRuntime>) {}

  subscribe<T, S = T>(
    id: string,
    stream$: Stream<T>,
    signalId: string,
    options: StreamBridgeOptions<T, S>,
  ): this {
    this.unsubscribe(id);
    const unsub = subscribeStreamToSignal(this.graph, signalId, stream$, options);
    this.subscriptions.set(id, unsub);
    return this;
  }

  unsubscribe(id: string): this {
    const unsub = this.subscriptions.get(id);
    if (unsub) {
      unsub();
      this.subscriptions.delete(id);
    }
    return this;
  }

  has(id: string): boolean {
    return this.subscriptions.has(id);
  }

  keys(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  dispose(): void {
    for (const unsub of this.subscriptions.values()) {
      unsub();
    }
    this.subscriptions.clear();
  }
}
