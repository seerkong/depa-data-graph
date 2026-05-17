import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ViewModel dispose', () => {
  it('disposeViewModel stops selector and clears viewDeps', async () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 0);

    let selectorCalls = 0;

    const vm$ = graph.createViewModelSignal('view/test', () => {
      selectorCalls += 1;
      return { a: graph.get<number>('a') };
    });

    expect(graph.snapshot().viewDeps['view/test']).toEqual(['a']);

    const callsAfterCreate = selectorCalls;

    graph.disposeViewModel('view/test');

    expect(graph.snapshot().viewDeps['view/test']).toBeUndefined();

    graph.set<number>('a', 1);
    await tick();

    expect(selectorCalls).toBe(callsAfterCreate);
    expect(vm$().a).toBe(0);

    const vm2$ = graph.createViewModelSignal('view/test', () => ({ a: graph.get<number>('a') }));

    expect(vm2$).not.toBe(vm$);
    expect(graph.snapshot().viewDeps['view/test']).toEqual(['a']);
  });

  it('disposeViewModel is a no-op for unknown viewId', () => {
    const graph = new DataGraph(() => ({}));

    expect(() => graph.disposeViewModel('view/missing')).not.toThrow();
  });
});
