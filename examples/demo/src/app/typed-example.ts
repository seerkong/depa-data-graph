import {
  DataGraph,
  asTypedGraph,
  computed,
  createTypedGraph,
  defineModel,
  signal,
  types,
} from 'depa-data-graph-core';

// Small, non-executed examples showing both typing approaches.

export const DEMO_MODEL = defineModel({
  counter: types.number(),
  name: types.string(),
  error: types.nullable(types.string()),
} as const);

export function createTypedModelExample() {
  const runtime = {} as { graph: DataGraph<unknown> };
  const graph = new DataGraph(() => runtime);
  runtime.graph = graph;

  const typed = asTypedGraph(graph, DEMO_MODEL);
  typed.addSignal('counter', 0);
  typed.addSignal('name', 'world');
  typed.addSignal('error', null);

  typed.set('counter', 1);
  const counter = typed.get('counter'); // number

  return { typed, counter };
}

export function createSchemaTypedGraphExample() {
  const runtime = {} as Record<string, never>;

  const graph = createTypedGraph(
    {
      counter: signal(0),
      doubled: computed(['counter'], (ctx) => ctx.graph.get<number>('counter') * 2),
    } as const,
    () => runtime,
  );

  graph.set('counter', 2);
  return graph.get('doubled');
}
