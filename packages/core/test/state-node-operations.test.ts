import { describe, expect, it } from 'vitest';

import { DataGraph, type GraphMiddleware, type StateNodeOperationRecord } from '../src';

describe('state node operations', () => {
  it('routes mutation facades and direct typed dispatch through named operations', () => {
    const graph = new DataGraph(() => ({}));
    const input = graph.addSignal('input', 0);
    const observed: StateNodeOperationRecord[] = [];
    const middleware: GraphMiddleware<object> = {
      name: 'state-operation-log',
      beforeStateOperation: (operation) => observed.push(operation),
    };
    graph.use(middleware);

    const counter = graph.addSignalDrivenStateSignalNode({
      id: 'counter',
      input: input.ref,
      initial: 0,
      reducer: (state) => state,
      mutations: {
        increment: (state, by: number) => state + by,
        replace: (_state, next: number) => next,
      },
    });

    expect(counter.mutations.increment(2)).toBe(2);
    const replace = counter.operations.mutations.replace(10);
    expect(replace).toMatchObject({
      nodeId: 'counter',
      kind: 'mutation',
      name: 'replace',
      payload: [10],
    });
    expect(counter.dispatch(replace)).toBe(10);
    expect(counter.getState()).toBe(10);
    expect(observed).toEqual([
      expect.objectContaining({ nodeId: 'counter', kind: 'mutation', name: 'increment' }),
      expect.objectContaining({ nodeId: 'counter', kind: 'mutation', name: 'replace' }),
    ]);

    expect(() =>
      counter.dispatch({
        nodeId: 'counter',
        kind: 'mutation',
        name: 'increment',
        payload: [1],
        sequence: 999,
        createdAt: Date.now(),
      } as never),
    ).toThrow(/invalid state operation/i);

    graph.dispose();
  });

  it('runs async actions with a node-scoped rt and updates only through mutations', async () => {
    const graph = new DataGraph(() => ({
      api: {
        loadCount: async (id: string) => id.length,
      },
    }));
    const input = graph.addSignal('action-input', 0);
    const counter = graph.addSignalDrivenStateSignalNode({
      id: 'action-counter',
      input: input.ref,
      initial: { count: 0, loading: false },
      reducer: (state) => state,
      mutations: {
        markLoading: (state, loading: boolean) => ({ ...state, loading }),
        replace: (state, count: number) => ({ ...state, count }),
      },
      actions: (rt) => ({
        async load(id: string) {
          expect(rt.graph.get(input.ref)).toBe(0);
          rt.mutations.markLoading(true);
          const count = await rt.bizRuntime.api.loadCount(id);
          rt.mutations.replace(count);
          rt.mutations.markLoading(false);
          return rt.getState().count;
        },
      }),
    });

    expect(await counter.actions.load('abcd')).toBe(4);
    expect(counter.getState()).toEqual({ count: 4, loading: false });
    expect(await counter.dispatch(counter.operations.actions.load('xy'))).toBe(2);
    expect(counter.getState()).toEqual({ count: 2, loading: false });

    graph.dispose();
  });

  it('emits equal-state mutations for Stream output and rejects operations after dispose', () => {
    const graph = new DataGraph(() => ({}));
    const input = graph.addSignal('stream-operation-input', 0);
    const state = graph.addSignalDrivenStateStreamNode({
      id: 'operation-stream',
      input: input.ref,
      initial: 0,
      reducer: (current) => current,
      mutations: {
        keep: (current) => current,
      },
    });
    const values: number[] = [];
    graph.stream(state.output).subscribe({
      next: (value) => values.push(value),
      error: () => {},
      complete: () => {},
    });

    state.mutations.keep();
    state.dispatch(state.operations.mutations.keep());
    expect(values).toEqual([0, 0, 0]);

    state.dispose();
    expect(() => state.mutations.keep()).toThrow(/disposed/i);
    expect(() => state.dispatch(state.operations.mutations.keep())).toThrow(/disposed/i);

    graph.dispose();
  });

  it('does not commit or emit when a mutation fails', () => {
    const graph = new DataGraph(() => ({}));
    const input = graph.addSignal('failure-input', 0);
    const state = graph.addSignalDrivenStateStreamNode({
      id: 'failure-state',
      input: input.ref,
      initial: 1,
      reducer: (current) => current,
      mutations: {
        fail: (_current) => {
          throw new Error('mutation failed');
        },
      },
    });
    const values: number[] = [];
    graph.stream(state.output).subscribe({
      next: (value) => values.push(value),
      error: () => {},
      complete: () => {},
    });

    expect(() => state.mutations.fail()).toThrow('mutation failed');
    expect(state.getState()).toBe(1);
    expect(values).toEqual([1]);

    graph.dispose();
  });
});
