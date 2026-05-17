import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('computed laziness', () => {
  it('does not run until read', async () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 0);

    let calls = 0;

    graph.addComputed<number>('c', ['a'], (ctx) => {
      calls += 1;
      return ctx.get<number>('a') * 2;
    });

    expect(calls).toBe(0);

    graph.set<number>('a', 1);
    await tick();

    expect(calls).toBe(0);

    expect(graph.get<number>('c')).toBe(2);
    expect(calls).toBe(1);

    graph.set<number>('a', 2);
    await tick();

    expect(calls).toBe(1);

    expect(graph.get<number>('c')).toBe(4);
    expect(calls).toBe(2);
  });
});
