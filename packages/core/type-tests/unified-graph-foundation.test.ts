import type { Stream } from 'xstream';

import { DataGraph, type SignalNodeRef, type StreamNodeRef } from '../src';

type Assert<T extends true> = T;
type IsAssignable<T, U> = T extends U ? true : false;

const graph = new DataGraph(() => ({}));
const signal = graph.addSignal('count', 0);
const computed = graph.addComputed('doubled', [signal.ref], (rt) => rt.graph.get(signal.ref) * 2);
const processed = graph.addSignal('processed', 0);
graph.addProcessor('processor', [computed.ref], [processed.ref], (rt) => {
  rt.graph.set(processed.ref, rt.graph.get(computed.ref));
});
graph.addConsumer('consumer', [processed.ref], (rt) => {
  rt.graph.get(processed.ref);
});
graph.addAsync('async', [processed.ref], {
  params: (rt) => [rt.graph.get(processed.ref)] as const,
  task: async (value) => value,
  initial: 0,
});
const source = graph.addSource<number>('events', { start: () => {}, stop: () => {} });
const signalEvents = graph.addSignalToStream<number>('count-events', signal.ref);
const latestEvent = graph.addStreamToSignal(
  'latest-event',
  source.ref,
  0,
  (_state, value) => value,
);
const mapped = graph.addOperator<number>('mapped-events', [source.ref], (inputs) =>
  inputs.events.map((value) => (value as number) + 1),
);

const signalRef: SignalNodeRef<number, true> = signal.ref;
const sourceRef: StreamNodeRef<number> = source.ref;
const mappedRef: StreamNodeRef<number> = mapped.ref;
const values: Stream<number> = graph.stream(mappedRef);
const signalValues: Stream<number> = graph.stream(signalEvents.ref);
const latest: number = graph.get(latestEvent.ref);

// Protocol is part of the public read boundary; NodeRef remains the legacy
// escape hatch only because it has no runtime protocol marker.
// @ts-expect-error Signals cannot be read as Streams.
graph.stream(signalRef);
// @ts-expect-error Computed values retain Signal protocol and cannot become Streams.
graph.stream(computed.ref);
// @ts-expect-error Streams cannot be read as current Signals.
graph.get(sourceRef);
// @ts-expect-error A Stream ref cannot name a writable Signal node.
graph.addSignal(sourceRef, 0);
// @ts-expect-error Signal computations only declare Signal/legacy dependencies.
graph.addComputed('invalid-computed', [sourceRef], () => 0);
// @ts-expect-error Processors only declare Signal/legacy dependencies.
graph.addProcessor('invalid-processor', [sourceRef], [processed.ref], () => {});
// @ts-expect-error Processor outputs must use Signal/legacy identities.
graph.addProcessor('invalid-processor-output', [signalRef], [sourceRef], () => {});
// @ts-expect-error Consumers only declare Signal/legacy dependencies.
graph.addConsumer('invalid-consumer', [sourceRef], () => {});
// @ts-expect-error Async nodes only declare Signal/legacy dependencies.
graph.addAsync('invalid-async', [sourceRef], { params: () => [], task: async () => 0, initial: 0 });
// @ts-expect-error Signal-to-Stream accepts a Signal input only.
graph.addSignalToStream('invalid-signal-to-stream', sourceRef);
// @ts-expect-error Stream-to-Signal accepts a Stream input only.
graph.addStreamToSignal('invalid-stream-to-signal', signalRef, 0, (_state, value: number) => value);
// @ts-expect-error Computed Signal refs are read-only.
graph.set(computed.ref, 1);
// @ts-expect-error Stream refs are never writable through graph.set.
graph.set(sourceRef, 1);

type _signalRef = Assert<IsAssignable<typeof signalRef, SignalNodeRef<number, true>>>;
type _sourceRef = Assert<IsAssignable<typeof sourceRef, StreamNodeRef<number>>>;
type _streamValue = Assert<IsAssignable<typeof values, Stream<number>>>;

void signalRef;
void sourceRef;
void values;
void signalValues;
void latest;
