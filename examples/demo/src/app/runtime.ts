import { effect, signal } from 'alien-signals';

import type { JsonGraphSpecV1, SignalDrivenStateSignalNode } from 'depa-data-graph-core';
import {
  AppendOnlyEventLog,
  DataGraph,
  buildGraphFromJson,
  loggerPlugin,
  untracked,
  validationPlugin,
} from 'depa-data-graph-core';

import mainGraphSpecJson from './graph/main-graph.json';
import { mainGraphLogic } from './graph/main-graph.logic';

export type DemoActorId = 'vanilla' | 'vue' | 'react' | 'solid';

export type ConsumerLogEntry = {
  kind: 'consumer';
  id: number;
  ts: number;
  consumerId: string;
  message: string;
};

export type ActivityLogEntry = ConsumerLogEntry;

export interface DemoControlState {
  counter: number;
  input: string;
  name: string;
}

type DemoControlMutations = {
  increase: (state: DemoControlState, by?: number) => DemoControlState;
  setInput: (state: DemoControlState, text: string) => DemoControlState;
  submitName: (state: DemoControlState, name: string) => DemoControlState;
  reset: (state: DemoControlState) => DemoControlState;
};

type DemoControlActions = {
  increaseByRuntimeStep: () => DemoControlState;
  submit: () => DemoControlState | undefined;
};

export type DemoControlNode = SignalDrivenStateSignalNode<
  null,
  DemoControlState,
  DemoControlMutations,
  DemoControlActions
>;

export interface DemoRuntime {
  graph: DataGraph<DemoRuntime>;
  subgraphs: Partial<Record<DemoActorId, DataGraph<DemoRuntime>>>;
  actorLog$: ReturnType<typeof signal<ActivityLogEntry[]>>;
  logConsumer: (consumerId: string, message: string) => void;
  counterStep: number;
  stateNodes: {
    controls: DemoControlNode;
  };
}

export const MODEL = {
  counter: 'counter',
  plus100: 'plus100',
  plus300: 'plus300',
  asyncPlus100: {
    id: 'asyncPlus100',
    result: 'asyncPlus100/result',
    loading: 'asyncPlus100/loading',
    error: 'asyncPlus100/error',
  },
  hello: {
    input: 'hello/input',
    name: 'hello/name',
    error: 'hello/validationError',
  },
  derived: {
    isEven: 'counter/isEven',
    label: 'counter/label',
  },
  ping: (id: DemoActorId) => `ping/${id}`,
} as const;

export function createDemoRuntime(): DemoRuntime {
  const runtime = {} as DemoRuntime;

  const graph = new DataGraph<DemoRuntime>(() => runtime);

  const actorLog$ = signal<ActivityLogEntry[]>([]);
  let logSeq = 0;

  const appendLog = (entry: ActivityLogEntry) => {
    untracked(() => {
      const prev = actorLog$();
      const next = prev.length >= 200 ? prev.slice(prev.length - 199) : prev;
      actorLog$([...next, entry]);
    });
  };

  const logConsumer = (consumerId: string, message: string) => {
    appendLog({
      kind: 'consumer',
      id: ++logSeq,
      ts: Date.now(),
      consumerId,
      message,
    });
  };

  runtime.graph = graph;
  runtime.subgraphs = {};
  runtime.actorLog$ = actorLog$;
  runtime.logConsumer = logConsumer;
  runtime.counterStep = 10;

  buildGraphFromJson(graph, getMainGraphSpec(), mainGraphLogic);

  const controlsDriver = graph.addSignal('demo/controls-driver', null);
  const controls = graph.addSignalDrivenStateSignalNode({
    id: 'demo/controls',
    input: controlsDriver.ref,
    initial: { counter: 1, input: '', name: 'world' },
    reducer: (state) => state,
    mutations: {
      increase: (state, by = 1) => ({ ...state, counter: state.counter + by }),
      setInput: (state, text: string) => ({ ...state, input: text }),
      submitName: (state, name: string) => ({ ...state, name }),
      reset: () => ({ counter: 1, input: '', name: 'world' }),
    },
    actions: (rt) => ({
      increaseByRuntimeStep: () => rt.mutations.increase(rt.bizRuntime.counterStep),
      submit: () => {
        if (rt.graph.get<string | null>(MODEL.hello.error)) {
          return undefined;
        }
        return rt.mutations.submitName(rt.getState().input);
      },
    }),
  });
  runtime.stateNodes = { controls };

  graph.addConsumer('demo/controls-to-presentation', [controls.output], (rt) => {
    const state = rt.graph.get(controls.output);
    rt.graph.batch(() => {
      rt.graph.set(MODEL.counter, state.counter);
      rt.graph.set(MODEL.hello.input, state.input);
      rt.graph.set(MODEL.hello.name, state.name);
    });
  });

  graph.addComputed<number>(
    'manual/counterTimes10',
    [MODEL.counter],
    (rt) => rt.graph.get<number>(MODEL.counter) * 10,
    { out: true },
  );

  graph.addConsumer('consumer/logCounter', [MODEL.counter], (rt) => {
    const counter = rt.graph.get<number>(MODEL.counter);
    rt.bizRuntime.logConsumer('consumer/logCounter', `counter changed to ${counter}`);
  });

  // Demo: register built-in middleware/plugins (kept small to avoid noisy startup logs).
  graph.use(
    loggerPlugin({
      level: 'info',
      prefix: '[demo]',
      logger: {
        log: (msg: string) => logConsumer('middleware/logger', msg),
        debug: (msg: string) => logConsumer('middleware/logger', msg),
        info: (msg: string) => logConsumer('middleware/logger', msg),
        warn: (msg: string) => logConsumer('middleware/logger', msg),
        error: (msg: string) => logConsumer('middleware/logger', msg),
      },
    }),
  );

  graph.use(
    validationPlugin({
      rules: {
        [MODEL.counter]: (value: unknown) =>
          typeof value === 'number' && value < 0 ? 'Cannot be negative' : null,
      },
      logger: {
        warn: (msg: string) => logConsumer('middleware/validation', msg),
      },
    }),
  );

  installUnifiedStateNodeShowcase(graph, logConsumer);
  wireSystemBehaviors(runtime);

  return runtime;
}

type MainGraphSpec = JsonGraphSpecV1;

function getMainGraphSpec(): MainGraphSpec {
  return mainGraphSpecJson as MainGraphSpec;
}

function wireSystemBehaviors(runtime: DemoRuntime): void {
  const { graph } = runtime;

  effect(() => {
    const err = graph.get<string | null>(MODEL.hello.error);
    if (err) {
      return;
    }

    const name = graph.get<string>(MODEL.hello.name);
    if (name === 'alien') {
      runtime.stateNodes.controls.mutations.increase(2);
    }
  });
}

function installUnifiedStateNodeShowcase(
  graph: DataGraph<DemoRuntime>,
  log: DemoRuntime['logConsumer'],
): void {
  const signalInput = graph.addSignal('showcase/signal-input', 2);
  const signalSignal = graph.addSignalDrivenStateSignalNode({
    id: 'showcase/signal-state',
    input: signalInput.ref,
    initial: 0,
    reducer: (state, value) => state + value,
    mutations: { keep: (state) => state },
  });
  const signalStream = graph.addSignalDrivenStateStreamNode({
    id: 'showcase/signal-transitions',
    input: signalInput.ref,
    initial: 0,
    reducer: (state, value) => state + value,
    mutations: { keep: (state) => state },
  });

  const eventLog = new AppendOnlyEventLog<number>();
  eventLog.append(3);
  eventLog.append(4);
  const currentSource = graph.addSource('showcase/event-current-source', eventLog.stream());
  const transitionSource = graph.addSource('showcase/event-transition-source', eventLog.stream());
  const streamSignal = graph.addStreamDrivenStateSignalNode({
    id: 'showcase/event-current',
    input: currentSource.ref,
    initial: 0,
    reducer: (state, entry) => state + entry.value,
  });
  const streamStream = graph.addStreamDrivenStateStreamNode({
    id: 'showcase/event-transitions',
    input: transitionSource.ref,
    initial: 0,
    reducer: (state, entry) => state + entry.value,
    mutations: { keep: (state) => state },
  });

  const signalAsStream = graph.addSignalToStream('showcase/signal-as-stream', signalInput.ref);
  graph.addStreamToSignal(
    'showcase/stream-as-signal',
    signalAsStream.ref,
    0,
    (_state, value) => value,
  );

  let equalStreamEmissions = 0;
  const subscription = graph.stream(signalStream.output).subscribe({
    next: () => {
      equalStreamEmissions += 1;
    },
  });
  const beforeEqualMutation = equalStreamEmissions;
  signalStream.mutations.keep();
  const streamEmittedEqualState = equalStreamEmissions === beforeEqualMutation + 1;

  const signalVersion = graph.node(signalSignal.output).meta.version;
  signalSignal.mutations.keep();
  const signalDeduplicatedEqualState =
    graph.node(signalSignal.output).meta.version === signalVersion;

  streamStream.mutations.keep();
  let replayedCurrent: number | undefined;
  const replay = graph.stream(streamStream.output).subscribe({
    next: (value) => {
      replayedCurrent ??= value;
    },
  });

  log(
    'showcase/state-nodes',
    `four nodes ready; projection=${streamSignal.getState()}; replay=${String(replayedCurrent)}; streamEqual=${String(streamEmittedEqualState)}; signalDedup=${String(signalDeduplicatedEqualState)}`,
  );
  subscription.unsubscribe();
  replay.unsubscribe();
}
