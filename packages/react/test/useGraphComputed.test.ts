import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { useGraphComputed } from '../src/index';

// Silence React act() environment warnings in React 18+.
const globalThisTyped = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
globalThisTyped.IS_REACT_ACT_ENVIRONMENT = true;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('react adapter: useGraphComputed', () => {
  it('computes derived values and re-renders on dependency changes', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 2);
    graph.addSignal('b', 3);

    const seen: number[] = [];

    function Comp() {
      const value = useGraphComputed(graph, () => graph.get<number>('a') + graph.get<number>('b'));
      seen.push(value);
      return null;
    }

    await act(async () => {
      create(React.createElement(Comp));
    });

    expect(seen[seen.length - 1]).toBe(5);

    await act(async () => {
      graph.set<number>('a', 10);
      await tick();
    });

    expect(seen[seen.length - 1]).toBe(13);
  });

  it('reflects selector changes on re-render', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 2);

    const seen: number[] = [];

    function Comp(props: { mult: number }) {
      const value = useGraphComputed(graph, () => graph.get<number>('a') * props.mult);
      seen.push(value);
      return null;
    }

    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Comp, { mult: 2 }));
    });

    expect(seen[seen.length - 1]).toBe(4);

    await act(async () => {
      renderer.update(React.createElement(Comp, { mult: 3 }));
      await tick();
    });

    expect(seen[seen.length - 1]).toBe(6);
  });
});
