import xs from 'xstream';
import type { Listener } from 'xstream';
import { describe, expect, it } from 'vitest';

import { StreamGraph } from '../src/stream/stream-graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('StreamGraph', () => {
  it('tracks source events and stops producer', async () => {
    const graph = new StreamGraph();

    let stopCalls = 0;
    let sourceListener!: Listener<number>;

    graph.addSource<number>('src', {
      start: (listener) => {
        sourceListener = listener;
      },
      stop: () => {
        stopCalls += 1;
      },
    });

    graph.start('src');

    const node = graph.node<number>('src');
    expect(node.meta.isActive).toBe(true);

    sourceListener.next(1);
    sourceListener.next(2);

    expect(node.meta.eventCount).toBe(2);
    expect(node.meta.lastEvent).toBe(2);

    graph.stop('src');
    await tick();

    expect(stopCalls).toBe(1);
    expect(node.meta.isActive).toBe(false);
  });

  it('startAll starts sinks and stopAll stops them', async () => {
    const graph = new StreamGraph();

    let aListener!: Listener<number>;
    let bListener!: Listener<number>;
    let stopA = 0;
    let stopB = 0;

    graph.addSource<number>('a', {
      start: (listener) => {
        aListener = listener;
      },
      stop: () => {
        stopA += 1;
      },
    });

    graph.addSource<number>('b', {
      start: (listener) => {
        bListener = listener;
      },
      stop: () => {
        stopB += 1;
      },
    });

    const values: Array<number> = [];
    graph.addSink<number>('sink', ['a', 'b'], (v) => values.push(v));

    graph.startAll();

    const sinkNode = graph.node('sink');
    expect(sinkNode.meta.isActive).toBe(true);

    aListener.next(1);
    bListener.next(2);

    expect(values).toEqual([1, 2]);

    graph.stopAll();

    for (let i = 0; i < 10; i += 1) {
      await tick();
    }

    expect(sinkNode.meta.isActive).toBe(false);
    expect(stopA).toBe(1);
    expect(stopB).toBe(1);
  });

  it('supports operator nodes', async () => {
    const graph = new StreamGraph();

    let aListener!: Listener<number>;
    let bListener!: Listener<number>;

    graph.addSource<number>('a', {
      start: (listener) => {
        aListener = listener;
      },
      stop: () => {},
    });

    graph.addSource<number>('b', {
      start: (listener) => {
        bListener = listener;
      },
      stop: () => {},
    });

    graph.addOperator<number>('sum', ['a', 'b'], (inputs) => {
      return xs
        .combine(inputs.a as any, inputs.b as any)
        .map(([a, b]) => (a as number) + (b as number));
    });

    const sums: Array<number> = [];
    graph.addSink<number>('sink', ['sum'], (v) => sums.push(v));

    graph.startAll();

    aListener.next(10);
    bListener.next(2);

    await tick();

    expect(sums).toEqual([12]);

    graph.stopAll();
    await tick();
  });

  it('replaceStream swaps stream', async () => {
    const graph = new StreamGraph();

    graph.addSource<number>('s', {
      start: (listener) => {
        listener.next(1);
        listener.complete();
      },
      stop: () => {},
    });

    graph.replaceStream('s', xs.of(2));

    const values: number[] = [];
    await new Promise<void>((resolve, reject) => {
      graph.get<number>('s').subscribe({
        next: (v) => values.push(v),
        error: (e) => reject(e),
        complete: () => resolve(),
      });
    });

    expect(values).toEqual([2]);
  });

  it('replaceStream restarts active node', async () => {
    const graph = new StreamGraph();

    let stopCalls = 0;

    graph.addSource<number>('s', {
      start: () => {},
      stop: () => {
        stopCalls += 1;
      },
    });

    graph.start('s');
    expect(graph.node('s').meta.isActive).toBe(true);

    graph.replaceStream('s', xs.never());

    await tick();

    expect(stopCalls).toBe(1);
    expect(graph.node('s').meta.isActive).toBe(true);

    graph.stop('s');
    await tick();

    expect(stopCalls).toBe(1);
    expect(graph.node('s').meta.isActive).toBe(false);
  });

  it('throws on unknown ids', () => {
    const graph = new StreamGraph();

    expect(() => graph.get('nope')).toThrow(/Unknown stream node/);
    expect(() => graph.node('nope')).toThrow(/Unknown stream node/);
    expect(() => graph.replaceStream('nope', xs.never())).toThrow(/Unknown stream node/);
  });

  it('throws on duplicate ids', () => {
    const graph = new StreamGraph();

    graph.addSource<number>('dup', { start: () => {}, stop: () => {} });
    expect(() => graph.addSource<number>('dup', { start: () => {}, stop: () => {} })).toThrow(
      /Duplicate stream node id/,
    );
  });
});
