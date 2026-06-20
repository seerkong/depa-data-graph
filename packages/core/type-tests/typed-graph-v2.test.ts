import { createTypedGraph, computed, signal } from '../src/typed-graph-v2';
import type { GraphNode } from '../src/graph';

type Assert<T extends true> = T;
type AssertFalse<T extends false> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

const schema = {
  counter: signal(0),
  doubled: computed(
    ['counter'],
    (ctx: { graph: { get<T>(id: string): T } }) => ctx.graph.get<number>('counter') * 2,
  ),
} as const;

const graph = createTypedGraph(schema, () => ({ tag: 'runtime' }));

graph.set('counter', 1);
graph.set('counter', (prev: number) => prev + 1);

// Inferred updater param should be the signal value type.
graph.set('counter', (prev) => {
  const asNumber: number = prev;
  return asNumber + 1;
});

const counterValue: number = graph.get('counter');
void counterValue;

const counterPeek: number = graph.peek('counter');
void counterPeek;

const doubledValue: number = graph.get('doubled');
void doubledValue;

const doubledPeek: number = graph.peek('doubled');
void doubledPeek;

const counterNode: GraphNode<number> = graph.node('counter');
void counterNode;

const doubledNode: GraphNode<number> = graph.node('doubled');
void doubledNode;

graph.addSignal('dynamicNode', 123);

// Once added dynamically, runtime allows reads/writes; types stay on the escape hatch.
graph.set('dynamicNode', 456);

const dynamicUnknown: unknown = graph.get('dynamicNode');
void dynamicUnknown;

const dynamicNumber: number = graph.get<number>('dynamicNode');
void dynamicNumber;

const dynamicNode: GraphNode<unknown> = graph.node('dynamicNode');
void dynamicNode;

// Unknown IDs should not be treated as known schema IDs.
const _missingValue = graph.get('missing');
type _missingNotNumber = AssertFalse<IsAssignable<typeof _missingValue, number>>;

type Schema = typeof schema;
type SchemaIds = keyof Schema & string;

type WritableIds = {
  [K in keyof Schema]: Schema[K] extends { kind: 'signal' } ? K : never;
}[keyof Schema] &
  string;

type _id1 = Assert<IsAssignable<'counter', SchemaIds>>;
type _id2 = Assert<IsAssignable<'doubled', SchemaIds>>;

// Computed nodes are not writable.
type _w1 = Assert<IsAssignable<'counter', WritableIds>>;
type _w2 = Assert<IsAssignable<'doubled', WritableIds> extends false ? true : false>;
