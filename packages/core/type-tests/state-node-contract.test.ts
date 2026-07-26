import {
  DataGraph,
  type SignalDrivenStateSignalNode,
  type SignalDrivenStateStreamNode,
  type SignalNodeRef,
  type StreamDrivenStateSignalNode,
  type StreamDrivenStateStreamNode,
  type StreamNodeRef,
} from '../src';

type Assert<T extends true> = T;
type IsAssignable<T, U> = T extends U ? true : false;

const graph = new DataGraph(() => ({}));
const signalInput = graph.addSignal('signal-input', 1);
const streamInput = graph.addSource<number>('stream-input', { start: () => {}, stop: () => {} });

const signalSignal = graph.addSignalDrivenStateSignalNode({
  id: 'signal-signal',
  input: signalInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
});
const signalStream = graph.addSignalDrivenStateStreamNode({
  id: 'signal-stream',
  input: signalInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
});
const streamSignal = graph.addStreamDrivenStateSignalNode({
  id: 'stream-signal',
  input: streamInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
});
const streamStream = graph.addStreamDrivenStateStreamNode({
  id: 'stream-stream',
  input: streamInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
});

const signalSignalNode: SignalDrivenStateSignalNode<number, number> = signalSignal;
const signalStreamNode: SignalDrivenStateStreamNode<number, number> = signalStream;
const streamSignalNode: StreamDrivenStateSignalNode<number, number> = streamSignal;
const streamStreamNode: StreamDrivenStateStreamNode<number, number> = streamStream;

type _signalSignalOutput = Assert<
  IsAssignable<typeof signalSignal.output, SignalNodeRef<number, false>>
>;
type _signalStreamOutput = Assert<IsAssignable<typeof signalStream.output, StreamNodeRef<number>>>;
type _streamSignalOutput = Assert<
  IsAssignable<typeof streamSignal.output, SignalNodeRef<number, false>>
>;
type _streamStreamOutput = Assert<IsAssignable<typeof streamStream.output, StreamNodeRef<number>>>;

const currentSignal: number = graph.get(signalSignal.output);
const currentStream: number = streamStream.getState();
graph.stream(streamStream.output);

// @ts-expect-error State-node Signal outputs are read-only.
graph.set(signalSignal.output, 1);
// @ts-expect-error State-node handles do not expose set.
signalSignal.set(1);
// @ts-expect-error Stream outputs cannot be assigned through graph.set.
graph.set(streamStream.output, 1);
graph.addSignalDrivenStateSignalNode({
  id: 'invalid-signal-driver',
  // @ts-expect-error Signal-driven nodes reject Stream inputs.
  input: streamInput.ref,
  initial: 0,
  reducer: (state: number) => state,
});
graph.addStreamDrivenStateStreamNode({
  id: 'invalid-stream-driver',
  // @ts-expect-error Stream-driven nodes reject Signal inputs.
  input: signalInput.ref,
  initial: 0,
  reducer: (state: number) => state,
});

void signalSignalNode;
void signalStreamNode;
void streamSignalNode;
void streamStreamNode;
void currentSignal;
void currentStream;
