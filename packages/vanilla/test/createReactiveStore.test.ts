import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { createReactiveStore } from '../src/index';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('vanilla adapter: createReactiveStore', () => {
  it('allows subscribing to a set of node ids', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 1);
    graph.addSignal('b', 2);

    const store = createReactiveStore(graph, ['a', 'b'] as const);

    const seen: Array<{ a: number; b: number }> = [];
    const stop = store.subscribe((value) => {
      seen.push({ a: value.a as number, b: value.b as number });
    });

    expect(seen[0]).toEqual({ a: 1, b: 2 });

    graph.set<number>('a', 10);
    await tick();
    expect(seen[seen.length - 1]).toEqual({ a: 10, b: 2 });

    stop();

    graph.set<number>('b', 20);
    await tick();
    expect(seen[seen.length - 1]).toEqual({ a: 10, b: 2 });
  });
});
