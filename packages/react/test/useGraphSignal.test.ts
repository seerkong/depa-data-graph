import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { useGraphSignal } from '../src/index';

// Silence React act() environment warnings in React 18+.
const globalThisTyped = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
globalThisTyped.IS_REACT_ACT_ENVIRONMENT = true;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('react adapter: useGraphSignal', () => {
  it('reads the current value and re-renders on node changes', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 0);

    const seen: number[] = [];

    function Comp() {
      const value = useGraphSignal<number, unknown>(graph, 'a');
      seen.push(value);
      return null;
    }

    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Comp));
    });

    expect(seen[seen.length - 1]).toBe(0);

    await act(async () => {
      graph.set<number>('a', 1);
      await tick();
    });

    expect(seen[seen.length - 1]).toBe(1);

    await act(async () => {
      renderer.unmount();
      await tick();
    });

    // After unmount, the adapter should dispose its ViewModel subscription.
    const viewIds = Object.keys(graph.snapshot().viewDeps);
    expect(viewIds.some((id) => id.startsWith('react:signal:a:'))).toBe(false);
  });
});
