import { describe, expect, it } from 'vitest';

import { DataGraph } from 'depa-data-graph-core';
import { bindElement } from '../src/index';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('vanilla adapter: bindElement', () => {
  it('syncs the element property to the node value', async () => {
    const graph = new DataGraph<unknown>(() => ({}));
    graph.addSignal('a', 0);

    const el = { textContent: '' } as { textContent: string };
    const stop = bindElement(graph, 'a', el, { property: 'textContent' });

    expect(el.textContent).toBe('0');

    graph.set<number>('a', 1);
    await tick();
    expect(el.textContent).toBe('1');

    stop();

    graph.set<number>('a', 2);
    await tick();
    expect(el.textContent).toBe('1');
  });
});
