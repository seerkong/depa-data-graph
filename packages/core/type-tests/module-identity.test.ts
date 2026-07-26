import {
  defineGraphModule,
  input,
  internal,
  mountGraph,
  output,
  signalInput,
  signalOutput,
  state,
  streamInput,
  streamOutput,
} from '../src/module-identity';
import type { SignalNodeRef, StreamNodeRef } from '../src/graph';
import type { NodeRef } from '../src/module-identity';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

const stage = defineGraphModule('stage', {
  inputs: {
    lexicalEvents: input<string[]>(),
  },
  outputs: {
    semanticEvents: output<string[]>(),
  },
  state: {
    lexicalSeq: state<number>(),
  },
  internals: {
    lexicalToSyntactic: internal<void>(),
  },
} as const);

const mounted = mountGraph(stage, { scope: 'agent/main' });

const inputRef: NodeRef<string[], 'input'> = stage.inputs.lexicalEvents;
void inputRef;

const outputRef: NodeRef<string[], 'output'> = mounted.outputs.semanticEvents;
void outputRef;

const stateRef: NodeRef<number, 'state'> = mounted.state.lexicalSeq;
void stateRef;

const internalRef: NodeRef<void, 'internal'> = mounted.internals.lexicalToSyntactic;
void internalRef;

type _publicInputs = Assert<
  IsAssignable<typeof mounted.public.inputs.lexicalEvents, NodeRef<string[], 'input'>>
>;
type _publicOutputs = Assert<
  IsAssignable<typeof mounted.public.outputs.semanticEvents, NodeRef<string[], 'output'>>
>;

const protocols = defineGraphModule('protocols', {
  inputs: { signal: signalInput<number>(), stream: streamInput<string>() },
  outputs: { signal: signalOutput<boolean>(), stream: streamOutput<Date>() },
} as const);

const signalIn: SignalNodeRef<number, true> = protocols.inputs.signal;
const streamIn: StreamNodeRef<string> = protocols.inputs.stream;
const signalOut: SignalNodeRef<boolean> = protocols.outputs.signal;
const streamOut: StreamNodeRef<Date> = protocols.outputs.stream;
void signalIn;
void streamIn;
void signalOut;
void streamOut;
