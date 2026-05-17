import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { useGraph } from '../src/index';

// Silence React act() environment warnings in React 18+.
const globalThisTyped = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
globalThisTyped.IS_REACT_ACT_ENVIRONMENT = true;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('react adapter: useGraph', () => {
  it('returns a record of node values and re-renders when any changes', async () => {
    const graph = new DataGraph(() => ({}));
    graph.addSignal('a', 1);
    graph.addSignal('b', 2);

    const seen: Array<{ a: number; b: number }> = [];

    function Comp() {
      const vm = useGraph(graph, ['a', 'b'] as const);
      seen.push({ a: vm.a as number, b: vm.b as number });
      return null;
    }

    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Comp));
    });

    expect(seen[seen.length - 1]).toEqual({ a: 1, b: 2 });

    await act(async () => {
      graph.set<number>('a', 10);
      await tick();
    });

    expect(seen[seen.length - 1]).toEqual({ a: 10, b: 2 });

    await act(async () => {
      graph.set<number>('b', 20);
      await tick();
    });

    expect(seen[seen.length - 1]).toEqual({ a: 10, b: 20 });

    await act(async () => {
      renderer.unmount();
      await tick();
    });

    const viewIds = Object.keys(graph.snapshot().viewDeps);
    expect(viewIds.some((id) => id.startsWith('react:multi:a|b:'))).toBe(false);
  });
});
