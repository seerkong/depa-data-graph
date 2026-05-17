import { defineGraphModule, input, internal, mountGraph, output, state } from '../src/module-identity';
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

type _publicInputs = Assert<IsAssignable<typeof mounted.public.inputs.lexicalEvents, NodeRef<string[], 'input'>>>;
type _publicOutputs = Assert<
  IsAssignable<typeof mounted.public.outputs.semanticEvents, NodeRef<string[], 'output'>>
>;
