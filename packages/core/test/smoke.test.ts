import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';

describe('DataGraph (smoke)', () => {
  it('supports signal + computed updates', () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 1);
    graph.addComputed('b', ['a'], (rt) => rt.graph.get<number>('a') * 2);

    expect(graph.get<number>('b')).toBe(2);

    graph.set<number>('a', 2);
    expect(graph.get<number>('b')).toBe(4);
  });
});
