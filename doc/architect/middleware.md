# Middleware / Plugins

`DataGraph` supports middleware to implement cross-cutting concerns (logging, persistence, validation, metrics) without embedding those concerns into node logic.

Middleware is registered via `graph.use(middleware)`.

## GraphMiddleware

```ts
import type { GraphMiddleware } from 'depa-data-graph-core';

const middleware: GraphMiddleware<unknown> = {
  name: 'my-middleware',

  beforeGet: (id, ctx) => {
    void ctx;
    console.log('get', id);
  },

  afterGet: (id, value) => {
    console.log('got', id, value);
    return value;
  },

  beforeSet: (id, value) => {
    console.log('set', id, value);
    return value;
  },

  afterSet: (id) => {
    console.log('set complete', id);
  },
};

graph.use(middleware);
```

Hooks:

- `beforeGet(id, ctx)`
- `afterGet(id, value, ctx) => value`
- `beforeSet(id, value, ctx) => value | undefined` (return `undefined` to block)
- `afterSet(id, value, ctx)`
- `onNodeAdd(node, ctx)`
- `onBatch({ phase }, ctx)`
- `onDispose(ctx)`

## Built-in plugins

The core package ships a few small middleware helpers:

- `loggerPlugin()` - logs writes
- `persistPlugin()` - persists a subset of keys to a storage backend
- `validationPlugin()` - blocks writes based on per-id validation rules

Example:

```ts
import { loggerPlugin, validationPlugin } from 'depa-data-graph-core';

graph.use(loggerPlugin({ level: 'info' }));

graph.use(
  validationPlugin({
    rules: {
      counter: (v) => (typeof v === 'number' && v < 0 ? 'Cannot be negative' : null),
    },
  }),
);
```
