import {
  computed as alienComputed,
  effect,
  endBatch,
  setActiveSub,
  signal as alienSignal,
  startBatch,
} from 'alien-signals';

import type { BatchEvent, GraphMiddleware, MiddlewareContext } from './middleware';
import type { NodeRef, NodeSection } from './module-identity';
import { toNodeId } from './module-identity';

export type NodeKind = 'signal' | 'computed' | 'processor' | 'async' | 'consumer';

export type NodeFlags = {
  in?: boolean;
  out?: boolean;
  computed?: boolean;
  restriction?: boolean;
  validation?: boolean;
};

export type Setter<T> = T | ((prev: T) => T);

export type StopHandle = () => void;

export type DepsAuditMode = 'off' | 'warn' | 'throw';

export type GraphEdgeKind = 'dependsOn' | 'writesTo' | 'viewReads';

export type AsyncProjectionIds = {
  result?: GraphNodeIdLike;
  loading?: GraphNodeIdLike;
  error?: GraphNodeIdLike;
};

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface GraphNode<T = unknown> {
  id: string;
  kind: NodeKind;
  flags: NodeFlags;
  deps: string[];
  outputs: string[];
  get?: () => T;
  set?: (value: Setter<T>) => void;
  meta: {
    version: number;
    updatedAt: number;
  };
}

export interface GraphContext<TRuntime> {
  runtime: TRuntime;
  get<T>(id: string): T;
  get<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): TValue;
  get<T>(id: GraphNodeIdLike): T;
  peek<T>(id: string): T;
  peek<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): TValue;
  peek<T>(id: GraphNodeIdLike): T;
  set<T>(id: string, value: Setter<T>): void;
  set<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>, value: Setter<TValue>): void;
  set<T>(id: GraphNodeIdLike, value: Setter<T>): void;
  batch<T>(fn: () => T): T;
}

export type GraphNodeIdLike = string | NodeRef<unknown, NodeSection>;

export interface GraphSnapshot {
  revision: number;
  nodes: Array<{
    id: string;
    kind: NodeKind;
    flags: NodeFlags;
    deps: string[];
    outputs: string[];
    version: number;
    updatedAt: number;
    value: unknown;
  }>;
  edges: GraphEdge[];
  viewDeps: Record<string, string[]>;
}

export type GraphValidationError =
  | {
      kind: 'missingDep';
      from: string;
      to: string;
      message: string;
      suggestion?: string;
    }
  | {
      kind: 'missingOutput';
      from: string;
      to: string;
      message: string;
      suggestion?: string;
    }
  | {
      kind: 'outputNotWritable';
      from: string;
      to: string;
      message: string;
      suggestion?: string;
    }
  | {
      kind: 'viewDepMissingNode';
      from: string;
      to: string;
      message: string;
      suggestion?: string;
    }
  | {
      kind: 'cycle';
      path: string[];
      message: string;
      suggestion?: string;
    };

type CollectorState = {
  id: string;
  deps: Set<string>;
};

type AuditCollectorState = {
  ownerId: string;
  declaredDeps: Set<string>;
  reads: Set<string>;
};

export class DataGraph<TRuntime> {
  private nodes = new Map<string, GraphNode<any>>();
  private viewDeps = new Map<string, string[]>();
  private viewModels = new Map<string, { $: () => unknown; stop: StopHandle }>();

  private activeCollector: CollectorState | null = null;

  private depsAuditMode: DepsAuditMode = 'off';
  private activeAuditCollector: AuditCollectorState | null = null;

  private middlewares: GraphMiddleware<TRuntime>[] = [];
  private middlewareDepth = 0;
  private disposed = false;

  private revisionCounter = 0;
  private revisionSignal = alienSignal(0);

  private disposers: StopHandle[] = [];

  constructor(private getRuntime: () => TRuntime) {}

  use(middleware: GraphMiddleware<TRuntime>): this {
    this.middlewares.push(middleware);
    return this;
  }

  setDepsAudit(mode: DepsAuditMode): void {
    this.depsAuditMode = mode;
  }

  addCleanup(stop: StopHandle): void {
    this.disposers.push(stop);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    this.emitDispose();

    for (const stop of this.disposers.splice(0)) {
      stop();
    }
  }

  revision(): () => number {
    return this.revisionSignal;
  }

  snapshot(): GraphSnapshot {
    const nodes = Array.from(this.nodes.values())
      .map((node) => ({
        id: node.id,
        kind: node.kind,
        flags: node.flags,
        deps: [...node.deps],
        outputs: [...node.outputs],
        version: node.meta.version,
        updatedAt: node.meta.updatedAt,
        value: node.get ? this.untracked(() => node.get!()) : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const edges: GraphEdge[] = [];

    for (const node of this.nodes.values()) {
      for (const dep of node.deps) {
        edges.push({ from: dep, to: node.id, kind: 'dependsOn' });
      }
      for (const out of node.outputs) {
        edges.push({ from: node.id, to: out, kind: 'writesTo' });
      }
    }

    const viewDeps: Record<string, string[]> = {};
    for (const [viewId, deps] of this.viewDeps.entries()) {
      viewDeps[viewId] = deps;
      for (const dep of deps) {
        edges.push({ from: viewId, to: dep, kind: 'viewReads' });
      }
    }

    return {
      revision: this.revisionCounter,
      nodes,
      edges,
      viewDeps,
    };
  }

  validate(): GraphValidationError[] {
    const errors: GraphValidationError[] = [];

    for (const node of this.nodes.values()) {
      for (const dep of node.deps) {
        if (!this.nodes.has(dep)) {
          errors.push({
            kind: 'missingDep',
            from: node.id,
            to: dep,
            message: `Missing dependency: ${node.id} -> ${dep}`,
            suggestion: `Add node '${dep}' or remove it from deps of '${node.id}'.`,
          });
        }
      }

      for (const out of node.outputs) {
        const outNode = this.nodes.get(out);
        if (!outNode) {
          errors.push({
            kind: 'missingOutput',
            from: node.id,
            to: out,
            message: `Missing output: ${node.id} -> ${out}`,
            suggestion: `Add node '${out}' or remove it from outputs of '${node.id}'.`,
          });
          continue;
        }

        if (!outNode.set) {
          errors.push({
            kind: 'outputNotWritable',
            from: node.id,
            to: out,
            message: `Output is not writable: ${node.id} -> ${out}`,
            suggestion: `Ensure output '${out}' is a writable signal node.`,
          });
        }
      }
    }

    for (const [viewId, deps] of this.viewDeps.entries()) {
      for (const dep of deps) {
        if (!this.nodes.has(dep)) {
          errors.push({
            kind: 'viewDepMissingNode',
            from: viewId,
            to: dep,
            message: `View depends on missing node: ${viewId} -> ${dep}`,
            suggestion: `Ensure '${dep}' exists or dispose view model '${viewId}'.`,
          });
        }
      }
    }

    const adjacency = new Map<string, string[]>();
    for (const node of this.nodes.values()) {
      adjacency.set(
        node.id,
        node.deps.filter((dep) => this.nodes.has(dep)),
      );
    }

    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const stackIndex = new Map<string, number>();
    const recorded = new Set<string>();

    const canonicalCycleKey = (path: readonly string[]): string => {
      if (path.length === 0) {
        return '';
      }
      let best = '';
      for (let i = 0; i < path.length; i += 1) {
        const rotated = [...path.slice(i), ...path.slice(0, i)];
        const candidate = rotated.join('->');
        if (i === 0 || candidate < best) {
          best = candidate;
        }
      }
      return best;
    };

    const recordCycle = (path: string[]): void => {
      const key = canonicalCycleKey(path);
      if (recorded.has(key)) {
        return;
      }
      recorded.add(key);

      const display = path.length ? `${path.join(' -> ')} -> ${path[0]}` : '';

      errors.push({
        kind: 'cycle',
        path,
        message: `Dependency cycle detected: ${display}`,
        suggestion: 'Break the cycle by removing a dependency edge.',
      });
    };

    const visit = (id: string): void => {
      state.set(id, 1);
      stackIndex.set(id, stack.length);
      stack.push(id);

      const deps = adjacency.get(id) ?? [];
      for (const dep of deps) {
        const depState = state.get(dep) ?? 0;
        if (depState === 0) {
          visit(dep);
          continue;
        }
        if (depState === 1) {
          const start = stackIndex.get(dep) ?? 0;
          recordCycle(stack.slice(start));
        }
      }

      stack.pop();
      stackIndex.delete(id);
      state.set(id, 2);
    };

    for (const id of adjacency.keys()) {
      if ((state.get(id) ?? 0) === 0) {
        visit(id);
      }
    }

    return errors;
  }

  node<T = unknown>(id: string): GraphNode<T>;
  node<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): GraphNode<TValue>;
  node<T = unknown>(id: GraphNodeIdLike): GraphNode<T>;
  node<T = unknown>(id: GraphNodeIdLike): GraphNode<T> {
    const nodeId = toNodeId(id);
    const n = this.nodes.get(nodeId);
    if (!n) {
      throw new Error(`Unknown node: ${nodeId}`);
    }
    return n as GraphNode<T>;
  }

  get<T>(id: string): T;
  get<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): TValue;
  get<T>(id: GraphNodeIdLike): T;
  get<T>(id: GraphNodeIdLike): T {
    const nodeId = toNodeId(id);
    const n = this.node<T>(nodeId);
    if (!n.get) {
      throw new Error(`Node is not readable: ${nodeId}`);
    }

    if (this.middlewares.length === 0 || this.middlewareDepth > 0) {
      return n.get();
    }

    const runtime = this.getRuntime();
    const ctx = this.makeMiddlewareCtx(runtime);

    for (const mw of this.middlewares) {
      if (!mw.beforeGet) {
        continue;
      }
      this.runMiddlewareHook(() => mw.beforeGet!(nodeId, ctx));
    }

    const rawValue = n.get();

    let value = rawValue;
    for (let i = this.middlewares.length - 1; i >= 0; i -= 1) {
      const mw = this.middlewares[i];
      if (!mw.afterGet) {
        continue;
      }
      value = this.runMiddlewareHook(() => mw.afterGet!(nodeId, value, ctx));
    }

    return value;
  }

  peek<T>(id: string): T;
  peek<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): TValue;
  peek<T>(id: GraphNodeIdLike): T;
  peek<T>(id: GraphNodeIdLike): T {
    return this.untracked(() => this.get<T>(id));
  }

  set<T>(id: string, value: Setter<T>): void;
  set<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>, value: Setter<TValue>): void;
  set<T>(id: GraphNodeIdLike, value: Setter<T>): void;
  set<T>(id: GraphNodeIdLike, value: Setter<T>): void {
    const nodeId = toNodeId(id);
    const n = this.node<T>(nodeId);
    if (!n.set) {
      throw new Error(`Node is not writable: ${nodeId}`);
    }

    if (this.middlewares.length === 0 || this.middlewareDepth > 0) {
      n.set(value);
      return;
    }

    const runtime = this.getRuntime();
    const ctx = this.makeMiddlewareCtx(runtime);

    let next: Setter<T> | undefined = value;
    for (const mw of this.middlewares) {
      if (!mw.beforeSet) {
        continue;
      }
      const candidate = this.runMiddlewareHook(() => mw.beforeSet!(nodeId, next as Setter<T>, ctx));
      if (candidate === undefined) {
        next = undefined;
        break;
      }
      next = candidate;
    }

    if (next === undefined) {
      return;
    }

    n.set(next);

    for (let i = this.middlewares.length - 1; i >= 0; i -= 1) {
      const mw = this.middlewares[i];
      if (!mw.afterSet) {
        continue;
      }
      this.runMiddlewareHook(() => mw.afterSet!(nodeId, next as Setter<T>, ctx));
    }
  }

  batch<T>(fn: () => T): T {
    if (this.middlewares.length === 0 || this.middlewareDepth > 0) {
      startBatch();
      try {
        return fn();
      } finally {
        endBatch();
      }
    }

    const runtime = this.getRuntime();
    const ctx = this.makeMiddlewareCtx(runtime);

    const startEvent: BatchEvent = { phase: 'start' };
    for (const mw of this.middlewares) {
      if (!mw.onBatch) {
        continue;
      }
      this.runMiddlewareHook(() => mw.onBatch!(startEvent, ctx));
    }

    startBatch();
    try {
      return fn();
    } finally {
      endBatch();

      const endEvent: BatchEvent = { phase: 'end' };
      for (let i = this.middlewares.length - 1; i >= 0; i -= 1) {
        const mw = this.middlewares[i];
        if (!mw.onBatch) {
          continue;
        }
        this.runMiddlewareHook(() => mw.onBatch!(endEvent, ctx));
      }
    }
  }

  untracked<T>(fn: () => T): T {
    const prev = setActiveSub(undefined);
    try {
      return fn();
    } finally {
      setActiveSub(prev);
    }
  }

  addSignal<T>(id: string, initialValue: T, flags?: NodeFlags): GraphNode<T>;
  addSignal<T, TSection extends NodeSection>(
    id: NodeRef<T, TSection>,
    initialValue: T,
    flags?: NodeFlags,
  ): GraphNode<T>;
  addSignal<T>(id: GraphNodeIdLike, initialValue: T, flags?: NodeFlags): GraphNode<T>;
  addSignal<T>(id: GraphNodeIdLike, initialValue: T, flags: NodeFlags = {}): GraphNode<T> {
    const nodeId = toNodeId(id);
    this.assertNewId(nodeId);

    const $ = alienSignal<T>(initialValue);

    const node: GraphNode<T> = {
      id: nodeId,
      kind: 'signal',
      flags: { ...flags },
      deps: [],
      outputs: [],
      meta: { version: 0, updatedAt: Date.now() },
      get: () => {
        this.collect(nodeId);
        return $();
      },
      set: (value) => {
        const next =
          typeof value === 'function'
            ? (value as (prev: T) => T)(this.untracked(() => $()))
            : value;

        const prevVal = this.untracked(() => $());
        if (Object.is(prevVal, next)) {
          return;
        }

        $(next);
        this.touch(nodeId);
      },
    };

    this.nodes.set(nodeId, node);
    this.emitNodeAdd(node);
    this.bump();
    return node;
  }

  addComputed<T>(
    id: string,
    deps: readonly GraphNodeIdLike[],
    getter: (ctx: GraphContext<TRuntime>, prev?: T) => T,
    flags?: NodeFlags,
  ): GraphNode<T>;
  addComputed<T, TSection extends NodeSection>(
    id: NodeRef<T, TSection>,
    deps: readonly GraphNodeIdLike[],
    getter: (ctx: GraphContext<TRuntime>, prev?: T) => T,
    flags?: NodeFlags,
  ): GraphNode<T>;
  addComputed<T>(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    getter: (ctx: GraphContext<TRuntime>, prev?: T) => T,
    flags?: NodeFlags,
  ): GraphNode<T>;
  addComputed<T>(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    getter: (ctx: GraphContext<TRuntime>, prev?: T) => T,
    flags: NodeFlags = {},
  ): GraphNode<T> {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    this.assertNewId(nodeId);

    const ctx = this.makeCtx();

    const meta = { version: 0, updatedAt: Date.now() };
    let hasValue = false;
    let lastValue: T | undefined;

    const $ = alienComputed<T>((prev) => {
      for (const dep of depIds) {
        this.get(dep);
      }

      const next = this.withDepsAudit(nodeId, depIds, () =>
        this.suspendCollector(() => this.untracked(() => getter(ctx, prev))),
      );

      if (hasValue && !Object.is(lastValue, next)) {
        meta.version += 1;
        meta.updatedAt = Date.now();
      }

      hasValue = true;
      lastValue = next;
      return next;
    });

    const node: GraphNode<T> = {
      id: nodeId,
      kind: 'computed',
      flags: { ...flags, computed: true },
      deps: [...depIds],
      outputs: [],
      meta,
      get: () => {
        this.collect(nodeId);
        return this.suspendCollector(() => $());
      },
    };

    this.nodes.set(nodeId, node);
    this.emitNodeAdd(node);
    this.bump();
    return node;
  }

  addProcessor(
    id: string,
    deps: readonly GraphNodeIdLike[],
    outputs: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addProcessor<TSection extends NodeSection>(
    id: NodeRef<unknown, TSection>,
    deps: readonly GraphNodeIdLike[],
    outputs: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addProcessor(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    outputs: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addProcessor(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    outputs: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags: NodeFlags = {},
  ): GraphNode {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    const outputIds = outputs.map((out) => toNodeId(out));
    this.assertNewId(nodeId);

    const ctx = this.makeCtx();

    const node: GraphNode = {
      id: nodeId,
      kind: 'processor',
      flags: { ...flags },
      deps: [...depIds],
      outputs: [...outputIds],
      meta: { version: 0, updatedAt: Date.now() },
    };

    this.nodes.set(nodeId, node);
    this.emitNodeAdd(node);

    const stop = effect(() => {
      this.suspendCollector(() => {
        for (const dep of depIds) {
          this.get(dep);
        }

        this.batch(() => {
          this.withDepsAudit(nodeId, depIds, () => this.untracked(() => run(ctx)));
        });

        this.touch(nodeId);
      });
    });

    this.disposers.push(stop);
    this.bump();
    return node;
  }

  addAsync<TArgs extends unknown[], TResult>(
    id: string,
    deps: readonly GraphNodeIdLike[],
    config: {
      params: (ctx: GraphContext<TRuntime>) => TArgs;
      task: (...args: TArgs) => Promise<TResult>;
      initial: TResult;
      projections?: AsyncProjectionIds;
    },
    flags?: NodeFlags,
  ): GraphNode;
  addAsync<TArgs extends unknown[], TResult, TSection extends NodeSection>(
    id: NodeRef<unknown, TSection>,
    deps: readonly GraphNodeIdLike[],
    config: {
      params: (ctx: GraphContext<TRuntime>) => TArgs;
      task: (...args: TArgs) => Promise<TResult>;
      initial: TResult;
      projections?: AsyncProjectionIds;
    },
    flags?: NodeFlags,
  ): GraphNode;
  addAsync<TArgs extends unknown[], TResult>(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    config: {
      params: (ctx: GraphContext<TRuntime>) => TArgs;
      task: (...args: TArgs) => Promise<TResult>;
      initial: TResult;
      projections?: AsyncProjectionIds;
    },
    flags?: NodeFlags,
  ): GraphNode;
  addAsync<TArgs extends unknown[], TResult>(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    config: {
      params: (ctx: GraphContext<TRuntime>) => TArgs;
      task: (...args: TArgs) => Promise<TResult>;
      initial: TResult;
      projections?: AsyncProjectionIds;
    },
    flags: NodeFlags = {},
  ): GraphNode {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    this.assertNewId(nodeId);

    const resultId = toNodeId(config.projections?.result ?? `${nodeId}/result`);
    const loadingId = toNodeId(config.projections?.loading ?? `${nodeId}/loading`);
    const errorId = toNodeId(config.projections?.error ?? `${nodeId}/error`);

    this.addSignal<TResult>(resultId, config.initial, { out: true, computed: true });
    this.addSignal<boolean>(loadingId, false, { out: true, computed: true });
    this.addSignal<string | null>(errorId, null, { out: true, computed: true });

    const ctx = this.makeCtx();

    const node: GraphNode = {
      id: nodeId,
      kind: 'async',
      flags: { ...flags, computed: true },
      deps: [...depIds],
      outputs: [resultId, loadingId, errorId],
      meta: { version: 0, updatedAt: Date.now() },
    };

    this.nodes.set(nodeId, node);
    this.emitNodeAdd(node);

    let seq = 0;

    const stop = effect(() => {
      this.suspendCollector(() => {
        for (const dep of depIds) {
          this.get(dep);
        }

        const args = this.withDepsAudit(nodeId, depIds, () => this.untracked(() => config.params(ctx)));
        const current = ++seq;

        this.batch(() => {
          this.set(loadingId, true);
          this.set(errorId, null);
        });

        void (async () => {
          try {
            const result = await config.task(...args);
            if (current !== seq) {
              return;
            }
            this.batch(() => {
              this.set(resultId, result);
              this.set(loadingId, false);
            });
            this.touch(nodeId);
          } catch (err) {
            if (current !== seq) {
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            this.batch(() => {
              this.set(errorId, message);
              this.set(loadingId, false);
            });
            this.touch(nodeId);
          }
        })();

        this.touch(nodeId);
      });
    });

    this.disposers.push(stop);
    this.bump();
    return node;
  }

  createViewModelSignal<T>(viewId: string, selector: () => T): () => T {
    const existing = this.viewModels.get(viewId);
    if (existing) {
      return existing.$ as () => T;
    }

    const initial = this.collectRun(viewId, selector);
    const $ = alienSignal<T>(initial.value);

    this.setViewDeps(viewId, initial.deps);

    const stop = effect(() => {
      const next = this.collectRun(viewId, selector);
      $(next.value);
      this.setViewDeps(viewId, next.deps);
    });

    this.disposers.push(stop);
    this.viewModels.set(viewId, { $, stop });
    this.bump();

    return $;
  }

  disposeViewModel(viewId: string): void {
    const existing = this.viewModels.get(viewId);
    if (!existing) {
      return;
    }

    this.viewModels.delete(viewId);

    const stopIndex = this.disposers.indexOf(existing.stop);
    if (stopIndex >= 0) {
      this.disposers.splice(stopIndex, 1);
    }

    existing.stop();

    if (this.viewDeps.delete(viewId)) {
      this.bump();
    }
  }

  addConsumer(
    id: string,
    deps: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addConsumer<TSection extends NodeSection>(
    id: NodeRef<unknown, TSection>,
    deps: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addConsumer(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addConsumer(
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    run: (ctx: GraphContext<TRuntime>) => void,
    flags: NodeFlags = {},
  ): GraphNode {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    this.assertNewId(nodeId);

    const ctx = this.makeCtx();

    const node: GraphNode = {
      id: nodeId,
      kind: 'consumer',
      flags: { ...flags },
      deps: [...depIds],
      outputs: [],
      meta: { version: 0, updatedAt: Date.now() },
    };

    this.nodes.set(nodeId, node);
    this.emitNodeAdd(node);

    const stop = effect(() => {
      this.suspendCollector(() => {
        for (const dep of depIds) {
          this.get(dep);
        }

        this.withDepsAudit(nodeId, depIds, () => this.untracked(() => run(ctx)));

        this.touch(nodeId);
      });
    });

    this.disposers.push(stop);
    this.bump();
    return node;
  }

  private makeCtx(): GraphContext<TRuntime> {
    return {
      runtime: this.getRuntime(),
      get: <T>(id: GraphNodeIdLike) => this.get<T>(id),
      peek: <T>(id: GraphNodeIdLike) => this.peek<T>(id),
      set: <T>(id: GraphNodeIdLike, value: Setter<T>) => this.set<T>(id, value),
      batch: (fn) => this.batch(fn),
    };
  }

  private makeMiddlewareCtx(runtime: TRuntime): MiddlewareContext<TRuntime> {
    return { graph: this, runtime };
  }

  private runMiddlewareHook<T>(fn: () => T): T {
    const prevCollector = this.activeCollector;
    const prevAuditCollector = this.activeAuditCollector;

    this.activeCollector = null;
    this.activeAuditCollector = null;
    this.middlewareDepth += 1;
    try {
      return this.untracked(fn);
    } finally {
      this.middlewareDepth -= 1;
      this.activeAuditCollector = prevAuditCollector;
      this.activeCollector = prevCollector;
    }
  }

  private emitNodeAdd(node: GraphNode<any>): void {
    if (this.middlewares.length === 0 || this.middlewareDepth > 0) {
      return;
    }

    const runtime = this.getRuntime();
    const ctx = this.makeMiddlewareCtx(runtime);

    for (const mw of this.middlewares) {
      if (!mw.onNodeAdd) {
        continue;
      }
      this.runMiddlewareHook(() => mw.onNodeAdd!(node, ctx));
    }
  }

  private emitDispose(): void {
    if (this.middlewares.length === 0 || this.middlewareDepth > 0) {
      return;
    }

    const runtime = this.getRuntime();
    const ctx = this.makeMiddlewareCtx(runtime);

    for (let i = this.middlewares.length - 1; i >= 0; i -= 1) {
      const mw = this.middlewares[i];
      if (!mw.onDispose) {
        continue;
      }
      this.runMiddlewareHook(() => mw.onDispose!(ctx));
    }
  }

  private assertNewId(id: string): void {
    if (this.nodes.has(id)) {
      throw new Error(`Duplicate node id: ${id}`);
    }
  }

  private bump(): void {
    this.revisionCounter += 1;
    this.revisionSignal(this.revisionCounter);
  }

  private touch(id: string): void {
    const node = this.nodes.get(id);
    if (!node) {
      return;
    }
    node.meta.version += 1;
    node.meta.updatedAt = Date.now();
    this.bump();
  }

  private collect(id: string): void {
    if (this.activeCollector) {
      this.activeCollector.deps.add(id);
    }
    if (this.activeAuditCollector) {
      this.activeAuditCollector.reads.add(id);
    }
  }

  private suspendCollector<T>(fn: () => T): T {
    if (!this.activeCollector) {
      return fn();
    }
    const prev = this.activeCollector;
    this.activeCollector = null;
    try {
      return fn();
    } finally {
      this.activeCollector = prev;
    }
  }

  private withDepsAudit<T>(ownerId: string, deps: readonly string[], fn: () => T): T {
    if (this.depsAuditMode === 'off') {
      return fn();
    }

    const prev = this.activeAuditCollector;
    const collector: AuditCollectorState = {
      ownerId,
      declaredDeps: new Set(deps),
      reads: new Set(),
    };

    this.activeAuditCollector = collector;

    let auditError: Error | null = null;
    let threw = false;

    let result: T;
    try {
      result = fn();
    } catch (err) {
      threw = true;
      throw err;
    } finally {
      this.activeAuditCollector = prev;

      if (!threw) {
        const undeclared = Array.from(collector.reads)
          .filter((id) => !collector.declaredDeps.has(id))
          .sort();

        if (undeclared.length) {
          const message = `Undeclared deps read in ${collector.ownerId}: ${undeclared.join(', ')}`;

          if (this.depsAuditMode === 'warn') {
            console.warn(message);
          } else if (this.depsAuditMode === 'throw') {
            auditError = new Error(message);
          }
        }
      }
    }

    if (auditError) {
      throw auditError;
    }

    return result;
  }

  private collectRun<T>(viewId: string, selector: () => T): { value: T; deps: string[] } {
    const prev = this.activeCollector;
    const collector: CollectorState = { id: viewId, deps: new Set() };
    this.activeCollector = collector;
    try {
      const value = selector();
      return { value, deps: Array.from(collector.deps).sort() };
    } finally {
      this.activeCollector = prev;
    }
  }

  private setViewDeps(viewId: string, deps: string[]): void {
    const prev = this.viewDeps.get(viewId);
    if (prev && shallowArrayEqual(prev, deps)) {
      return;
    }
    this.viewDeps.set(viewId, deps);
    this.bump();
  }
}

function shallowArrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
