import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { useGraphSignal } from '../src/index';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('solid adapter: useGraphSignal', () => {
  it('returns an Accessor and updates when the node changes', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 0);

    let dispose!: () => void;
    let value!: () => number;

    createRoot((d: () => void) => {
      dispose = d;
      value = useGraphSignal<number, unknown>(graph, 'a');
    });

    expect(value()).toBe(0);

    graph.set<number>('a', 1);
    await tick();
    expect(value()).toBe(1);

    dispose();

    graph.set<number>('a', 2);
    await tick();
    expect(value()).toBe(1);
  });
});
