# Module Identity

Structured node identity and graph module composition for `depa-data-graph-core`.

## Why This Exists

String node IDs remain useful for runtime snapshots, logs, and serialization, but they are too weak to serve as the only long-term authoring model for:

- nested graphs
- derived graphs
- reusable subgraphs
- multi-instance mounting
- public-vs-internal graph boundaries

The module identity layer introduces structured refs so application code can work with graph identity as typed objects first, while runtime canonical strings remain a projection.

## Core Concepts

### `NodeRef<TValue, TSection>`

A typed ref describing one node inside a module.

- `TValue` tracks the node value type
- `TSection` tracks its role: `input`, `output`, `state`, or `internal`
- `id` is the canonical runtime string for the current scope
- `localId` is the module-local canonical string without mount scope

### `GraphModule`

A reusable module definition with explicit sections:

- `inputs`
- `outputs`
- `state`
- `internals`

`module.public` exposes only `inputs` and `outputs`. This is the intended public wiring surface for parent graphs.

### `mountGraph(module, { scope })`

Mounts the same module into an isolated runtime scope and returns scoped refs.

Example:

```ts
import { defineGraphModule, input, mountGraph, output, state } from 'depa-data-graph-core';

const StageModule = defineGraphModule('stage', {
  inputs: {
    lexicalEvents: input<string[]>(),
  },
  outputs: {
    semanticEvents: output<string[]>(),
  },
  state: {
    lexicalSeq: state<number>(),
  },
} as const);

const main = mountGraph(StageModule, { scope: 'agent/main' });
const review = mountGraph(StageModule, { scope: 'agent/review' });
```

Canonical runtime IDs become:

- `agent/main::stage.inputs.lexicalEvents`
- `agent/review::stage.inputs.lexicalEvents`

The application code does not need to hand-author those strings.

## Runtime Strings Are Still Supported

Canonical strings still matter for:

- snapshots
- debugging
- persistence
- bridge layers

But they should be treated as runtime projections of structured refs, not as the primary authoring abstraction for long-lived modular graph code.

## Compatibility Strategy

The current migration policy is:

- ref-first APIs are the formal long-term path
- string IDs remain supported as a compatibility layer
- builders and `DataGraph` runtime methods may accept both refs and strings during migration
- new modular graph code should prefer refs and public module ports over hand-authored string literals

This keeps existing graphs working while moving reusable graph definitions toward one structured identity model.

## Current Scope

This layer currently provides:

- structured node refs
- module definition
- scoped mounting
- canonical ID helpers

Ref-first `DataGraph` runtime APIs and builder wiring are a subsequent layer built on top of this identity core.
