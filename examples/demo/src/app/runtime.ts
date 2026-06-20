import { effect, signal } from 'alien-signals';

import type { JsonGraphSpecV1 } from 'depa-data-graph-core';
import {
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

export interface DemoRuntime {
  graph: DataGraph<DemoRuntime>;
  subgraphs: Partial<Record<DemoActorId, DataGraph<DemoRuntime>>>;
  actorLog$: ReturnType<typeof signal<ActivityLogEntry[]>>;
  logConsumer: (consumerId: string, message: string) => void;
  intents: {
    increase: (by?: number) => void;
    setInput: (text: string) => void;
    submit: () => void;
    reset: () => void;
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

  buildGraphFromJson(graph, getMainGraphSpec(), mainGraphLogic);

  graph.addComputed<number>(
    'manual/counterTimes10',
    [MODEL.counter],
    (ctx) => ctx.graph.get<number>(MODEL.counter) * 10,
    { out: true },
  );

  graph.addConsumer('consumer/logCounter', [MODEL.counter], (ctx) => {
    const counter = ctx.graph.get<number>(MODEL.counter);
    ctx.bizRuntime.logConsumer('consumer/logCounter', `counter changed to ${counter}`);
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

  runtime.intents = {
    increase: (by = 1) => {
      graph.set<number>(MODEL.counter, (v) => v + by);
    },
    setInput: (text) => {
      graph.set<string>(MODEL.hello.input, text);
    },
    submit: () => {
      graph.batch(() => {
        const err = graph.get<string | null>(MODEL.hello.error);
        if (err) {
          return;
        }
        graph.set<string>(MODEL.hello.name, graph.get<string>(MODEL.hello.input));
      });
    },
    reset: () => {
      graph.batch(() => {
        graph.set<number>(MODEL.counter, 1);
        graph.set<string>(MODEL.hello.input, '');
        graph.set<string>(MODEL.hello.name, 'world');
      });
    },
  };

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
      graph.set<number>(MODEL.counter, (v) => v + 2);
    }
  });
}
