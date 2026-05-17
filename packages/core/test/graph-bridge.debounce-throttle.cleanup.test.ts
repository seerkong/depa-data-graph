import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';
import { GraphBridge } from '../src/stream/graph-bridge';
import { StreamGraph } from '../src/stream/stream-graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flush(): Promise<void> {
  await tick();
  await tick();
}

class CountingGraph<TRuntime> extends DataGraph<TRuntime> {
  getCalls = 0;

  override get<T>(id: string): T {
    this.getCalls += 1;
    return super.get<T>(id);
  }
}

describe('GraphBridge debounce/throttle cleanup', () => {
  it('debounce stream stops reading after unsubscribe', async () => {
    const graph = new CountingGraph(() => ({}));
    graph.addSignal('a', 0);

    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);
    bridge.signalToStreamNode<number>('a', 'a$', { debounce: 10 });

    const sub = streamGraph
      .get<number>('a$')
      .subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    sub.unsubscribe();
    await flush();

    const callsAfterStop = graph.getCalls;

    graph.set<number>('a', 1);
    await tick();

    expect(graph.getCalls).toBe(callsAfterStop);
  });

  it('throttle stream stops reading after unsubscribe', async () => {
    const graph = new CountingGraph(() => ({}));
    graph.addSignal('a', 0);

    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);
    bridge.signalToStreamNode<number>('a', 'a$', { throttle: 10 });

    const sub = streamGraph
      .get<number>('a$')
      .subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    sub.unsubscribe();
    await flush();

    const callsAfterStop = graph.getCalls;

    graph.set<number>('a', 1);
    await tick();

    expect(graph.getCalls).toBe(callsAfterStop);
  });
});
