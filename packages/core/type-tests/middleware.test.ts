import type { DataGraph, Setter } from '../src/graph';
import type { GraphMiddleware } from '../src/middleware';

type Runtime = {
  graph: DataGraph<Runtime>;
};

const middleware = {
  name: 'example-middleware',

  beforeGet: (_id: string) => {
    // no-op
  },

  afterGet: <T>(_id: string, value: T) => {
    return value;
  },

  beforeSet: <T>(_id: string, value: Setter<T>) => {
    return value;
  },

  afterSet: <T>(_id: string, _value: Setter<T>) => {
    // no-op
  },

  onBatch: (_event: { phase: 'start' | 'end' }) => {
    // no-op
  },
} satisfies GraphMiddleware<Runtime>;

void middleware;
