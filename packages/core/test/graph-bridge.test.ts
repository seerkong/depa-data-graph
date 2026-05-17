import xs from 'xstream';
import type { Listener } from 'xstream';
import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';
import { GraphBridge } from '../src/stream/graph-bridge';
import { StreamGraph } from '../src/stream/stream-graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushStops(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await tick();
  }
}

describe('GraphBridge', () => {
  it('streamNodeToSignal updates signal via sink', async () => {
    const graph = new DataGraph(() => ({}));
    const streamGraph = new StreamGraph();

    let sourceListener!: Listener<number>;

    streamGraph.addSource<number>('a$', {
      start: (listener) => {
        sourceListener = listener;
      },
      stop: () => {},
    });

    const bridge = new GraphBridge(graph, streamGraph);

    bridge.streamNodeToSignal<number>('a$', 'sum', 0, (prev, event) => prev + event);

    sourceListener.next(1);
    sourceListener.next(2);

    expect(graph.get<number>('sum')).toBe(3);

    streamGraph.stopAll();
    await flushStops();
  });

  it('streamToSignal reduces stream events into a signal', async () => {
    const graph = new DataGraph(() => ({}));
    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);

    const cleanup = bridge.streamToSignal(xs.of(1, 2, 3), 'total', 0, (prev, e) => prev + e);

    expect(graph.get<number>('total')).toBe(6);

    cleanup();
    await flushStops();
  });

  it('streamToSignal without reducer assigns last event', async () => {
    const graph = new DataGraph(() => ({}));
    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);

    const cleanup = bridge.streamToSignal(xs.of('a', 'b'), 's', '', undefined);

    expect(graph.get<string>('s')).toBe('b');

    cleanup();
    await flushStops();
  });

  it('signalToStream reflects signal changes', async () => {
    const graph = new DataGraph(() => ({}));
    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);

    graph.addSignal('a', 0);

    const values: number[] = [];
    const sub = bridge.signalToStream<number>('a', { emitCurrent: false }).subscribe({
      next: (v) => values.push(v),
      error: () => {},
      complete: () => {},
    });

    graph.set<number>('a', 1);
    await tick();

    graph.set<number>('a', 2);
    await tick();

    sub.unsubscribe();
    await flushStops();

    expect(values).toEqual([1, 2]);
  });

  it('dispose unsubscribes managed subscriptions', async () => {
    const graph = new DataGraph(() => ({}));
    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);

    let stopCalls = 0;

    const never$ = xs.create<number>({
      start: () => {},
      stop: () => {
        stopCalls += 1;
      },
    });

    bridge.streamToSignal(never$, 's', 0);

    bridge.dispose();
    await flushStops();

    expect(stopCalls).toBe(1);
  });
});
