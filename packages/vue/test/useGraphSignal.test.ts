import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { useGraphSignal } from '../src/index';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('vue adapter: useGraphSignal', () => {
  it('returns a Ref and updates when the node changes', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 0);

    const scope = effectScope();

    const state = scope.run(() => useGraphSignal<number, unknown>(graph, 'a'))!;

    expect(state.value).toBe(0);

    graph.set<number>('a', 1);
    await tick();
    expect(state.value).toBe(1);

    scope.stop();

    graph.set<number>('a', 2);
    await tick();
    expect(state.value).toBe(1);
  });

  it('reads a state-node output ref updated through a mutation', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    const input = graph.addSignal('input', 1);
    const state = graph.addSignalDrivenStateSignalNode({
      input: input.ref,
      initial: 0,
      reducer: (current, value) => current + value,
      mutations: { add: (current, by: number) => current + by },
    });
    const scope = effectScope();
    const value = scope.run(() => useGraphSignal<number, unknown>(graph, state.output))!;

    state.mutations.add(2);
    await tick();
    expect(value.value).toBe(3);

    scope.stop();
    graph.dispose();
  });
});
