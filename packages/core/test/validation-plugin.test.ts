import { describe, expect, it, vi } from 'vitest';

import { DataGraph } from '../src/graph';
import { validationPlugin } from '../src/plugins/validation';

type Runtime = {
  tag: string;
};

describe('validationPlugin', () => {
  it('blocks set and warns when validation fails', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // no-op
    });

    try {
      graph.use(
        validationPlugin({
          rules: {
            counter: (v: unknown) => (typeof v === 'number' && v < 0 ? 'Cannot be negative' : null),
          },
        }),
      );

      graph.set('counter', -1);

      expect(graph.get<number>('counter')).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Cannot be negative');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('allows set when validation passes', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // no-op
    });

    try {
      graph.use(
        validationPlugin({
          rules: {
            counter: (v: unknown) => (typeof v === 'number' && v < 0 ? 'Cannot be negative' : null),
          },
        }),
      );

      graph.set('counter', 1);

      expect(graph.get<number>('counter')).toBe(1);
      expect(warnSpy).toHaveBeenCalledTimes(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
