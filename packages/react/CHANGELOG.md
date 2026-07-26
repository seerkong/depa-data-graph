# depa-data-graph-react

## 1.0.1

### Major Changes

- Promote the adapter to the aligned 1.0.1 public release.

### Patch Changes

- Updated dependencies
  - depa-data-graph-core@1.0.1

## 0.2.0

### Minor Changes

- Unify Signal and Stream nodes in one DataGraph, add four typed state-node variants with mutation/action facades, migrate event-log projections, and remove the former split graph, bridge, and reducer-projection APIs. Framework adapters now document and test direct consumption of read-only state-node Signal outputs.

### Patch Changes

- Updated dependencies
  - depa-data-graph-core@1.0.0

## Unreleased

### Minor Changes

- Accept typed read-only Signal state-node outputs in `useGraphSignal`; updates remain on the node mutation/action facade.

## 0.1.1

### Patch Changes

- fix: correct repository URL to github.com/seerkong/depa-data-graph
- Updated dependencies
  - depa-data-graph-core@0.1.1
