import { Stream, Listener, Subscription } from 'xstream';
import { DataGraph, Setter } from '../graph';
import { watch } from '../watch';
import { StreamGraph } from './stream-graph';

export interface BridgeOptions {
  debounce?: number;
  throttle?: number;
}

export class GraphBridge<TRuntime> {
  private cleanups: Array<() => void> = [];

  constructor(
    private dataGraph: DataGraph<TRuntime>,
    private streamGraph: StreamGraph,
  ) {}

  signalToStreamNode<T>(signalId: string, streamId: string, options: BridgeOptions = {}): void {
    const { debounce, throttle } = options;

    let stopWatch: (() => void) | null = null;

    this.dataGraph.addCleanup(() => {
      stopWatch?.();
      stopWatch = null;
    });

    this.streamGraph.addSource<T>(streamId, {
      start: (listener: Listener<T>) => {
        stopWatch?.();
        stopWatch = null;

        try {
          listener.next(this.dataGraph.peek(signalId));
        } catch {
          // Intentionally ignore: the signal might be missing during startup.
        }

        try {
          stopWatch = watch(
            () => this.dataGraph.get<T>(signalId),
            (value) => listener.next(value),
          );
        } catch (err) {
          listener.error(err);
        }
      },
      stop: () => {
        stopWatch?.();
        stopWatch = null;
      },
    });

    if (debounce || throttle) {
      const original$ = this.streamGraph.get<T>(streamId);
      let modified$ = original$;

      if (debounce) {
        modified$ = modified$.compose((s) => {
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          let sub: Subscription | null = null;

          return Stream.create<T>({
            start: (listener: Listener<T>) => {
              sub = s.subscribe({
                next: (v) => {
                  if (timeoutId) clearTimeout(timeoutId);
                  timeoutId = setTimeout(() => listener.next(v), debounce);
                },
                error: (e) => listener.error(e),
                complete: () => listener.complete(),
              });
            },
            stop: () => {
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
              sub?.unsubscribe();
              sub = null;
            },
          });
        });
      }

      if (throttle) {
        modified$ = modified$.compose((s) => {
          let sub: Subscription | null = null;

          return Stream.create<T>({
            start: (listener: Listener<T>) => {
              let lastTime = 0;
              sub = s.subscribe({
                next: (v) => {
                  const now = Date.now();
                  if (now - lastTime >= throttle) {
                    lastTime = now;
                    listener.next(v);
                  }
                },
                error: (e) => listener.error(e),
                complete: () => listener.complete(),
              });
            },
            stop: () => {
              sub?.unsubscribe();
              sub = null;
            },
          });
        });
      }

      this.streamGraph.replaceStream(streamId, modified$);
    }
  }

  streamNodeToSignal<T>(
    streamId: string,
    signalId: string,
    initial: T,
    reducer?: (prev: T, event: any) => T,
  ): void {
    try {
      this.dataGraph.node(signalId);
    } catch {
      this.dataGraph.addSignal(signalId, initial);
    }

    const sinkId = `__bridge_n2s_${signalId}_${Date.now()}`;
    this.streamGraph.addSink(sinkId, [streamId], (event) => {
      if (reducer) {
        this.dataGraph.set(signalId, ((prev: T) => reducer(prev, event)) as Setter<T>);
      } else {
        this.dataGraph.set(signalId, event as Setter<T>);
      }
    });

    this.streamGraph.start(sinkId);
  }

  streamToSignal<T>(
    stream$: Stream<T>,
    signalId: string,
    initial: T,
    reducer?: (prev: T, event: any) => T,
  ): () => void {
    try {
      this.dataGraph.node(signalId);
    } catch {
      this.dataGraph.addSignal(signalId, initial);
    }

    const subscription = stream$.subscribe({
      next: (event) => {
        if (reducer) {
          this.dataGraph.set(signalId, ((prev: T) => reducer(prev, event)) as Setter<T>);
        } else {
          this.dataGraph.set(signalId, event as Setter<T>);
        }
      },
      error: (err) => console.error(`Bridge stream error for ${signalId}:`, err),
      complete: () => {},
    });

    const cleanup = () => subscription.unsubscribe();
    this.cleanups.push(cleanup);
    this.dataGraph.addCleanup(cleanup);

    return cleanup;
  }

  signalToStream<T>(signalId: string, options: { emitCurrent?: boolean } = {}): Stream<T> {
    const { emitCurrent = true } = options;

    let stopWatch: (() => void) | null = null;

    this.dataGraph.addCleanup(() => {
      stopWatch?.();
      stopWatch = null;
    });

    return Stream.create<T>({
      start: (listener: Listener<T>) => {
        stopWatch?.();
        stopWatch = null;

        if (emitCurrent) {
          try {
            listener.next(this.dataGraph.peek(signalId));
          } catch {
            // Intentionally ignore: the signal might be missing during startup.
          }
        }

        try {
          stopWatch = watch(
            () => this.dataGraph.get<T>(signalId),
            (value) => listener.next(value),
          );
        } catch (err) {
          listener.error(err);
        }
      },
      stop: () => {
        stopWatch?.();
        stopWatch = null;
      },
    });
  }

  dispose(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
  }
}
