import { describe, expect, it, vi } from 'vitest';

import { DataGraph } from '../src/graph';
import { loggerPlugin } from '../src/plugins/logger';

type Runtime = {
  tag: string;
};

describe('loggerPlugin', () => {
  it('logs on set with default prefix', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {
      // no-op
    });

    try {
      graph.use(loggerPlugin({ level: 'debug' }));
      graph.set('counter', 10);

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy.mock.calls[0]?.[0]).toBe('[DataGraph] counter = 10');
    } finally {
      debugSpy.mockRestore();
    }
  });
});
