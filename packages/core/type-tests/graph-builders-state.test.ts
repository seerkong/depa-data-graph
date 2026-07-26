import { buildGraphFromJson, createCodeGraphBuilder, DataGraph } from '../src';
import type { SignalNodeRef, StreamNodeRef } from '../src';

const graph = new DataGraph(() => ({ step: 2 }));
const signalInput = graph.addSignal('signal-input', 1);
const streamInput = graph.addSource<number>('stream-input', { start: () => {}, stop: () => {} });
const builder = createCodeGraphBuilder(graph);

const codeNode = builder.signalDrivenStateSignal({
  id: 'code-state',
  input: signalInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
  mutations: { add: (state, amount: number) => state + amount },
  actions: (rt) => ({
    addRuntimeStep: (multiplier: number) => ({
      state: rt.mutations.add(rt.bizRuntime.step * multiplier),
      previous: rt.getState(),
    }),
  }),
});

const codeOutput: SignalNodeRef<number, false> = codeNode.output;
const codeMutationResult: number = codeNode.mutations.add(1);
const codeActionResult: { state: number; previous: number } =
  codeNode.actions.addRuntimeStep(2);
void codeOutput;
void codeMutationResult;
void codeActionResult;

builder
  .signalDrivenStateStream('signal-stream', {
    input: signalInput.ref,
    initial: 0,
    reducer: (state, input) => state + input,
  })
  .streamDrivenStateSignal('stream-signal', {
    input: streamInput.ref,
    initial: 0,
    reducer: (state, input) => state + input,
  })
  .streamDrivenStateStream('stream-stream', {
    input: streamInput.ref,
    initial: 0,
    reducer: (state, input) => state + input,
  });

const codeSignalStream = builder.signalDrivenStateStream({
  id: 'code-signal-stream-actions',
  input: signalInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
  mutations: { add: (state, amount: number) => state + amount },
  actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
});
const codeStreamSignal = builder.streamDrivenStateSignal({
  id: 'code-stream-signal-actions',
  input: streamInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
  mutations: { add: (state, amount: number) => state + amount },
  actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
});
const codeStreamStream = builder.streamDrivenStateStream({
  id: 'code-stream-stream-actions',
  input: streamInput.ref,
  initial: 0,
  reducer: (state, input) => state + input,
  mutations: { add: (state, amount: number) => state + amount },
  actions: (rt) => ({ addRuntimeStep: (multiplier: number) => rt.mutations.add(rt.bizRuntime.step * multiplier) }),
});

const signalStreamActionResult: number = codeSignalStream.actions.addRuntimeStep(2);
const streamSignalActionResult: number = codeStreamSignal.actions.addRuntimeStep(2);
const streamStreamActionResult: number = codeStreamStream.actions.addRuntimeStep(2);
void signalStreamActionResult;
void streamSignalActionResult;
void streamStreamActionResult;

const spec = {
  version: 1,
  nodes: [
    {
      kind: 'streamDrivenStateStream',
      id: 'json-state',
      input: 'stream-input',
      initial: 0,
      reducerKey: 'sum',
      mutationsKey: 'counter',
      actionsKey: 'counter',
    },
  ],
} as const;
const logic = {
  computed: {},
  processor: {},
  consumer: {},
  async: {},
  reducers: { sum: (state: number, input: number) => state + input },
  mutations: { counter: { add: (state: number, amount: number) => state + amount } },
  actions: {
    counter: (rt: { mutations: { add(amount: number): number } }) => ({
      addOne: () => rt.mutations.add(1),
    }),
  },
};

const built = buildGraphFromJson(graph, spec, logic);
const jsonOutput: StreamNodeRef<number> = built.stateNodes['json-state'].output;
const jsonMutationResult: number = built.stateNodes['json-state'].mutations.add(2);
const jsonActionResult: number = built.stateNodes['json-state'].actions.addOne();
void jsonOutput;
void jsonMutationResult;
void jsonActionResult;
