import { describe, expect, it } from 'vitest';

import { buildGraphFromJson, createCodeGraphBuilder, DataGraph } from '../src';

describe('state-node graph builders', () => {
  it('builds all four state-node kinds through the Code DSL and preserves facades', () => {
    const graph = new DataGraph(() => ({ step: 3 }));
    const signalInput = graph.addSignal('signal-input', 2);
    const builder = createCodeGraphBuilder(graph);
    builder.source<number>('stream-input', {
      start: (listener) => listener.next(4),
      stop: () => {},
    });
    builder.source<number>('stream-input-2', {
      start: (listener) => listener.next(4),
      stop: () => {},
    });
    const streamInput = graph.node<number>('stream-input');
    const streamInput2 = graph.node<number>('stream-input-2');

    const signalSignal = builder.signalDrivenStateSignal({
      id: 'signal-signal',
      input: signalInput.ref,
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state, amount: number) => state + amount },
      actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
    });
    const signalStream = builder.signalDrivenStateStream({
      id: 'signal-stream',
      input: signalInput.ref,
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state, amount: number) => state + amount },
      actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
    });
    const streamSignal = builder.streamDrivenStateSignal({
      id: 'stream-signal',
      input: streamInput2.ref,
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state, amount: number) => state + amount },
      actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
    });
    const streamStream = builder.streamDrivenStateStream({
      id: 'stream-stream',
      input: streamInput.ref,
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state, amount: number) => state + amount },
      actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
    });

    expect(signalSignal.getState()).toBe(2);
    expect(signalSignal.mutations.add(5)).toBe(7);
    expect(signalSignal.actions.addRuntimeStep(2)).toBe(13);
    expect(signalStream.getState()).toBe(2);
    expect(signalStream.actions.addRuntimeStep(2)).toBe(8);
    expect(streamSignal.getState()).toBe(4);
    expect(streamSignal.actions.addRuntimeStep(2)).toBe(10);
    expect(streamStream.getState()).toBe(4);
    expect(streamStream.actions.addRuntimeStep(2)).toBe(10);
    expect(graph.snapshot().nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining([
        'signalDrivenStateSignal',
        'signalDrivenStateStream',
        'streamDrivenStateSignal',
        'streamDrivenStateStream',
      ]),
    );
  });

  it('builds JSON state nodes from registry keys and returns callable facades', () => {
    const graph = new DataGraph(() => ({ step: 2 }));
    graph.addSignal('signal-input', 1);
    graph.addSource<number>('stream-input', {
      start: (listener) => listener.next(3),
      stop: () => {},
    });
    graph.addSource<number>('stream-input-2', {
      start: (listener) => listener.next(3),
      stop: () => {},
    });
    const spec = {
      version: 1,
      nodes: [
        {
          kind: 'signalDrivenStateSignal',
          id: 'signal-signal',
          input: 'signal-input',
          initial: 0,
          reducerKey: 'sum',
          mutationsKey: 'counter',
          actionsKey: 'counter',
        },
        {
          kind: 'signalDrivenStateStream',
          id: 'signal-stream',
          input: 'signal-input',
          initial: 0,
          reducerKey: 'sum',
        },
        {
          kind: 'streamDrivenStateSignal',
          id: 'stream-signal',
          input: 'stream-input-2',
          initial: 0,
          reducerKey: 'sum',
        },
        {
          kind: 'streamDrivenStateStream',
          id: 'stream-stream',
          input: 'stream-input',
          initial: 0,
          reducerKey: 'sum',
        },
      ],
    } as const;
    const logic = {
      computed: {},
      processor: {},
      consumer: {},
      async: {},
      reducers: { sum: (state: number, input: number) => state + input },
      mutations: { counter: { add: (state: number, amount: number) => state + amount } },
      actions: {
        counter: (rt: {
          bizRuntime: { step: number };
          mutations: { add(amount: number): number };
        }) => ({ addRuntimeStep: () => rt.mutations.add(rt.bizRuntime.step) }),
      },
    };

    const built = buildGraphFromJson(graph, spec, logic);

    expect(built.stateNodes['signal-signal'].mutations.add(4)).toBe(5);
    expect(built.stateNodes['signal-signal'].actions.addRuntimeStep()).toBe(7);
    expect(built.stateNodes['signal-stream'].getState()).toBe(1);
    expect(built.stateNodes['stream-signal'].getState()).toBe(3);
    expect(built.stateNodes['stream-stream'].getState()).toBe(3);
  });
});
