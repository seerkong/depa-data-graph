import { effect } from 'alien-signals';

import {
  createCodeGraphBuilder,
  DataGraph,
  defineGraphModule,
  input,
  internal,
  mountGraph,
  output,
  state,
} from 'depa-data-graph-core';

import { MODEL, type DemoActorId, type DemoRuntime } from '../runtime';

const ACTOR_SUBGRAPH_MODULE = defineGraphModule('actorSubgraph', {
  inputs: {
    mainPlus300: input<number>(),
    mainTimes10: input<number>(),
  },
  state: {
    offset: state<number>(),
  },
  outputs: {
    plusOffset: output<number>(),
    sumMain: output<number>(),
    label: output<string>(),
  },
  internals: {
    makeLabel: internal<void>(),
  },
} as const);

export function getActorSubgraphRefs(actorId: DemoActorId) {
  return mountGraph(ACTOR_SUBGRAPH_MODULE, { scope: `actor/${actorId}` });
}

export function createActorSubgraph(
  runtime: DemoRuntime,
  actorId: DemoActorId,
): DataGraph<DemoRuntime> {
  const graph = new DataGraph<DemoRuntime>(() => runtime);
  const b = createCodeGraphBuilder(graph);
  const refs = getActorSubgraphRefs(actorId);

  const offset = actorOffset(actorId);

  b.signal(refs.inputs.mainPlus300, 0, { in: true, out: true })
    .signal(refs.inputs.mainTimes10, 0, { in: true, out: true })
    .signal(refs.state.offset, offset, { in: true, out: true })
    .computed(
      refs.outputs.plusOffset,
      [refs.inputs.mainPlus300, refs.state.offset],
      (rt) => {
        const v = rt.graph.get(refs.inputs.mainPlus300);
        const k = rt.graph.get(refs.state.offset);
        return v + k;
      },
      { out: true, computed: true },
    )
    .computed(
      refs.outputs.sumMain,
      [refs.inputs.mainPlus300, refs.inputs.mainTimes10],
      (rt) => {
        const mainPlus300 = rt.graph.get(refs.inputs.mainPlus300);
        const mainTimes10 = rt.graph.get(refs.inputs.mainTimes10);
        return mainPlus300 + mainTimes10;
      },
      { out: true, computed: true },
    )
    .signal(refs.outputs.label, '', { out: true, computed: true })
    .processor(
      refs.internals.makeLabel,
      [refs.outputs.plusOffset, refs.outputs.sumMain],
      [refs.outputs.label],
      (rt) => {
        const plusOffset = rt.graph.get(refs.outputs.plusOffset);
        const sum = rt.graph.get(refs.outputs.sumMain);
        rt.graph.set(
          refs.outputs.label,
          `${actorId} subgraph: plusOffset=${plusOffset}, sumMain=${sum}`,
        );
      },
      { computed: true },
    );

  graph.addCleanup(
    effect(() => {
      const mainPlus300 = runtime.graph.get<number>(MODEL.plus300);
      graph.set(refs.inputs.mainPlus300, mainPlus300);
    }),
  );

  graph.addCleanup(
    effect(() => {
      const times10 = runtime.graph.get<number>('manual/counterTimes10');
      graph.set(refs.inputs.mainTimes10, times10);
    }),
  );

  return graph;
}

function actorOffset(actorId: DemoActorId): number {
  if (actorId === 'vanilla') {
    return 1;
  }
  if (actorId === 'vue') {
    return 2;
  }
  if (actorId === 'react') {
    return 3;
  }
  return 4;
}
