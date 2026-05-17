import { DataGraph, asTypedGraph, defineModel, types } from '../src/index';

const MODEL = defineModel({
  counter: types.number(),
  text: types.string(),
  maybe: types.nullable(types.string()),
} as const);

const graph = asTypedGraph(new DataGraph(() => ({})), MODEL);

graph.addSignal('counter', 0);

graph.set('counter', 1);
graph.set('counter', (prev) => prev + 1);

const counterValue: number = graph.get('counter');
void counterValue;

graph.addSignal('text', '');
graph.set('text', 'hi');

const textValue: string = graph.get('text');
void textValue;

graph.addSignal('maybe', null as string | null);
graph.set('maybe', null);
graph.set('maybe', 'ok');

// @ts-expect-error unknown id
graph.get('missing');

// @ts-expect-error wrong value type
graph.set('counter', 'nope');

// @ts-expect-error wrong updater signature
graph.set('counter', (prev: string) => prev);
