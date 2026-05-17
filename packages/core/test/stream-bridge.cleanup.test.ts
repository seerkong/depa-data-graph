import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';
import { GraphBridge } from '../src/stream/graph-bridge';
import { signalToStream } from '../src/stream/stream-bridge';
import { StreamGraph } from '../src/stream/stream-graph';

function flushXstreamStop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class CountingGraph<TRuntime> extends DataGraph<TRuntime> {
  getCalls = 0;

  override get<T>(id: string): T {
    this.getCalls += 1;
    return super.get<T>(id);
  }
}

describe('stream bridge cleanup', () => {
  it('signalToStream does not add graph nodes across subscribe/unsubscribe', async () => {
    const graph = new DataGraph(() => ({}));
    graph.addSignal('a', 0);

    const baselineNodes = graph.snapshot().nodes.length;
    const stream$ = signalToStream(graph, 'a');

    for (let i = 0; i < 5; i += 1) {
      const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });
      sub.unsubscribe();
      await flushXstreamStop();
    }

    expect(graph.snapshot().nodes.length).toBe(baselineNodes);
  });

  it('signalToStream stops reading after unsubscribe', async () => {
    const graph = new CountingGraph(() => ({}));
    graph.addSignal('a', 0);

    const stream$ = signalToStream(graph, 'a', { emitCurrent: false });
    const sub = stream$.subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    const callsAfterStart = graph.getCalls;

    sub.unsubscribe();
    await flushXstreamStop();

    graph.set<number>('a', 1);

    expect(graph.getCalls).toBe(callsAfterStart);
  });

  it('GraphBridge.signalToStreamNode does not add graph nodes', async () => {
    const graph = new DataGraph(() => ({}));
    graph.addSignal('a', 0);

    const baselineNodes = graph.snapshot().nodes.length;

    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);

    bridge.signalToStreamNode<number>('a', 'a$');

    const sub = streamGraph
      .get<number>('a$')
      .subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    expect(graph.snapshot().nodes.length).toBe(baselineNodes);

    sub.unsubscribe();
    await flushXstreamStop();

    expect(graph.snapshot().nodes.length).toBe(baselineNodes);
  });

  it('GraphBridge.signalToStreamNode stops reading after unsubscribe', async () => {
    const graph = new CountingGraph(() => ({}));
    graph.addSignal('a', 0);

    const streamGraph = new StreamGraph();
    const bridge = new GraphBridge(graph, streamGraph);

    bridge.signalToStreamNode<number>('a', 'a$');

    const sub = streamGraph
      .get<number>('a$')
      .subscribe({ next: () => {}, error: () => {}, complete: () => {} });

    const callsAfterStart = graph.getCalls;

    sub.unsubscribe();
    await flushXstreamStop();

    graph.set<number>('a', 1);

    expect(graph.getCalls).toBe(callsAfterStart);
  });
});
