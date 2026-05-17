import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';
import type { Setter } from '../src/graph';
import type { GraphMiddleware, MiddlewareContext } from '../src/middleware';

type Runtime = {
  tag: string;
};

describe('DataGraph middleware', () => {
  it('calls get hooks in onion order and allows afterGet to transform value', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 1);

    const calls: string[] = [];
    let seenCtx: MiddlewareContext<Runtime> | undefined;

    const a: GraphMiddleware<Runtime> = {
      name: 'a',
      beforeGet: (id, ctx) => {
        calls.push(`a beforeGet ${id}`);
        seenCtx = ctx;
      },
      afterGet: <T>(id: string, value: T, ctx: MiddlewareContext<Runtime>) => {
        calls.push(`a afterGet ${id}`);
        seenCtx = seenCtx ?? ctx;
        if (typeof value === 'number') {
          return (value + 3) as unknown as T;
        }
        return value;
      },
    };

    const b: GraphMiddleware<Runtime> = {
      name: 'b',
      beforeGet: (id) => {
        calls.push(`b beforeGet ${id}`);
      },
      afterGet: <T>(id: string, value: T) => {
        calls.push(`b afterGet ${id}`);
        if (typeof value === 'number') {
          return (value * 2) as unknown as T;
        }
        return value;
      },
    };

    graph.use(a);
    graph.use(b);

    expect(graph.get<number>('counter')).toBe(5);
    expect(calls).toEqual([
      'a beforeGet counter',
      'b beforeGet counter',
      'b afterGet counter',
      'a afterGet counter',
    ]);

    expect(seenCtx?.graph).toBe(graph);
    expect(seenCtx?.runtime).toBe(runtime);
  });

  it('skips set when beforeSet returns undefined (and does not call afterSet)', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const calls: string[] = [];

    const mw: GraphMiddleware<Runtime> = {
      name: 'skip',
      beforeSet: (id) => {
        calls.push(`beforeSet ${id}`);
        return undefined;
      },
      afterSet: (id) => {
        calls.push(`afterSet ${id}`);
      },
    };

    graph.use(mw);
    graph.set('counter', 1);

    expect(graph.node<number>('counter').get?.()).toBe(0);
    expect(calls).toEqual(['beforeSet counter']);
  });

  it('calls set hooks in onion order', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const calls: string[] = [];
    let seenCtx: MiddlewareContext<Runtime> | undefined;

    const a = {
      name: 'a',
      beforeSet: <T>(id: string, value: Setter<T>, ctx: MiddlewareContext<Runtime>) => {
        calls.push(`a beforeSet ${id}`);
        seenCtx = ctx;
        if (typeof value === 'function') {
          return value;
        }
        if (typeof value === 'number') {
          return ((value as unknown as number) + 1) as unknown as Setter<T>;
        }
        return value;
      },
      afterSet: (id) => {
        calls.push(`a afterSet ${id}`);
      },
    } satisfies GraphMiddleware<Runtime>;

    const b = {
      name: 'b',
      beforeSet: <T>(id: string, value: Setter<T>) => {
        calls.push(`b beforeSet ${id}`);
        if (typeof value === 'function') {
          return value;
        }
        if (typeof value === 'number') {
          return ((value as unknown as number) * 2) as unknown as Setter<T>;
        }
        return value;
      },
      afterSet: (id) => {
        calls.push(`b afterSet ${id}`);
      },
    } satisfies GraphMiddleware<Runtime>;

    graph.use(a);
    graph.use(b);

    graph.set('counter', 1);

    // beforeSet runs in registration order, so value is transformed as: (1 + 1) * 2 = 4.
    expect(graph.node<number>('counter').get?.()).toBe(4);
    expect(calls).toEqual([
      'a beforeSet counter',
      'b beforeSet counter',
      'b afterSet counter',
      'a afterSet counter',
    ]);

    expect(seenCtx?.graph).toBe(graph);
    expect(seenCtx?.runtime).toBe(runtime);
  });

  it('calls onNodeAdd after adding nodes', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);

    const calls: string[] = [];

    const mw: GraphMiddleware<Runtime> = {
      name: 'node-add',
      onNodeAdd: (node) => {
        calls.push(`${node.kind}:${node.id}`);
      },
    };

    graph.use(mw);
    graph.addSignal('a', 1);

    expect(calls).toEqual(['signal:a']);
  });

  it('calls onBatch start/end around batch (onion ordering)', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);
    graph.addSignal('counter', 0);

    const calls: string[] = [];

    const a: GraphMiddleware<Runtime> = {
      name: 'a',
      onBatch: (event) => {
        calls.push(`a ${event.phase}`);
      },
    };

    const b: GraphMiddleware<Runtime> = {
      name: 'b',
      onBatch: (event) => {
        calls.push(`b ${event.phase}`);
      },
    };

    graph.use(a);
    graph.use(b);

    graph.batch(() => {
      calls.push('fn');
      graph.set('counter', 1);
    });

    expect(calls).toEqual(['a start', 'b start', 'fn', 'b end', 'a end']);
  });

  it('calls onDispose when disposing graph (LIFO)', () => {
    const runtime: Runtime = { tag: 'runtime' };
    const graph = new DataGraph(() => runtime);

    const calls: string[] = [];

    const a: GraphMiddleware<Runtime> = {
      name: 'a',
      onDispose: () => {
        calls.push('a');
      },
    };

    const b: GraphMiddleware<Runtime> = {
      name: 'b',
      onDispose: () => {
        calls.push('b');
      },
    };

    graph.use(a);
    graph.use(b);

    graph.dispose();

    expect(calls).toEqual(['b', 'a']);
  });
});
