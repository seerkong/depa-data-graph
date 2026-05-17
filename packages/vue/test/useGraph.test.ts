import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { useGraph } from '../src/index';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('vue adapter: useGraph', () => {
  it('returns a record of Refs and updates when any node changes', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 1);
    graph.addSignal('b', 2);

    const scope = effectScope();
    const vm = scope.run(() => useGraph(graph, ['a', 'b'] as const))!;

    expect(vm.a.value).toBe(1);
    expect(vm.b.value).toBe(2);

    graph.set<number>('a', 10);
    await tick();
    expect(vm.a.value).toBe(10);
    expect(vm.b.value).toBe(2);

    graph.set<number>('b', 20);
    await tick();
    expect(vm.a.value).toBe(10);
    expect(vm.b.value).toBe(20);

    scope.stop();

    graph.set<number>('a', 99);
    await tick();
    expect(vm.a.value).toBe(10);
  });
});
