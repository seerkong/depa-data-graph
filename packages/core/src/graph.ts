import {
  computed as alienComputed,
  effect,
  endBatch,
  setActiveSub,
  signal as alienSignal,
  startBatch,
} from 'alien-signals';
import { Stream, type MemoryStream, type Producer, type Subscription } from 'xstream';

import type { BatchEvent, GraphMiddleware, MiddlewareContext } from './middleware';
import type { NodeRef, NodeSection } from './module-identity';
import { toNodeId } from './module-identity';

export type NodeKind =
  | 'signal'
  | 'computed'
  | 'processor'
  | 'async'
  | 'consumer'
  | 'source'
  | 'operator'
  | 'sink'
  | 'signalToStreamNode'
  | 'streamToSignal'
  | 'feedbackBoundary'
  // Reserved node kinds are intentionally part of the topology contract before
  // their state-node builders arrive in P2.
  | 'signalDrivenStateSignal'
  | 'signalDrivenStateStream'
  | 'streamDrivenStateSignal'
  | 'streamDrivenStateStream';

export type OutputSemantic = 'signal' | 'stream';

export type FeedbackBoundaryKind = 'feedback' | 'delay' | 'scheduler';
export type FeedbackQueuePolicy = 'fifo' | 'latest';
export type FeedbackScheduler = (task: () => void) => StopHandle;

export type FeedbackBoundaryOptions =
  | {
      kind: 'delay';
      queue: FeedbackQueuePolicy;
      delayMs: number;
    }
  | {
      kind: 'feedback' | 'scheduler';
      queue: FeedbackQueuePolicy;
      schedule: FeedbackScheduler;
    };

export type FeedbackBoundarySnapshot = {
  kind: FeedbackBoundaryKind;
  queue: FeedbackQueuePolicy;
  timing: 'delay' | 'scheduler';
  delayMs?: number;
};

export type SignalNodeRef<T = unknown, Writable extends boolean = boolean> = {
  readonly id: string;
  readonly protocol: 'signal';
  readonly writable: Writable;
  readonly __value?: T;
};

export type StreamNodeRef<T = unknown> = {
  readonly id: string;
  readonly protocol: 'stream';
  readonly __value?: T;
};

export type GraphNodeRef<T = unknown> = SignalNodeRef<T> | StreamNodeRef<T>;

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

export type GraphEdgeKind =
  | 'dependsOn'
  | 'streamDependsOn'
  | 'explicitConversion'
  | 'writesTo'
  | 'viewReads';

export type AsyncProjectionIds = {
  result?: GraphNodeIdLike;
  loading?: GraphNodeIdLike;
  error?: GraphNodeIdLike;
};

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /** Typed endpoint metadata keeps protocol crossings visible in snapshots. */
  fromRef?: GraphNodeRef;
  toRef?: GraphNodeRef;
  mode?: OutputSemantic | 'explicit-conversion';
  boundary?: FeedbackBoundaryKind;
}

export type StreamNodeMeta<T = unknown> = {
  eventCount: number;
  lastEvent?: T;
  lastEventAt?: number;
  isActive: boolean;
  subscriberCount: number;
};

export interface GraphNode<T = unknown, TRef extends GraphNodeRef<T> = GraphNodeRef<T>> {
  id: string;
  kind: NodeKind;
  outputSemantic: OutputSemantic;
  ref: TRef;
  flags: NodeFlags;
  deps: string[];
  outputs: string[];
  get?: () => T;
  snapshotValue?: () => T;
  set?: (value: Setter<T>) => void;
  stream$?: Stream<T>;
  streamMeta?: StreamNodeMeta<T>;
  feedback?: FeedbackBoundarySnapshot;
  disposed?: boolean;
  meta: {
    version: number;
    updatedAt: number;
  };
}

export interface GraphEffect {
  get<T>(id: string): T;
  get<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): TValue;
  get<T>(id: SignalNodeRef<T>): T;
  get<T>(id: GraphNodeIdLike): T;
  peek<T>(id: string): T;
  peek<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): TValue;
  peek<T>(id: SignalNodeRef<T>): T;
  peek<T>(id: GraphNodeIdLike): T;
  set<T>(id: string, value: Setter<T>): void;
  set<TValue, TSection extends NodeSection>(
    id: NodeRef<TValue, TSection>,
    value: Setter<TValue>,
  ): void;
  set<T>(id: SignalNodeRef<T, true>, value: Setter<T>): void;
  set<T>(id: GraphNodeIdLike, value: Setter<T>): void;
  batch<T>(fn: () => T): T;
}

export interface GraphRuntime<TBiz> {
  readonly bizRuntime: TBiz;
  graph: GraphEffect;
}

export type StateNodeInitial<TState> = TState | (() => TState);

export type StateMutationRegistry<TState> = Record<
  string,
  (state: TState, ...payload: never[]) => TState
>;
export type StateActionRegistry = Record<string, (...payload: never[]) => unknown>;
export type EmptyStateMutationRegistry = Record<never, never>;
export type EmptyStateActionRegistry = Record<never, never>;

type FunctionParameters<T> = T extends (...args: infer TParameters) => unknown
  ? TParameters
  : never;
type FunctionResult<T> = T extends (...args: never[]) => infer TResult ? TResult : never;
type Tail<T extends readonly unknown[]> = T extends readonly [unknown, ...infer TRest]
  ? TRest
  : never;
type MutationPayload<TMutation> = Tail<FunctionParameters<TMutation>>;

export interface StateMutationOperation<
  TName extends string = string,
  TPayload extends readonly unknown[] = readonly unknown[],
> {
  readonly nodeId: string;
  readonly kind: 'mutation';
  readonly name: TName;
  readonly payload: TPayload;
  readonly sequence: number;
  readonly createdAt: number;
}

export interface StateActionOperation<
  TName extends string = string,
  TPayload extends readonly unknown[] = readonly unknown[],
> {
  readonly nodeId: string;
  readonly kind: 'action';
  readonly name: TName;
  readonly payload: TPayload;
  readonly sequence: number;
  readonly createdAt: number;
}

export type StateNodeOperationRecord =
  | StateMutationOperation<string, readonly unknown[]>
  | StateActionOperation<string, readonly unknown[]>;

export type StateMutationOperations<TMutations> = {
  [TName in keyof TMutations & string]: StateMutationOperation<
    TName,
    MutationPayload<TMutations[TName]>
  >;
}[keyof TMutations & string];

export type StateActionOperations<TActions> = {
  [TName in keyof TActions & string]: StateActionOperation<
    TName,
    FunctionParameters<TActions[TName]>
  >;
}[keyof TActions & string];

export type StateNodeOperation<TMutations, TActions> =
  | StateMutationOperations<TMutations>
  | StateActionOperations<TActions>;

export type MutationFacade<TState, TMutations> = {
  readonly [TName in keyof TMutations]: (...payload: MutationPayload<TMutations[TName]>) => TState;
};

export type ActionFacade<TActions> = {
  readonly [TName in keyof TActions]: (
    ...payload: FunctionParameters<TActions[TName]>
  ) => FunctionResult<TActions[TName]>;
};

export type MutationOperationCreators<TMutations> = {
  readonly [TName in keyof TMutations]: (
    ...payload: MutationPayload<TMutations[TName]>
  ) => StateMutationOperation<TName & string, MutationPayload<TMutations[TName]>>;
};

export type ActionOperationCreators<TActions> = {
  readonly [TName in keyof TActions]: (
    ...payload: FunctionParameters<TActions[TName]>
  ) => StateActionOperation<TName & string, FunctionParameters<TActions[TName]>>;
};

export interface StateNodeOperationCreators<TMutations, TActions> {
  readonly mutations: MutationOperationCreators<TMutations>;
  readonly actions: ActionOperationCreators<TActions>;
}

export type StateNodeOperationResult<TState, TActions, TOperation> =
  TOperation extends StateMutationOperation
    ? TState
    : TOperation extends StateActionOperation<infer TName>
      ? TName extends keyof TActions
        ? FunctionResult<TActions[TName]>
        : never
      : never;

export interface StateNodeActionRuntime<
  TBiz,
  TState,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> {
  readonly bizRuntime: TBiz;
  readonly graph: GraphEffect;
  getState(): TState;
  readonly mutations: MutationFacade<TState, TMutations>;
  dispatch<TOperation extends StateNodeOperation<TMutations, TActions>>(
    operation: TOperation,
  ): StateNodeOperationResult<TState, TActions, TOperation>;
}

export type StateNodeActionFactory<
  TBiz,
  TState,
  TMutations extends StateMutationRegistry<TState>,
> = (
  rt: StateNodeActionRuntime<TBiz, TState, TMutations, EmptyStateActionRegistry>,
) => StateActionRegistry;

export type StateActionsFromFactory<TFactory> = TFactory extends (
  ...payload: never[]
) => infer TActions
  ? TActions extends StateActionRegistry
    ? TActions
    : EmptyStateActionRegistry
  : EmptyStateActionRegistry;

interface StateNodeOperationsConfig<
  TBiz,
  TState,
  TMutations extends StateMutationRegistry<TState>,
  TActions extends StateActionRegistry,
> {
  mutations?: TMutations & NoInfer<StateMutationRegistry<TState>>;
  actions?: (rt: StateNodeActionRuntime<TBiz, TState, TMutations, NoInfer<TActions>>) => TActions;
}

export interface SignalDrivenStateNodeConfig<
  TInput,
  TState,
  TBiz = unknown,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> extends StateNodeOperationsConfig<TBiz, TState, TMutations, TActions> {
  id?: GraphNodeIdLike;
  input: SignalNodeRef<TInput>;
  initial: StateNodeInitial<TState>;
  reducer: (state: TState, input: TInput) => TState;
  flags?: NodeFlags;
}

export interface StreamDrivenStateNodeConfig<
  TInput,
  TState,
  TBiz = unknown,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> extends StateNodeOperationsConfig<TBiz, TState, TMutations, TActions> {
  id?: GraphNodeIdLike;
  input: StreamNodeRef<TInput>;
  initial: StateNodeInitial<TState>;
  reducer: (state: TState, input: TInput) => TState;
  flags?: NodeFlags;
}

type SignalDrivenStateNodeBuilderConfig<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState>,
  TActionFactory,
> = {
  id?: GraphNodeIdLike;
  input: SignalNodeRef<TInput>;
  initial: StateNodeInitial<TState>;
  reducer: (state: TState, input: TInput) => TState;
  mutations?: TMutations & NoInfer<StateMutationRegistry<TState>>;
  actions?: TActionFactory;
  flags?: NodeFlags;
};

type StreamDrivenStateNodeBuilderConfig<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState>,
  TActionFactory,
> = {
  id?: GraphNodeIdLike;
  input: StreamNodeRef<TInput>;
  initial: StateNodeInitial<TState>;
  reducer: (state: TState, input: TInput) => TState;
  mutations?: TMutations & NoInfer<StateMutationRegistry<TState>>;
  actions?: TActionFactory;
  flags?: NodeFlags;
};

type SignalDrivenStateNodeMutationConfig<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState>,
> = SignalDrivenStateNodeBuilderConfig<TInput, TState, TMutations, undefined> & {
  mutations: TMutations;
  actions?: undefined;
};

type SignalDrivenStateNodeActionConfig<TInput, TState, TBiz, TActionFactory> =
  SignalDrivenStateNodeBuilderConfig<TInput, TState, EmptyStateMutationRegistry, TActionFactory> & {
    mutations?: undefined;
    actions: TActionFactory &
      ((
        rt: StateNodeActionRuntime<TBiz, TState, EmptyStateMutationRegistry>,
      ) => StateActionRegistry);
  };

type SignalDrivenStateNodeOperationsConfig<
  TInput,
  TState,
  TBiz,
  TMutations extends StateMutationRegistry<TState>,
  TActionFactory,
> = SignalDrivenStateNodeBuilderConfig<TInput, TState, TMutations, TActionFactory> & {
  mutations: TMutations;
  actions: TActionFactory &
    ((
      rt: StateNodeActionRuntime<TBiz, TState, NoInfer<TMutations>, EmptyStateActionRegistry>,
    ) => StateActionRegistry);
};

type StreamDrivenStateNodeMutationConfig<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState>,
> = StreamDrivenStateNodeBuilderConfig<TInput, TState, TMutations, undefined> & {
  mutations: TMutations;
  actions?: undefined;
};

type StreamDrivenStateNodeActionConfig<TInput, TState, TBiz, TActionFactory> =
  StreamDrivenStateNodeBuilderConfig<TInput, TState, EmptyStateMutationRegistry, TActionFactory> & {
    mutations?: undefined;
    actions: TActionFactory &
      ((
        rt: StateNodeActionRuntime<TBiz, TState, EmptyStateMutationRegistry>,
      ) => StateActionRegistry);
  };

type StreamDrivenStateNodeOperationsConfig<
  TInput,
  TState,
  TBiz,
  TMutations extends StateMutationRegistry<TState>,
  TActionFactory,
> = StreamDrivenStateNodeBuilderConfig<TInput, TState, TMutations, TActionFactory> & {
  mutations: TMutations;
  actions: TActionFactory &
    ((
      rt: StateNodeActionRuntime<TBiz, TState, NoInfer<TMutations>, EmptyStateActionRegistry>,
    ) => StateActionRegistry);
};

export interface StateNodeHandle<
  TState,
  TOutput extends GraphNodeRef<TState>,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> {
  readonly output: TOutput;
  readonly operations: StateNodeOperationCreators<TMutations, TActions>;
  readonly mutations: MutationFacade<TState, TMutations>;
  readonly actions: ActionFacade<TActions>;
  getState(): TState;
  dispatch<TOperation extends StateNodeOperation<TMutations, TActions>>(
    operation: TOperation,
  ): StateNodeOperationResult<TState, TActions, TOperation>;
  dispose(): void;
}

export type StateNodeCoreHandle<TState, TOutput extends GraphNodeRef<TState>> = StateNodeHandle<
  TState,
  TOutput
>;

type StateNodeOutputRef<TState, TOutput extends OutputSemantic> = TOutput extends 'signal'
  ? SignalNodeRef<TState, false>
  : StreamNodeRef<TState>;

type StateNodeInputBrand<TInput> = { readonly __input?: TInput };

export type SignalDrivenStateSignalNode<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> = StateNodeHandle<TState, SignalNodeRef<TState, false>, TMutations, TActions> &
  StateNodeInputBrand<TInput>;

export type SignalDrivenStateStreamNode<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> = StateNodeHandle<TState, StreamNodeRef<TState>, TMutations, TActions> &
  StateNodeInputBrand<TInput>;

export type StreamDrivenStateSignalNode<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> = StateNodeHandle<TState, SignalNodeRef<TState, false>, TMutations, TActions> &
  StateNodeInputBrand<TInput>;

export type StreamDrivenStateStreamNode<
  TInput,
  TState,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActions extends StateActionRegistry = EmptyStateActionRegistry,
> = StateNodeHandle<TState, StreamNodeRef<TState>, TMutations, TActions> &
  StateNodeInputBrand<TInput>;

/** Legacy string/module-ref identity accepted where protocol is unavailable. */
export type GraphNodeIdLike = string | NodeRef<unknown, NodeSection>;
export type SignalNodeIdLike = GraphNodeIdLike | SignalNodeRef<unknown>;
export type StreamNodeIdLike = GraphNodeIdLike | StreamNodeRef<unknown>;

export interface GraphSnapshot {
  revision: number;
  nodes: Array<{
    id: string;
    kind: NodeKind;
    outputSemantic: OutputSemantic;
    lifecycle: 'inactive' | 'active' | 'disposed';
    flags: NodeFlags;
    deps: string[];
    outputs: string[];
    version: number;
    updatedAt: number;
    value: unknown;
    stream?: {
      started: boolean;
      subscriberCount: number;
      eventCount: number;
      lastEvent?: unknown;
      lastEventAt?: number;
    };
    feedback?: FeedbackBoundarySnapshot;
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
    }
  | {
      kind: 'mixedCycle';
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
  private nodeRegistry = new Map<string, GraphNode<any>>();
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
  private activeStreamStops = new Set<StopHandle>();
  private generatedStateNodeCounter = 0;

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

    for (const stop of this.disposers.splice(0).reverse()) {
      stop();
    }
    for (const stop of [...this.activeStreamStops]) {
      stop();
    }
    this.activeStreamStops.clear();
  }

  revision(): () => number {
    return this.revisionSignal;
  }

  snapshot(): GraphSnapshot {
    const nodes = Array.from(this.nodeRegistry.values())
      .map((node) => {
        const lifecycle: GraphSnapshot['nodes'][number]['lifecycle'] =
          this.disposed || node.disposed
            ? 'disposed'
            : node.streamMeta?.isActive === false
              ? 'inactive'
              : 'active';
        return {
          id: node.id,
          kind: node.kind,
          outputSemantic: node.outputSemantic,
          lifecycle,
          flags: node.flags,
          deps: [...node.deps],
          outputs: [...node.outputs],
          version: node.meta.version,
          updatedAt: node.meta.updatedAt,
          value: node.snapshotValue
            ? this.untracked(() => node.snapshotValue!())
            : node.get
              ? this.untracked(() => node.get!())
              : undefined,
          stream: node.streamMeta
            ? {
                started: node.streamMeta.isActive,
                subscriberCount: node.streamMeta.subscriberCount,
                eventCount: node.streamMeta.eventCount,
                lastEvent: node.streamMeta.lastEvent,
                lastEventAt: node.streamMeta.lastEventAt,
              }
            : undefined,
          feedback: node.feedback ? { ...node.feedback } : undefined,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const edges: GraphEdge[] = [];

    for (const node of this.nodeRegistry.values()) {
      for (const dep of node.deps) {
        const fromNode = this.nodeRegistry.get(dep);
        const isStreamEdge =
          node.outputSemantic === 'stream' && fromNode?.outputSemantic === 'stream';
        const isConversion = node.kind === 'signalToStreamNode' || node.kind === 'streamToSignal';
        edges.push({
          from: dep,
          to: node.id,
          kind: isConversion
            ? 'explicitConversion'
            : isStreamEdge
              ? 'streamDependsOn'
              : 'dependsOn',
          fromRef: fromNode?.ref,
          toRef: node.ref,
          mode: isConversion
            ? 'explicit-conversion'
            : isStreamEdge
              ? 'stream'
              : fromNode?.outputSemantic,
          boundary: node.feedback?.kind,
        });
      }
      for (const out of node.outputs) {
        const outNode = this.nodeRegistry.get(out);
        edges.push({
          from: node.id,
          to: out,
          kind: 'writesTo',
          fromRef: node.ref,
          toRef: outNode?.ref,
          mode: node.outputSemantic,
        });
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

    for (const node of this.nodeRegistry.values()) {
      for (const dep of node.deps) {
        if (!this.nodeRegistry.has(dep)) {
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
        const outNode = this.nodeRegistry.get(out);
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
        if (!this.nodeRegistry.has(dep)) {
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
    for (const node of this.nodeRegistry.values()) {
      adjacency.set(
        node.id,
        node.feedback ? [] : node.deps.filter((dep) => this.nodeRegistry.has(dep)),
      );
    }
    for (const node of this.nodeRegistry.values()) {
      for (const output of node.outputs) {
        if (this.nodeRegistry.has(output)) {
          adjacency.get(output)?.push(node.id);
        }
      }
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

      const semantics = new Set(path.map((id) => this.nodeRegistry.get(id)?.outputSemantic));
      if (semantics.has('signal') && semantics.has('stream')) {
        errors.push({
          kind: 'mixedCycle',
          path,
          message: `Mixed Signal/Stream cycle detected: ${display}`,
          suggestion:
            'Insert an explicit feedback, delay, or scheduler boundary to advance delivery.',
        });
      } else {
        errors.push({
          kind: 'cycle',
          path,
          message: `Dependency cycle detected: ${display}`,
          suggestion: 'Break the cycle by removing a dependency edge.',
        });
      }
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
  node<T>(id: GraphNodeRef<T>): GraphNode<T>;
  node<T = unknown>(id: GraphNodeIdLike | GraphNodeRef<T>): GraphNode<T>;
  node<T = unknown>(id: GraphNodeIdLike | GraphNodeRef<T>): GraphNode<T> {
    const nodeId = toNodeId(id);
    const n = this.nodeRegistry.get(nodeId);
    if (!n) {
      throw new Error(`Unknown node: ${nodeId}`);
    }
    return n as GraphNode<T>;
  }

  get<T>(id: string): T;
  get<TValue, TSection extends NodeSection>(id: NodeRef<TValue, TSection>): TValue;
  get<T>(id: SignalNodeRef<T>): T;
  get<T>(id: SignalNodeIdLike): T;
  get<T>(id: SignalNodeIdLike): T {
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
  peek<T>(id: SignalNodeRef<T>): T;
  peek<T>(id: SignalNodeIdLike): T;
  peek<T>(id: SignalNodeIdLike): T {
    return this.untracked(() => this.get<T>(id));
  }

  set<T>(id: string, value: Setter<T>): void;
  set<TValue, TSection extends NodeSection>(
    id: NodeRef<TValue, TSection>,
    value: Setter<TValue>,
  ): void;
  set<T>(id: SignalNodeRef<T, true>, value: Setter<T>): void;
  set<T>(id: SignalNodeIdLike, value: Setter<T>): void {
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

  addSignal<T>(
    id: string,
    initialValue: T,
    flags?: NodeFlags,
  ): GraphNode<T, SignalNodeRef<T, true>>;
  addSignal<T, TSection extends NodeSection>(
    id: NodeRef<T, TSection>,
    initialValue: T,
    flags?: NodeFlags,
  ): GraphNode<T, SignalNodeRef<T, true>>;
  addSignal<T>(
    id: GraphNodeIdLike,
    initialValue: T,
    flags?: NodeFlags,
  ): GraphNode<T, SignalNodeRef<T, true>>;
  addSignal<T>(
    id: GraphNodeIdLike,
    initialValue: T,
    flags: NodeFlags = {},
  ): GraphNode<T, SignalNodeRef<T, true>> {
    const nodeId = toNodeId(id);
    this.assertNewId(nodeId);

    const $ = alienSignal<T>(initialValue);

    const node: GraphNode<T, SignalNodeRef<T, true>> = {
      id: nodeId,
      kind: 'signal',
      outputSemantic: 'signal',
      ref: makeSignalRef<T, true>(nodeId, true),
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

    this.nodeRegistry.set(nodeId, node);
    this.emitNodeAdd(node);
    this.bump();
    return node;
  }

  addComputed<T>(
    id: string,
    deps: readonly SignalNodeIdLike[],
    getter: (rt: GraphRuntime<TRuntime>, prev?: T) => T,
    flags?: NodeFlags,
  ): GraphNode<T, SignalNodeRef<T, false>>;
  addComputed<T, TSection extends NodeSection>(
    id: NodeRef<T, TSection>,
    deps: readonly SignalNodeIdLike[],
    getter: (rt: GraphRuntime<TRuntime>, prev?: T) => T,
    flags?: NodeFlags,
  ): GraphNode<T, SignalNodeRef<T, false>>;
  addComputed<T>(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    getter: (rt: GraphRuntime<TRuntime>, prev?: T) => T,
    flags?: NodeFlags,
  ): GraphNode<T, SignalNodeRef<T, false>>;
  addComputed<T>(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    getter: (rt: GraphRuntime<TRuntime>, prev?: T) => T,
    flags: NodeFlags = {},
  ): GraphNode<T, SignalNodeRef<T, false>> {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    this.assertNewId(nodeId);

    const rt = this.makeRuntime();

    const meta = { version: 0, updatedAt: Date.now() };
    let hasValue = false;
    let lastValue: T | undefined;

    const $ = alienComputed<T>((prev) => {
      for (const dep of depIds) {
        this.get(dep);
      }

      const next = this.withDepsAudit(nodeId, depIds, () =>
        this.suspendCollector(() => this.untracked(() => getter(rt, prev))),
      );

      if (hasValue && !Object.is(lastValue, next)) {
        meta.version += 1;
        meta.updatedAt = Date.now();
      }

      hasValue = true;
      lastValue = next;
      return next;
    });

    const node: GraphNode<T, SignalNodeRef<T, false>> = {
      id: nodeId,
      kind: 'computed',
      outputSemantic: 'signal',
      ref: makeSignalRef<T, false>(nodeId, false),
      flags: { ...flags, computed: true },
      deps: [...depIds],
      outputs: [],
      meta,
      get: () => {
        this.collect(nodeId);
        return this.suspendCollector(() => $());
      },
    };

    this.nodeRegistry.set(nodeId, node);
    this.emitNodeAdd(node);
    this.bump();
    return node;
  }

  addProcessor(
    id: string,
    deps: readonly SignalNodeIdLike[],
    outputs: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addProcessor<TSection extends NodeSection>(
    id: NodeRef<unknown, TSection>,
    deps: readonly SignalNodeIdLike[],
    outputs: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addProcessor(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    outputs: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addProcessor(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    outputs: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags: NodeFlags = {},
  ): GraphNode {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    const outputIds = outputs.map((out) => toNodeId(out));
    this.assertNewId(nodeId);

    const rt = this.makeRuntime();

    const node: GraphNode = {
      id: nodeId,
      kind: 'processor',
      outputSemantic: 'signal',
      ref: makeSignalRef(nodeId, false),
      flags: { ...flags },
      deps: [...depIds],
      outputs: [...outputIds],
      meta: { version: 0, updatedAt: Date.now() },
    };

    this.nodeRegistry.set(nodeId, node);
    this.emitNodeAdd(node);

    const stop = effect(() => {
      this.suspendCollector(() => {
        for (const dep of depIds) {
          this.get(dep);
        }

        this.batch(() => {
          this.withDepsAudit(nodeId, depIds, () => this.untracked(() => run(rt)));
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
    deps: readonly SignalNodeIdLike[],
    config: {
      params: (rt: GraphRuntime<TRuntime>) => TArgs;
      task: (...args: TArgs) => Promise<TResult>;
      initial: TResult;
      projections?: AsyncProjectionIds;
    },
    flags?: NodeFlags,
  ): GraphNode;
  addAsync<TArgs extends unknown[], TResult, TSection extends NodeSection>(
    id: NodeRef<unknown, TSection>,
    deps: readonly SignalNodeIdLike[],
    config: {
      params: (rt: GraphRuntime<TRuntime>) => TArgs;
      task: (...args: TArgs) => Promise<TResult>;
      initial: TResult;
      projections?: AsyncProjectionIds;
    },
    flags?: NodeFlags,
  ): GraphNode;
  addAsync<TArgs extends unknown[], TResult>(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    config: {
      params: (rt: GraphRuntime<TRuntime>) => TArgs;
      task: (...args: TArgs) => Promise<TResult>;
      initial: TResult;
      projections?: AsyncProjectionIds;
    },
    flags?: NodeFlags,
  ): GraphNode;
  addAsync<TArgs extends unknown[], TResult>(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    config: {
      params: (rt: GraphRuntime<TRuntime>) => TArgs;
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

    const rt = this.makeRuntime();

    const node: GraphNode = {
      id: nodeId,
      kind: 'async',
      outputSemantic: 'signal',
      ref: makeSignalRef(nodeId, false),
      flags: { ...flags, computed: true },
      deps: [...depIds],
      outputs: [resultId, loadingId, errorId],
      meta: { version: 0, updatedAt: Date.now() },
    };

    this.nodeRegistry.set(nodeId, node);
    this.emitNodeAdd(node);

    let seq = 0;

    const stop = effect(() => {
      this.suspendCollector(() => {
        for (const dep of depIds) {
          this.get(dep);
        }

        const args = this.withDepsAudit(nodeId, depIds, () =>
          this.untracked(() => config.params(rt)),
        );
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

  /**
   * Registers an event source in the same node registry as Signals. Source
   * activation remains demand-driven; registering a source does not subscribe.
   */
  addSource<T>(
    id: StreamNodeIdLike,
    source: Producer<T> | Stream<T>,
    flags: NodeFlags = {},
  ): GraphNode<T, StreamNodeRef<T>> {
    const nodeId = toNodeId(id);
    this.assertNewId(nodeId);
    const stream$ = source instanceof Stream ? source : Stream.create<T>(source);
    return this.addStreamNode(nodeId, 'source', [], stream$, flags);
  }

  /** Registers a stream transformation with explicitly typed stream inputs. */
  addOperator<TOut>(
    id: StreamNodeIdLike,
    deps: readonly StreamNodeIdLike[],
    operator: (inputs: Record<string, Stream<unknown>>) => Stream<TOut>,
    flags: NodeFlags = {},
  ): GraphNode<TOut, StreamNodeRef<TOut>> {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    this.assertNewId(nodeId);

    const inputs: Record<string, Stream<unknown>> = {};
    for (const depId of depIds) {
      inputs[depId] = this.stream(depId);
    }

    return this.addStreamNode(nodeId, 'operator', depIds, operator(inputs), flags);
  }

  /** Registers and eagerly activates an explicit stream terminal. */
  addSink<T>(
    id: StreamNodeIdLike,
    deps: readonly StreamNodeIdLike[],
    handler: (value: T) => void,
    flags: NodeFlags = {},
  ): GraphNode<void, StreamNodeRef<void>> {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    this.assertNewId(nodeId);

    const streams = depIds.map((depId) => this.stream<T>(depId));
    const merged = streams.length === 1 ? streams[0] : Stream.merge(...streams);
    const node = this.addStreamNode(
      nodeId,
      'sink',
      depIds,
      merged.map<void>((value) => {
        handler(value);
        return undefined;
      }),
      flags,
    );
    const subscription = this.stream(node.ref).subscribe({
      next: () => {},
      error: (error) => console.error(`Stream sink ${nodeId} error:`, error),
      complete: () => {},
    });
    this.disposers.push(() => subscription.unsubscribe());
    return node;
  }

  /** Makes the Signal-to-Stream boundary explicit in the shared topology. */
  addSignalToStream<T>(
    id: StreamNodeIdLike,
    input: SignalNodeRef<T> | GraphNodeIdLike,
    flags: NodeFlags = {},
  ): GraphNode<T, StreamNodeRef<T>> {
    const nodeId = toNodeId(id);
    const inputId = toNodeId(input);
    this.assertNewId(nodeId);

    let stop: StopHandle | undefined;
    const stream$ = Stream.create<T>({
      start: (listener) => {
        stop = effect(() => listener.next(this.get<T>(inputId)));
      },
      stop: () => {
        stop?.();
        stop = undefined;
      },
    });
    return this.addStreamNode(nodeId, 'signalToStreamNode', [inputId], stream$, flags);
  }

  /**
   * Advances Stream delivery across an explicit asynchronous turn. The queue
   * and scheduler are part of the boundary contract and disposal cancels both.
   */
  addFeedbackBoundary<T>(
    id: StreamNodeIdLike,
    input: StreamNodeRef<T> | GraphNodeIdLike,
    options: FeedbackBoundaryOptions,
    flags: NodeFlags = {},
  ): GraphNode<T, StreamNodeRef<T>> {
    const nodeId = toNodeId(id);
    const inputId = toNodeId(input);
    this.assertNewId(nodeId);
    if (options.kind === 'delay' && (!Number.isFinite(options.delayMs) || options.delayMs < 0)) {
      throw new Error('Feedback delayMs must be a finite non-negative number');
    }

    const feedback: FeedbackBoundarySnapshot =
      options.kind === 'delay'
        ? {
            kind: options.kind,
            queue: options.queue,
            timing: 'delay',
            delayMs: options.delayMs,
          }
        : { kind: options.kind, queue: options.queue, timing: 'scheduler' };

    const stream$ = this.createFeedbackBoundaryStream(input, options);
    return this.addStreamNode(nodeId, 'feedbackBoundary', [inputId], stream$, flags, feedback);
  }

  /**
   * Makes the Stream-to-Signal latest/reducer boundary explicit. It is the
   * small topology primitive, not a P2 state-node mutation/action surface.
   */
  addStreamToSignal<TInput, TState>(
    id: SignalNodeIdLike,
    input: StreamNodeRef<TInput> | GraphNodeIdLike,
    initial: TState,
    reduce: (state: TState, value: TInput) => TState,
    flags: NodeFlags = {},
  ): GraphNode<TState, SignalNodeRef<TState, false>> {
    const nodeId = toNodeId(id);
    const inputId = toNodeId(input);
    this.assertNewId(nodeId);

    const $ = alienSignal<TState>(initial);
    const node: GraphNode<TState, SignalNodeRef<TState, false>> = {
      id: nodeId,
      kind: 'streamToSignal',
      outputSemantic: 'signal',
      ref: makeSignalRef<TState, false>(nodeId, false),
      flags: { ...flags },
      deps: [inputId],
      outputs: [],
      meta: { version: 0, updatedAt: Date.now() },
      get: () => {
        this.collect(nodeId);
        return $();
      },
    };

    this.nodeRegistry.set(nodeId, node);
    this.emitNodeAdd(node);
    this.bump();

    const subscription = this.stream<TInput>(input).subscribe({
      next: (value) => {
        const previous = this.untracked(() => $());
        const next = reduce(previous, value);
        if (Object.is(previous, next)) {
          return;
        }
        $(next);
        this.touch(nodeId);
      },
      error: () => {},
      complete: () => {},
    });
    this.disposers.push(() => subscription.unsubscribe());
    return node;
  }

  addSignalDrivenStateSignalNode<TInput, TState>(
    config: SignalDrivenStateNodeBuilderConfig<
      TInput,
      TState,
      EmptyStateMutationRegistry,
      undefined
    >,
  ): SignalDrivenStateSignalNode<TInput, TState>;
  addSignalDrivenStateSignalNode<TInput, TState, TMutations extends StateMutationRegistry<TState>>(
    config: SignalDrivenStateNodeMutationConfig<TInput, TState, TMutations>,
  ): SignalDrivenStateSignalNode<TInput, TState, TMutations>;
  addSignalDrivenStateSignalNode<
    TInput,
    TState,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: SignalDrivenStateNodeActionConfig<TInput, TState, TRuntime, TActionFactory>,
  ): SignalDrivenStateSignalNode<
    TInput,
    TState,
    EmptyStateMutationRegistry,
    StateActionsFromFactory<TActionFactory>
  >;
  addSignalDrivenStateSignalNode<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: SignalDrivenStateNodeOperationsConfig<
      TInput,
      TState,
      TRuntime,
      TMutations,
      TActionFactory
    >,
  ): SignalDrivenStateSignalNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  addSignalDrivenStateSignalNode(config: unknown): unknown {
    return this.addStateNode(
      config as SignalDrivenStateNodeConfig<
        unknown,
        unknown,
        TRuntime,
        StateMutationRegistry<unknown>,
        StateActionRegistry
      >,
      'signalDrivenStateSignal',
      'signal',
    );
  }

  addSignalDrivenStateStreamNode<TInput, TState>(
    config: SignalDrivenStateNodeBuilderConfig<
      TInput,
      TState,
      EmptyStateMutationRegistry,
      undefined
    >,
  ): SignalDrivenStateStreamNode<TInput, TState>;
  addSignalDrivenStateStreamNode<TInput, TState, TMutations extends StateMutationRegistry<TState>>(
    config: SignalDrivenStateNodeMutationConfig<TInput, TState, TMutations>,
  ): SignalDrivenStateStreamNode<TInput, TState, TMutations>;
  addSignalDrivenStateStreamNode<
    TInput,
    TState,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: SignalDrivenStateNodeActionConfig<TInput, TState, TRuntime, TActionFactory>,
  ): SignalDrivenStateStreamNode<
    TInput,
    TState,
    EmptyStateMutationRegistry,
    StateActionsFromFactory<TActionFactory>
  >;
  addSignalDrivenStateStreamNode<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: SignalDrivenStateNodeOperationsConfig<
      TInput,
      TState,
      TRuntime,
      TMutations,
      TActionFactory
    >,
  ): SignalDrivenStateStreamNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  addSignalDrivenStateStreamNode(config: unknown): unknown {
    return this.addStateNode(
      config as SignalDrivenStateNodeConfig<
        unknown,
        unknown,
        TRuntime,
        StateMutationRegistry<unknown>,
        StateActionRegistry
      >,
      'signalDrivenStateStream',
      'stream',
    );
  }

  addStreamDrivenStateSignalNode<TInput, TState>(
    config: StreamDrivenStateNodeBuilderConfig<
      TInput,
      TState,
      EmptyStateMutationRegistry,
      undefined
    >,
  ): StreamDrivenStateSignalNode<TInput, TState>;
  addStreamDrivenStateSignalNode<TInput, TState, TMutations extends StateMutationRegistry<TState>>(
    config: StreamDrivenStateNodeMutationConfig<TInput, TState, TMutations>,
  ): StreamDrivenStateSignalNode<TInput, TState, TMutations>;
  addStreamDrivenStateSignalNode<
    TInput,
    TState,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: StreamDrivenStateNodeActionConfig<TInput, TState, TRuntime, TActionFactory>,
  ): StreamDrivenStateSignalNode<
    TInput,
    TState,
    EmptyStateMutationRegistry,
    StateActionsFromFactory<TActionFactory>
  >;
  addStreamDrivenStateSignalNode<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: StreamDrivenStateNodeOperationsConfig<
      TInput,
      TState,
      TRuntime,
      TMutations,
      TActionFactory
    >,
  ): StreamDrivenStateSignalNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  addStreamDrivenStateSignalNode(config: unknown): unknown {
    return this.addStateNode(
      config as StreamDrivenStateNodeConfig<
        unknown,
        unknown,
        TRuntime,
        StateMutationRegistry<unknown>,
        StateActionRegistry
      >,
      'streamDrivenStateSignal',
      'signal',
    );
  }

  addStreamDrivenStateStreamNode<TInput, TState>(
    config: StreamDrivenStateNodeBuilderConfig<
      TInput,
      TState,
      EmptyStateMutationRegistry,
      undefined
    >,
  ): StreamDrivenStateStreamNode<TInput, TState>;
  addStreamDrivenStateStreamNode<TInput, TState, TMutations extends StateMutationRegistry<TState>>(
    config: StreamDrivenStateNodeMutationConfig<TInput, TState, TMutations>,
  ): StreamDrivenStateStreamNode<TInput, TState, TMutations>;
  addStreamDrivenStateStreamNode<
    TInput,
    TState,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: StreamDrivenStateNodeActionConfig<TInput, TState, TRuntime, TActionFactory>,
  ): StreamDrivenStateStreamNode<
    TInput,
    TState,
    EmptyStateMutationRegistry,
    StateActionsFromFactory<TActionFactory>
  >;
  addStreamDrivenStateStreamNode<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: StreamDrivenStateNodeOperationsConfig<
      TInput,
      TState,
      TRuntime,
      TMutations,
      TActionFactory
    >,
  ): StreamDrivenStateStreamNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  addStreamDrivenStateStreamNode(config: unknown): unknown {
    return this.addStateNode(
      config as StreamDrivenStateNodeConfig<
        unknown,
        unknown,
        TRuntime,
        StateMutationRegistry<unknown>,
        StateActionRegistry
      >,
      'streamDrivenStateStream',
      'stream',
    );
  }

  /** Reads an event stream only from a stream-output node. */
  stream<T>(id: StreamNodeRef<T> | GraphNodeIdLike): Stream<T> {
    const nodeId = toNodeId(id);
    const node = this.node<T>(nodeId);
    if (node.outputSemantic !== 'stream' || !node.stream$) {
      throw new Error(`Node is not a stream: ${nodeId}`);
    }
    return this.observeStream(node);
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
    deps: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addConsumer<TSection extends NodeSection>(
    id: NodeRef<unknown, TSection>,
    deps: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addConsumer(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ): GraphNode;
  addConsumer(
    id: GraphNodeIdLike,
    deps: readonly SignalNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags: NodeFlags = {},
  ): GraphNode {
    const nodeId = toNodeId(id);
    const depIds = deps.map((dep) => toNodeId(dep));
    this.assertNewId(nodeId);

    const rt = this.makeRuntime();

    const node: GraphNode = {
      id: nodeId,
      kind: 'consumer',
      outputSemantic: 'signal',
      ref: makeSignalRef(nodeId, false),
      flags: { ...flags },
      deps: [...depIds],
      outputs: [],
      meta: { version: 0, updatedAt: Date.now() },
    };

    this.nodeRegistry.set(nodeId, node);
    this.emitNodeAdd(node);

    const stop = effect(() => {
      this.suspendCollector(() => {
        for (const dep of depIds) {
          this.get(dep);
        }

        this.withDepsAudit(nodeId, depIds, () => this.untracked(() => run(rt)));

        this.touch(nodeId);
      });
    });

    this.disposers.push(stop);
    this.bump();
    return node;
  }

  private addStreamNode<T>(
    id: string,
    kind: Extract<
      NodeKind,
      'source' | 'operator' | 'sink' | 'signalToStreamNode' | 'feedbackBoundary'
    >,
    deps: string[],
    source$: Stream<T>,
    flags: NodeFlags,
    feedback?: FeedbackBoundarySnapshot,
  ): GraphNode<T, StreamNodeRef<T>> {
    const streamMeta: StreamNodeMeta<T> = {
      eventCount: 0,
      isActive: false,
      subscriberCount: 0,
    };
    const node: GraphNode<T, StreamNodeRef<T>> = {
      id,
      kind,
      outputSemantic: 'stream',
      ref: makeStreamRef<T>(id),
      flags: { ...flags },
      deps: [...deps],
      outputs: [],
      meta: { version: 0, updatedAt: Date.now() },
      streamMeta,
      feedback,
    };

    node.stream$ = this.trackStream(node, source$);
    this.nodeRegistry.set(id, node);
    this.emitNodeAdd(node);
    this.bump();
    return node;
  }

  private addStateNode<
    TInput,
    TState,
    TOutput extends OutputSemantic,
    TMutations extends StateMutationRegistry<TState>,
    TActions extends StateActionRegistry,
  >(
    config:
      | SignalDrivenStateNodeConfig<TInput, TState, TRuntime, TMutations, TActions>
      | StreamDrivenStateNodeConfig<TInput, TState, TRuntime, TMutations, TActions>,
    kind: Extract<
      NodeKind,
      | 'signalDrivenStateSignal'
      | 'signalDrivenStateStream'
      | 'streamDrivenStateSignal'
      | 'streamDrivenStateStream'
    >,
    outputSemantic: TOutput,
  ): StateNodeHandle<TState, StateNodeOutputRef<TState, TOutput>, TMutations, TActions> {
    const id = config.id ? toNodeId(config.id) : this.nextStateNodeId(kind);
    const inputId = toNodeId(config.input);
    this.assertNewId(id);

    let state = resolveStateNodeInitial(config.initial);
    let disposed = false;
    let inputStop: StopHandle = () => {};
    let operationSequence = 0;
    const createdOperations = new WeakSet<object>();
    let signalState: ReturnType<typeof alienSignal<TState>> | undefined;
    let streamState: MemoryStream<TState> | undefined;

    const outputRef = (
      outputSemantic === 'signal'
        ? makeSignalRef<TState, false>(id, false)
        : makeStreamRef<TState>(id)
    ) as StateNodeOutputRef<TState, TOutput>;
    const node: GraphNode<TState, StateNodeOutputRef<TState, TOutput>> = {
      id,
      kind,
      outputSemantic,
      ref: outputRef,
      flags: { ...config.flags },
      deps: [inputId],
      outputs: [],
      snapshotValue: () => state,
      meta: { version: 0, updatedAt: Date.now() },
    };

    const commit = (next: TState): void => {
      if (disposed || this.disposed) {
        return;
      }
      const previous = state;
      state = next;

      if (outputSemantic === 'signal') {
        if (Object.is(previous, next)) {
          return;
        }
        signalState!(next);
      } else {
        const meta = node.streamMeta!;
        meta.eventCount += 1;
        meta.lastEvent = next;
        meta.lastEventAt = Date.now();
        streamState!.shamefullySendNext(next);
      }
      this.touch(id);
    };

    const mutationDefinitions = (config.mutations ?? {}) as Record<
      string,
      (state: TState, ...payload: unknown[]) => TState
    >;
    let actionDefinitions: Record<string, (...payload: unknown[]) => unknown> = {};

    const mutationCreatorRecord: Record<string, (...payload: unknown[]) => StateMutationOperation> =
      {};
    const mutationFacadeRecord: Record<string, (...payload: unknown[]) => TState> = {};

    const dispatch = <TOperation extends StateNodeOperation<TMutations, TActions>>(
      operation: TOperation,
    ): StateNodeOperationResult<TState, TActions, TOperation> => {
      if (disposed || this.disposed) {
        throw new Error(`State node is disposed: ${id}`);
      }
      if (
        !isStateNodeOperationRecord(operation) ||
        operation.nodeId !== id ||
        !createdOperations.has(operation)
      ) {
        throw new Error(`Invalid state operation for node: ${id}`);
      }

      return this.runStateOperationPipeline(operation, () => {
        if (operation.kind === 'mutation') {
          const mutation = mutationDefinitions[operation.name];
          if (!mutation) {
            throw new Error(`Unknown mutation '${operation.name}' for state node '${id}'`);
          }
          const next = mutation(state, ...operation.payload);
          if (isPromiseLike(next)) {
            throw new Error(`Mutation '${operation.name}' must return state synchronously`);
          }
          commit(next);
          return next;
        }

        const action = actionDefinitions[operation.name];
        if (!action) {
          throw new Error(`Unknown action '${operation.name}' for state node '${id}'`);
        }
        return action(...operation.payload);
      }) as StateNodeOperationResult<TState, TActions, TOperation>;
    };

    for (const name of Object.keys(mutationDefinitions)) {
      mutationCreatorRecord[name] = (...payload) => {
        const operation: StateMutationOperation = {
          nodeId: id,
          kind: 'mutation',
          name,
          payload,
          sequence: ++operationSequence,
          createdAt: Date.now(),
        };
        createdOperations.add(operation);
        return operation;
      };
      mutationFacadeRecord[name] = (...payload) =>
        dispatch(
          mutationCreatorRecord[name](...payload) as StateNodeOperation<TMutations, TActions>,
        ) as TState;
    }

    const mutationCreators =
      mutationCreatorRecord as unknown as MutationOperationCreators<TMutations>;
    const mutationFacade = mutationFacadeRecord as MutationFacade<TState, TMutations>;
    const actionCreatorRecord: Record<string, (...payload: unknown[]) => StateActionOperation> = {};
    const actionFacadeRecord: Record<string, (...payload: unknown[]) => unknown> = {};

    if (config.actions) {
      const rt: StateNodeActionRuntime<TRuntime, TState, TMutations, TActions> = {
        bizRuntime: this.getRuntime(),
        graph: this.makeRuntime().graph,
        getState: () => state,
        mutations: mutationFacade,
        dispatch,
      };
      actionDefinitions = config.actions(rt) as unknown as Record<
        string,
        (...payload: unknown[]) => unknown
      >;
    }

    for (const name of Object.keys(actionDefinitions)) {
      actionCreatorRecord[name] = (...payload) => {
        const operation: StateActionOperation = {
          nodeId: id,
          kind: 'action',
          name,
          payload,
          sequence: ++operationSequence,
          createdAt: Date.now(),
        };
        createdOperations.add(operation);
        return operation;
      };
      actionFacadeRecord[name] = (...payload) =>
        dispatch(actionCreatorRecord[name](...payload) as StateNodeOperation<TMutations, TActions>);
    }

    const actionCreators = actionCreatorRecord as unknown as ActionOperationCreators<TActions>;
    const actionFacade = actionFacadeRecord as ActionFacade<TActions>;

    if (outputSemantic === 'signal') {
      signalState = alienSignal(state);
      node.get = () => {
        this.collect(id);
        return signalState!();
      };
    } else {
      streamState = Stream.createWithMemory<TState>({
        start: (listener) => listener.next(state),
        stop: () => {},
      });
      node.stream$ = streamState;
      node.streamMeta = {
        eventCount: 0,
        isActive: true,
        subscriberCount: 0,
      };
    }

    try {
      if (config.input.protocol === 'signal') {
        const inputRef = config.input as SignalNodeRef<TInput>;
        const stop = effect(() => {
          const input = this.get<TInput>(inputRef);
          commit(config.reducer(state, input));
        });
        inputStop = stop;
      } else {
        const inputRef = config.input as StreamNodeRef<TInput>;
        let activating = true;
        let activationError: unknown;
        const subscription = this.stream<TInput>(inputRef).subscribe({
          next: (input) => {
            try {
              commit(config.reducer(state, input));
            } catch (error) {
              if (activating) {
                activationError = error;
              }
              throw error;
            }
          },
          error: (error) => {
            if (activating) {
              activationError = error;
            }
          },
          complete: () => {},
        });
        activating = false;
        inputStop = () => subscription.unsubscribe();
        if (activationError) {
          throw activationError;
        }
      }
    } catch (error) {
      disposed = true;
      inputStop();
      streamState?.shamefullySendComplete();
      throw error;
    }

    this.nodeRegistry.set(id, node);
    this.emitNodeAdd(node);
    this.bump();

    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      node.disposed = true;
      if (node.streamMeta) {
        node.streamMeta.isActive = false;
      }
      inputStop();
      streamState?.shamefullySendComplete();
      this.touch(id);
    };
    this.disposers.push(dispose);

    return {
      output: node.ref,
      operations: {
        mutations: mutationCreators,
        actions: actionCreators,
      },
      mutations: mutationFacade,
      actions: actionFacade,
      getState: () => state,
      dispatch,
      dispose,
    };
  }

  private nextStateNodeId(kind: NodeKind): string {
    let id: string;
    do {
      this.generatedStateNodeCounter += 1;
      id = `${kind}:${this.generatedStateNodeCounter}`;
    } while (this.nodeRegistry.has(id));
    return id;
  }

  private trackStream<T>(node: GraphNode<T>, source$: Stream<T>): Stream<T> {
    let subscription: Subscription | undefined;
    return Stream.create<T>({
      start: (listener) => {
        const meta = node.streamMeta!;
        meta.isActive = true;
        this.touch(node.id);
        subscription = source$.subscribe({
          next: (value) => {
            meta.eventCount += 1;
            meta.lastEvent = value;
            meta.lastEventAt = Date.now();
            this.touch(node.id);
            listener.next(value);
          },
          error: (error) => listener.error(error),
          complete: () => {
            meta.isActive = false;
            this.touch(node.id);
            listener.complete();
          },
        });
      },
      stop: () => {
        subscription?.unsubscribe();
        subscription = undefined;
        const meta = node.streamMeta!;
        meta.isActive = false;
        this.touch(node.id);
      },
    });
  }

  /**
   * xstream shares a producer per Stream instance. This outer stream therefore
   * records graph-level active consumers separately from producer activation.
   */
  private observeStream<T>(node: GraphNode<T>): Stream<T> {
    let stopActive: StopHandle | undefined;
    return Stream.create<T>({
      start: (listener) => {
        if (this.disposed || node.disposed) {
          listener.complete();
          return;
        }

        const active: { subscription?: Subscription } = {};
        let stopped = false;
        const stop = (): void => {
          if (stopped) {
            return;
          }
          stopped = true;
          active.subscription?.unsubscribe();
          const meta = node.streamMeta!;
          meta.subscriberCount = Math.max(0, meta.subscriberCount - 1);
          this.activeStreamStops.delete(stop);
          this.touch(node.id);
        };

        stopActive = stop;
        this.activeStreamStops.add(stop);
        node.streamMeta!.subscriberCount += 1;
        this.touch(node.id);
        active.subscription = node.stream$!.subscribe(listener);
        if (stopped) {
          active.subscription.unsubscribe();
        }
      },
      stop: () => {
        stopActive?.();
        stopActive = undefined;
      },
    });
  }

  private createFeedbackBoundaryStream<T>(
    input: StreamNodeRef<T> | GraphNodeIdLike,
    options: FeedbackBoundaryOptions,
  ): Stream<T> {
    let inputSubscription: Subscription | undefined;
    let cancelScheduled: StopHandle | undefined;
    const queued: T[] = [];
    let inputCompleted = false;

    return Stream.create<T>({
      start: (listener) => {
        const schedule = (task: () => void): StopHandle => {
          if (options.kind !== 'delay') {
            let scheduling = true;
            const cancel = options.schedule(() => {
              if (scheduling) {
                listener.error(new Error('Feedback schedulers must advance to a later turn'));
                return;
              }
              task();
            });
            scheduling = false;
            return cancel;
          }
          const timeout = setTimeout(task, options.delayMs);
          return () => clearTimeout(timeout);
        };

        const scheduleNext = (): void => {
          if (cancelScheduled || queued.length === 0) {
            return;
          }
          cancelScheduled = schedule(() => {
            cancelScheduled = undefined;
            if (queued.length > 0) {
              listener.next(queued.shift() as T);
            }
            if (inputCompleted && queued.length === 0) {
              listener.complete();
              return;
            }
            scheduleNext();
          });
        };

        inputSubscription = this.stream<T>(input).subscribe({
          next: (value) => {
            if (options.queue === 'latest') {
              queued.splice(0, queued.length, value);
            } else {
              queued.push(value);
            }
            scheduleNext();
          },
          error: (error) => listener.error(error),
          complete: () => {
            inputCompleted = true;
            if (queued.length === 0) {
              listener.complete();
            }
          },
        });
      },
      stop: () => {
        inputSubscription?.unsubscribe();
        inputSubscription = undefined;
        cancelScheduled?.();
        cancelScheduled = undefined;
        queued.length = 0;
        inputCompleted = false;
      },
    });
  }

  private makeRuntime(): GraphRuntime<TRuntime> {
    return {
      bizRuntime: this.getRuntime(),
      graph: {
        get: <T>(id: SignalNodeIdLike) => this.get<T>(id),
        peek: <T>(id: SignalNodeIdLike) => this.peek<T>(id),
        set: <T>(id: SignalNodeIdLike, value: Setter<T>) => this.set<T>(toNodeId(id), value),
        batch: (fn) => this.batch(fn),
      },
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

  private runStateOperationPipeline<TResult>(
    operation: StateNodeOperationRecord,
    execute: () => TResult,
  ): TResult {
    const runtime = this.getRuntime();
    const ctx = this.makeMiddlewareCtx(runtime);

    for (const middleware of this.middlewares) {
      if (middleware.beforeStateOperation) {
        this.runMiddlewareHook(() => middleware.beforeStateOperation!(operation, ctx));
      }
    }

    let result: TResult;
    try {
      result = execute();
    } catch (error) {
      this.emitStateOperationError(operation, error, ctx);
      throw error;
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (value) => {
          this.emitStateOperationAfter(operation, value, ctx);
          return value;
        },
        (error: unknown) => {
          this.emitStateOperationError(operation, error, ctx);
          throw error;
        },
      ) as TResult;
    }

    this.emitStateOperationAfter(operation, result, ctx);
    return result;
  }

  private emitStateOperationAfter(
    operation: StateNodeOperationRecord,
    result: unknown,
    ctx: MiddlewareContext<TRuntime>,
  ): void {
    for (let index = this.middlewares.length - 1; index >= 0; index -= 1) {
      const middleware = this.middlewares[index];
      if (middleware.afterStateOperation) {
        this.runMiddlewareHook(() => middleware.afterStateOperation!(operation, result, ctx));
      }
    }
  }

  private emitStateOperationError(
    operation: StateNodeOperationRecord,
    error: unknown,
    ctx: MiddlewareContext<TRuntime>,
  ): void {
    for (let index = this.middlewares.length - 1; index >= 0; index -= 1) {
      const middleware = this.middlewares[index];
      if (middleware.onStateOperationError) {
        this.runMiddlewareHook(() => middleware.onStateOperationError!(operation, error, ctx));
      }
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
    if (this.nodeRegistry.has(id)) {
      throw new Error(`Duplicate node id: ${id}`);
    }
  }

  private bump(): void {
    this.revisionCounter += 1;
    this.revisionSignal(this.revisionCounter);
  }

  private touch(id: string): void {
    const node = this.nodeRegistry.get(id);
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

function makeSignalRef<T, Writable extends boolean>(
  id: string,
  writable: Writable,
): SignalNodeRef<T, Writable> {
  return { id, protocol: 'signal', writable };
}

function makeStreamRef<T>(id: string): StreamNodeRef<T> {
  return { id, protocol: 'stream' };
}

function resolveStateNodeInitial<TState>(initial: StateNodeInitial<TState>): TState {
  return typeof initial === 'function' ? (initial as () => TState)() : initial;
}

function isStateNodeOperationRecord(value: unknown): value is StateNodeOperationRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const operation = value as Partial<StateNodeOperationRecord>;
  return (
    typeof operation.nodeId === 'string' &&
    (operation.kind === 'mutation' || operation.kind === 'action') &&
    typeof operation.name === 'string' &&
    Array.isArray(operation.payload) &&
    typeof operation.sequence === 'number' &&
    typeof operation.createdAt === 'number'
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}
