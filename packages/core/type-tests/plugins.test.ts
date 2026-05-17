import type { DataGraph } from '../src/graph';
import {
  loggerPlugin,
  persistPlugin,
  validationPlugin,
  type BatchEvent,
  type GraphMiddleware,
  type MiddlewareContext,
} from '../src/index';

type Runtime = {
  graph: DataGraph<Runtime>;
};

const logger = loggerPlugin<Runtime>({ level: 'debug' });
void logger;

const storage = {
  getItem: (_key: string) => null,
  setItem: (_key: string, _value: string) => {
    // no-op
  },
};

const persist = persistPlugin<Runtime>({ storage, keys: ['counter'] });
void persist;

const validate = validationPlugin<Runtime>({
  rules: {
    counter: (v: unknown) => (typeof v === 'number' && v < 0 ? 'Cannot be negative' : null),
  },
});
void validate;

const mw: GraphMiddleware<Runtime> = logger;
void mw;

declare const ctx: MiddlewareContext<Runtime>;
void ctx;

const batch: BatchEvent = { phase: 'start' };
void batch;
