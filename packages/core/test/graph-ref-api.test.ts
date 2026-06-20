import { describe, expect, it } from 'vitest';

import { buildGraphFromJson, createCodeGraphBuilder } from '../src/graph-builders';
import { DataGraph } from '../src/graph';
import { defineGraphModule, input, internal, mountGraph, output, state } from '../src/module-identity';

describe('DataGraph ref-first API', () => {
  it('supports get/set/node with mounted refs', () => {
    const graph = new DataGraph(() => ({}));
    const counterModule = mountGraph(
      defineGraphModule('counter', {
        state: {
          count: state<number>(),
        },
        outputs: {
          doubled: output<number>(),
        },
      } as const),
      { scope: 'demo/main' },
    );

    graph.addSignal(counterModule.state.count, 1);
    graph.addComputed(counterModule.outputs.doubled, [counterModule.state.count], (ctx) => {
      return ctx.graph.get(counterModule.state.count) * 2;
    });

    expect(graph.get(counterModule.state.count)).toBe(1);
    expect(graph.get(counterModule.outputs.doubled)).toBe(2);

    graph.set(counterModule.state.count, 4);

    expect(graph.get(counterModule.outputs.doubled)).toBe(8);
    expect(graph.node(counterModule.state.count).id).toBe('demo/main::counter.state.count');
  });

  it('supports builder deps and outputs declared with refs while preserving string compatibility', () => {
    const graph = new DataGraph(() => ({}));
    const builder = createCodeGraphBuilder(graph);
    const stage = mountGraph(
      defineGraphModule('stage', {
        state: {
          lexicalSeq: state<number>(),
          syntacticSeq: state<number>(),
        },
        outputs: {
          semanticSeq: output<number>(),
        },
      } as const),
      { scope: 'agent/main' },
    );

    builder
      .signal(stage.state.lexicalSeq, 0)
      .signal(stage.state.syntacticSeq, 0)
      .signal('legacy/count', 2)
      .computed(stage.outputs.semanticSeq, [stage.state.lexicalSeq, 'legacy/count'], (ctx) => {
        return ctx.graph.get(stage.state.lexicalSeq) + ctx.graph.get<number>('legacy/count');
      })
      .processor(
        'processor/promote',
        [stage.outputs.semanticSeq],
        [stage.state.syntacticSeq],
        (ctx) => {
          ctx.graph.set(stage.state.syntacticSeq, ctx.graph.get(stage.outputs.semanticSeq));
        },
      );

    expect(graph.get(stage.outputs.semanticSeq)).toBe(2);
    expect(graph.get(stage.state.syntacticSeq)).toBe(2);

    graph.set(stage.state.lexicalSeq, 3);

    expect(graph.get(stage.outputs.semanticSeq)).toBe(5);
    expect(graph.get(stage.state.syntacticSeq)).toBe(5);
    expect(graph.get<number>('legacy/count')).toBe(2);
  });

  it('lets JSON-authored graphs resolve runtime ids through mounted module refs', async () => {
    const graph = new DataGraph(() => ({}));
    const generatedIdentity = mountGraph(
      defineGraphModule('demoJsonGraph', {
        inputs: {
          counter: input<number>(),
        },
        state: {
          counter: state<number>(),
        },
        outputs: {
          counter: output<number>(),
          doubled: output<number>(),
          fetchUser_result: output<string>(),
          fetchUser_loading: output<boolean>(),
          fetchUser_error: output<string | null>(),
        },
        internals: {
          fetchUser: internal<void>(),
        },
      } as const),
      { scope: 'demo/runtime' },
    );

    buildGraphFromJson(
      graph,
      {
        version: 1,
        nodes: [
          { kind: 'signal', id: 'counter', initial: 2, flags: { in: true } },
          { kind: 'computed', id: 'doubled', deps: ['counter'], logicKey: 'double', flags: { out: true } },
          { kind: 'async', id: 'fetchUser', deps: ['counter'], initial: '', logicKey: 'fetchUser', flags: { out: true } },
        ],
      },
      {
        computed: {
          double: (ctx) => ctx.graph.get(generatedIdentity.state.counter) * 2,
        },
        processor: {},
        consumer: {},
        async: {
          fetchUser: {
            params: (ctx) => [ctx.graph.get(generatedIdentity.state.counter)],
            task: async (counter) => `user-${counter}`,
          },
        },
      },
      {
        identityMap: {
          counter: generatedIdentity.state.counter,
          doubled: generatedIdentity.outputs.doubled,
          fetchUser: generatedIdentity.internals.fetchUser,
          'fetchUser/result': generatedIdentity.outputs.fetchUser_result,
          'fetchUser/loading': generatedIdentity.outputs.fetchUser_loading,
          'fetchUser/error': generatedIdentity.outputs.fetchUser_error,
        },
        publicPorts: {
          inputs: {
            counter: generatedIdentity.inputs.counter,
          },
          outputs: {
            counter: generatedIdentity.outputs.counter,
          },
        },
      },
    );

    expect(graph.get(generatedIdentity.state.counter)).toBe(2);
    expect(graph.get(generatedIdentity.inputs.counter)).toBe(2);
    expect(graph.get(generatedIdentity.outputs.counter)).toBe(2);
    expect(graph.get(generatedIdentity.outputs.doubled)).toBe(4);

    graph.set(generatedIdentity.inputs.counter, 5);

    expect(graph.get(generatedIdentity.state.counter)).toBe(5);
    expect(graph.get(generatedIdentity.inputs.counter)).toBe(5);
    expect(graph.get(generatedIdentity.outputs.counter)).toBe(5);
    expect(graph.get(generatedIdentity.outputs.doubled)).toBe(10);

    await Promise.resolve();

    expect(graph.get(generatedIdentity.outputs.fetchUser_loading)).toBe(false);
    expect(graph.get(generatedIdentity.outputs.fetchUser_result)).toBe('user-5');
    expect(graph.get(generatedIdentity.outputs.fetchUser_error)).toBeNull();
    expect(graph.node(generatedIdentity.outputs.fetchUser_result).id).toBe(
      'demo/runtime::demoJsonGraph.outputs.fetchUser_result',
    );
  });
});
