import { describe, expect, it } from 'vitest';

import {
  computed,
  createStateNodeSchemaBuilder,
  createTypedGraph,
  signal,
  stream,
} from '../src/typed-graph-v2';

describe('createTypedGraph (schema-first)', () => {
  it('builds signals and computeds from schema', () => {
    const graph = createTypedGraph(
      {
        counter: signal(1),
        doubled: computed(['counter'], (rt) => rt.graph.get<number>('counter') * 2),
      } as const,
      () => ({ tag: 'runtime' }),
    );

    expect(graph.get('counter')).toBe(1);
    expect(graph.get('doubled')).toBe(2);

    graph.set('counter', 2);
    expect(graph.get('doubled')).toBe(4);
  });

  it('builds protocol-aware refs and callable state-node facades from schema', () => {
    type Runtime = { step: number };
    const stateNodes = createStateNodeSchemaBuilder<Runtime>();
    const graph = createTypedGraph(
      {
        input: signal(2),
        events: stream<number>({
          start: (listener) => listener.next(4),
          stop: () => {},
        }),
        events2: stream<number>({
          start: (listener) => listener.next(4),
          stop: () => {},
        }),
        signalSignal: stateNodes.signalDrivenStateSignal({
          input: 'input',
          initial: 0,
          reducer: (state, input: number) => state + input,
          mutations: { add: (state, amount: number) => state + amount },
          actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
        }),
        signalStream: stateNodes.signalDrivenStateStream({
          input: 'input',
          initial: 0,
          reducer: (state, input: number) => state + input,
          mutations: { add: (state, amount: number) => state + amount },
          actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
        }),
        streamSignal: stateNodes.streamDrivenStateSignal({
          input: 'events2',
          initial: 0,
          reducer: (state, input: number) => state + input,
          mutations: { add: (state, amount: number) => state + amount },
          actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
        }),
        streamStream: stateNodes.streamDrivenStateStream({
          input: 'events',
          initial: 0,
          reducer: (state, input: number) => state + input,
          mutations: { add: (state, amount: number) => state + amount },
          actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
        }),
      } as const,
      () => ({ step: 3 }),
    );

    expect(graph.nodes.signalSignal.mutations.add(3)).toBe(5);
    expect(graph.get(graph.nodes.signalSignal.output)).toBe(5);
    expect(graph.nodes.signalSignal.actions.addRuntimeStep(2)).toBe(11);
    expect(graph.nodes.signalStream.getState()).toBe(2);
    expect(graph.nodes.signalStream.actions.addRuntimeStep(2)).toBe(8);
    expect(graph.nodes.streamSignal.getState()).toBe(4);
    expect(graph.nodes.streamSignal.actions.addRuntimeStep(2)).toBe(10);
    expect(graph.nodes.streamStream.getState()).toBe(4);
    expect(graph.nodes.streamStream.actions.addRuntimeStep(2)).toBe(10);
  });
});
