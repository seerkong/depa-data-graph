import {
  createTypedGraph,
  createStateNodeSchemaBuilder,
  computed,
  signal,
  signalDrivenStateSignal,
  stream,
  streamDrivenStateStream,
} from '../src/typed-graph-v2';
import type { GraphNode, SignalNodeRef, StreamNodeRef } from '../src/graph';

type Assert<T extends true> = T;
type AssertFalse<T extends false> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

const schema = {
  counter: signal(0),
  doubled: computed(
    ['counter'],
    (rt: { graph: { get<T>(id: string): T } }) => rt.graph.get<number>('counter') * 2,
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

const stateGraph = createTypedGraph(
  {
    input: signal(1),
    events: stream<number>({ start: () => {}, stop: () => {} }),
    current: signalDrivenStateSignal({
      input: 'input',
      initial: 0,
      reducer: (state, input: number) => state + input,
      mutations: { add: (state: number, amount: number) => state + amount },
    }),
    timeline: streamDrivenStateStream({
      input: 'events',
      initial: [] as number[],
      reducer: (state, input: number) => [...state, input],
    }),
  } as const,
  () => ({}),
);

const currentOutput: SignalNodeRef<number, false> = stateGraph.nodes.current.output;
const timelineOutput: StreamNodeRef<number[]> = stateGraph.nodes.timeline.output;
const addResult: number = stateGraph.nodes.current.mutations.add(2);
void currentOutput;
void timelineOutput;
void addResult;

type StateRuntime = { step: number };
const actionStateNodes = createStateNodeSchemaBuilder<StateRuntime>();

const actionStateGraph = createTypedGraph(
  {
    signalInput: signal(1),
    streamInputA: stream<number>({ start: () => {}, stop: () => {} }),
    streamInputB: stream<number>({ start: () => {}, stop: () => {} }),
    signalSignal: actionStateNodes.signalDrivenStateSignal({
      input: 'signalInput',
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state: number, amount: number) => state + amount },
      actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
    }),
    signalStream: actionStateNodes.signalDrivenStateStream({
      input: 'signalInput',
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state: number, amount: number) => state + amount },
      actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
    }),
    streamSignal: actionStateNodes.streamDrivenStateSignal({
      input: 'streamInputA',
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state: number, amount: number) => state + amount },
      actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
    }),
    streamStream: actionStateNodes.streamDrivenStateStream({
      input: 'streamInputB',
      initial: 0,
      reducer: (state, input) => state + input,
      mutations: { add: (state: number, amount: number) => state + amount },
      actions: (rt) => ({
        addRuntimeStep: (multiplier: number) => ({
          state: rt.mutations.add(rt.bizRuntime.step * multiplier),
          current: rt.getState(),
        }),
      }),
    }),
  } as const,
  () => ({ step: 2 }),
);

const signalSignalAction: number = actionStateGraph.nodes.signalSignal.actions.addRuntimeStep(2);
const signalStreamAction: number = actionStateGraph.nodes.signalStream.actions.addRuntimeStep(2);
const streamSignalAction: number = actionStateGraph.nodes.streamSignal.actions.addRuntimeStep(2);
const streamStreamAction: { state: number; current: number } =
  actionStateGraph.nodes.streamStream.actions.addRuntimeStep(2);
void signalSignalAction;
void signalStreamAction;
void streamSignalAction;
void streamStreamAction;
