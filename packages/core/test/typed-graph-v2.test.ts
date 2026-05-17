import { describe, expect, it } from 'vitest';

import { computed, createTypedGraph, signal } from '../src/typed-graph-v2';

describe('createTypedGraph (schema-first)', () => {
  it('builds signals and computeds from schema', () => {
    const graph = createTypedGraph(
      {
        counter: signal(1),
        doubled: computed(['counter'], (ctx) => ctx.get<number>('counter') * 2),
      } as const,
      () => ({ tag: 'runtime' }),
    );

    expect(graph.get('counter')).toBe(1);
    expect(graph.get('doubled')).toBe(2);

    graph.set('counter', 2);
    expect(graph.get('doubled')).toBe(4);
  });
});
