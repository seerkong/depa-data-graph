import { describe, expect, it, vi } from 'vitest';

import { DataGraph } from '../src/graph';
import { persistPlugin } from '../src/plugins/persist';

type Runtime = {
  tag: string;
};

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('persistPlugin', () => {
  it('persists configured keys to storage on set', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const storage = createMemoryStorage();

    graph.use(persistPlugin({ storage, keys: ['counter'] }));
    graph.set('counter', 10);

    expect(storage.getItem('DataGraph')).toBe(JSON.stringify({ counter: 10 }));
  });

  it('debounces writes when debounce is configured', () => {
    vi.useFakeTimers();

    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const storage = createMemoryStorage();
    const setSpy = vi.spyOn(storage, 'setItem');

    try {
      graph.use(persistPlugin({ storage, keys: ['counter'], debounce: 100 }));
      graph.set('counter', 1);
      graph.set('counter', 2);

      expect(setSpy).toHaveBeenCalledTimes(0);

      vi.advanceTimersByTime(99);
      expect(setSpy).toHaveBeenCalledTimes(0);

      vi.advanceTimersByTime(1);
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(storage.getItem('DataGraph')).toBe(JSON.stringify({ counter: 2 }));
    } finally {
      setSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
