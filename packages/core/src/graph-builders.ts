import type { Producer, Stream } from 'xstream';

import type {
  DataGraph,
  EmptyStateActionRegistry,
  EmptyStateMutationRegistry,
  GraphNodeIdLike,
  GraphRuntime,
  NodeFlags,
  SignalDrivenStateNodeConfig,
  SignalDrivenStateSignalNode,
  SignalDrivenStateStreamNode,
  SignalNodeRef,
  StateActionRegistry,
  StateActionsFromFactory,
  StateMutationRegistry,
  StateNodeActionRuntime,
  StateNodeHandle,
  StreamDrivenStateNodeConfig,
  StreamDrivenStateSignalNode,
  StreamDrivenStateStreamNode,
  StreamNodeIdLike,
  StreamNodeRef,
} from './graph';
import { toNodeId } from './module-identity';

export type JsonSignalNode = {
  kind: 'signal';
  id: string;
  initial: unknown;
  flags?: NodeFlags;
};

export type JsonComputedNode = {
  kind: 'computed';
  id: string;
  deps: string[];
  logicKey: string;
  flags?: NodeFlags;
};

export type JsonProcessorNode = {
  kind: 'processor';
  id: string;
  deps: string[];
  outputs: string[];
  logicKey: string;
  flags?: NodeFlags;
};

export type JsonAsyncNode = {
  kind: 'async';
  id: string;
  deps: string[];
  initial: unknown;
  logicKey: string;
  flags?: NodeFlags;
};

export type JsonConsumerNode = {
  kind: 'consumer';
  id: string;
  deps: string[];
  logicKey: string;
  flags?: NodeFlags;
};

export type JsonStateNodeKind =
  | 'signalDrivenStateSignal'
  | 'signalDrivenStateStream'
  | 'streamDrivenStateSignal'
  | 'streamDrivenStateStream';

export type JsonStateNode = {
  kind: JsonStateNodeKind;
  id: string;
  input: string;
  initial: unknown;
  reducerKey: string;
  mutationsKey?: string;
  actionsKey?: string;
  flags?: NodeFlags;
};

export type JsonGraphNode =
  | JsonSignalNode
  | JsonComputedNode
  | JsonProcessorNode
  | JsonAsyncNode
  | JsonConsumerNode
  | JsonStateNode;

export interface JsonGraphSpecV1 {
  version: 1;
  nodes: readonly JsonGraphNode[];
}

export interface JsonGraphLogicRegistry<TRuntime> {
  computed: Record<string, (rt: GraphRuntime<TRuntime>, prev?: unknown) => unknown>;
  processor: Record<string, (rt: GraphRuntime<TRuntime>) => void>;
  consumer: Record<string, (rt: GraphRuntime<TRuntime>) => void>;
  async: Record<
    string,
    {
      params: (rt: GraphRuntime<TRuntime>) => unknown[];
      task: (...args: unknown[]) => Promise<unknown>;
    }
  >;
  reducers?: Record<string, (state: never, input: never) => unknown>;
  mutations?: Record<string, Record<string, (state: never, ...payload: never[]) => unknown>>;
  actions?: Record<string, (rt: never) => StateActionRegistry>;
}

type JsonStateNodeFromSpec<TSpec extends JsonGraphSpecV1> = Extract<
  TSpec['nodes'][number],
  JsonStateNode
>;

type RegistryEntry<TRegistry, TKey> = TKey extends keyof NonNullable<TRegistry>
  ? NonNullable<TRegistry>[TKey]
  : never;

type JsonStateValue<TNode extends JsonStateNode, TLogic> =
  RegistryEntry<
    TLogic extends { reducers?: infer TReducers } ? TReducers : never,
    TNode['reducerKey']
  > extends (...args: never[]) => infer TState
    ? TState
    : unknown;

type JsonStateMutations<TNode extends JsonStateNode, TLogic> = TNode extends {
  mutationsKey: infer TKey;
}
  ? RegistryEntry<TLogic extends { mutations?: infer TMutations } ? TMutations : never, TKey>
  : EmptyStateMutationRegistry;

type JsonStateActions<TNode extends JsonStateNode, TLogic> = TNode extends {
  actionsKey: infer TKey;
}
  ? RegistryEntry<TLogic extends { actions?: infer TActions } ? TActions : never, TKey> extends (
      ...args: never[]
    ) => infer TRegistry
    ? TRegistry
    : EmptyStateActionRegistry
  : EmptyStateActionRegistry;

type JsonStateOutput<TNode extends JsonStateNode, TState> = TNode['kind'] extends
  | 'signalDrivenStateSignal'
  | 'streamDrivenStateSignal'
  ? SignalNodeRef<TState, false>
  : StreamNodeRef<TState>;

type JsonStateHandle<TNode extends JsonStateNode, TLogic> = StateNodeHandle<
  JsonStateValue<TNode, TLogic>,
  JsonStateOutput<TNode, JsonStateValue<TNode, TLogic>>,
  JsonStateMutations<TNode, TLogic> & StateMutationRegistry<JsonStateValue<TNode, TLogic>>,
  JsonStateActions<TNode, TLogic> & StateActionRegistry
>;

export type JsonGraphBuildResult<TSpec extends JsonGraphSpecV1, TLogic> = {
  readonly stateNodes: {
    readonly [TNode in JsonStateNodeFromSpec<TSpec> as TNode['id']]: JsonStateHandle<TNode, TLogic>;
  };
};

export type JsonGraphIdentityMap = Readonly<Record<string, GraphNodeIdLike>>;

export type JsonGraphPublicPortMap = Readonly<{
  inputs?: Readonly<Record<string, GraphNodeIdLike>>;
  outputs?: Readonly<Record<string, GraphNodeIdLike>>;
}>;

export type BuildGraphFromJsonOptions = Readonly<{
  identityMap?: JsonGraphIdentityMap;
  publicPorts?: JsonGraphPublicPortMap;
}>;

function resolveGraphNodeId(id: string, identityMap?: JsonGraphIdentityMap): GraphNodeIdLike {
  return identityMap?.[id] ?? id;
}

function isSameGraphNodeId(a: GraphNodeIdLike, b: GraphNodeIdLike): boolean {
  return toNodeId(a) === toNodeId(b);
}

function materializePublicSignalPorts<TRuntime>(
  graph: DataGraph<TRuntime>,
  rawId: string,
  primaryId: GraphNodeIdLike,
  initial: unknown,
  publicPorts?: JsonGraphPublicPortMap,
): void {
  const inputId = publicPorts?.inputs?.[rawId];
  const outputId = publicPorts?.outputs?.[rawId];

  const hasSeparateInput = inputId && !isSameGraphNodeId(inputId, primaryId);
  if (hasSeparateInput) {
    graph.addSignal(inputId, initial, { in: true });
    graph.addConsumer(`__json_graph_bridge__/${rawId}/input-to-primary`, [inputId], (rt) => {
      rt.graph.set(primaryId, rt.graph.get(inputId));
    });
    graph.addConsumer(`__json_graph_bridge__/${rawId}/primary-to-input`, [primaryId], (rt) => {
      rt.graph.set(inputId, rt.graph.get(primaryId));
    });
  }

  const outputClashesWithPrimary = outputId && isSameGraphNodeId(outputId, primaryId);
  const outputClashesWithInput = outputId && inputId && isSameGraphNodeId(outputId, inputId);
  if (!outputId || outputClashesWithPrimary || outputClashesWithInput) {
    return;
  }

  graph.addComputed(outputId, [primaryId], (rt) => rt.graph.get(primaryId), {
    out: true,
    computed: true,
  });
}

export function buildGraphFromJson<
  TRuntime,
  const TSpec extends JsonGraphSpecV1,
  TLogic extends JsonGraphLogicRegistry<TRuntime>,
>(
  graph: DataGraph<TRuntime>,
  spec: TSpec,
  logic: TLogic,
  options: BuildGraphFromJsonOptions = {},
): JsonGraphBuildResult<TSpec, TLogic> {
  if (spec.version !== 1) {
    throw new Error(`Unsupported graph spec version: ${String(spec.version)}`);
  }

  const stateNodes: Record<
    string,
    StateNodeHandle<unknown, SignalNodeRef<unknown> | StreamNodeRef<unknown>>
  > = {};

  for (const node of spec.nodes) {
    if (node.kind === 'signal') {
      const signalId = resolveGraphNodeId(node.id, options.identityMap);
      graph.addSignal(signalId, node.initial, node.flags);
      materializePublicSignalPorts(graph, node.id, signalId, node.initial, options.publicPorts);
      continue;
    }

    if (node.kind === 'computed') {
      const fn = logic.computed[node.logicKey];
      if (!fn) {
        throw new Error(`Unknown computed logicKey: ${node.logicKey}`);
      }
      graph.addComputed(
        resolveGraphNodeId(node.id, options.identityMap),
        node.deps.map((dep) => resolveGraphNodeId(dep, options.identityMap)),
        (rt, prev) => fn(rt, prev),
        node.flags,
      );
      continue;
    }

    if (node.kind === 'processor') {
      const fn = logic.processor[node.logicKey];
      if (!fn) {
        throw new Error(`Unknown processor logicKey: ${node.logicKey}`);
      }
      graph.addProcessor(
        resolveGraphNodeId(node.id, options.identityMap),
        node.deps.map((dep) => resolveGraphNodeId(dep, options.identityMap)),
        node.outputs.map((output) => resolveGraphNodeId(output, options.identityMap)),
        (rt) => fn(rt),
        node.flags,
      );
      continue;
    }

    if (node.kind === 'consumer') {
      const fn = logic.consumer[node.logicKey];
      if (!fn) {
        throw new Error(`Unknown consumer logicKey: ${node.logicKey}`);
      }
      graph.addConsumer(
        resolveGraphNodeId(node.id, options.identityMap),
        node.deps.map((dep) => resolveGraphNodeId(dep, options.identityMap)),
        (rt) => fn(rt),
        node.flags,
      );
      continue;
    }

    if (
      node.kind === 'signalDrivenStateSignal' ||
      node.kind === 'signalDrivenStateStream' ||
      node.kind === 'streamDrivenStateSignal' ||
      node.kind === 'streamDrivenStateStream'
    ) {
      const reducer = logic.reducers?.[node.reducerKey];
      if (!reducer) {
        throw new Error(`Unknown state reducerKey: ${node.reducerKey}`);
      }
      const input = graph.node(resolveGraphNodeId(node.input, options.identityMap)).ref;
      const expectsSignal = node.kind.startsWith('signalDriven');
      if (input.protocol !== (expectsSignal ? 'signal' : 'stream')) {
        throw new Error(
          `State node ${node.id} requires a ${expectsSignal ? 'Signal' : 'Stream'} input: ${node.input}`,
        );
      }
      const mutations = node.mutationsKey ? logic.mutations?.[node.mutationsKey] : undefined;
      if (node.mutationsKey && !mutations) {
        throw new Error(`Unknown state mutationsKey: ${node.mutationsKey}`);
      }
      const actions = node.actionsKey ? logic.actions?.[node.actionsKey] : undefined;
      if (node.actionsKey && !actions) {
        throw new Error(`Unknown state actionsKey: ${node.actionsKey}`);
      }
      const config = {
        id: resolveGraphNodeId(node.id, options.identityMap),
        input,
        initial: node.initial,
        reducer,
        mutations,
        actions,
        flags: node.flags,
      };

      let handle: StateNodeHandle<unknown, SignalNodeRef<unknown> | StreamNodeRef<unknown>>;
      if (node.kind === 'signalDrivenStateSignal') {
        handle = graph.addSignalDrivenStateSignalNode(config as never);
      } else if (node.kind === 'signalDrivenStateStream') {
        handle = graph.addSignalDrivenStateStreamNode(config as never);
      } else if (node.kind === 'streamDrivenStateSignal') {
        handle = graph.addStreamDrivenStateSignalNode(config as never);
      } else {
        handle = graph.addStreamDrivenStateStreamNode(config as never);
      }
      stateNodes[node.id] = handle;
      continue;
    }

    if (node.kind !== 'async') {
      throw new Error(`Unsupported graph node kind: ${String(node.kind)}`);
    }
    const asyncLogic = logic.async[node.logicKey];
    if (!asyncLogic) {
      throw new Error(`Unknown async logicKey: ${node.logicKey}`);
    }

    graph.addAsync<unknown[], unknown>(
      resolveGraphNodeId(node.id, options.identityMap),
      node.deps.map((dep) => resolveGraphNodeId(dep, options.identityMap)),
      {
        initial: node.initial,
        params: asyncLogic.params,
        task: asyncLogic.task,
        projections: {
          result: resolveGraphNodeId(`${node.id}/result`, options.identityMap),
          loading: resolveGraphNodeId(`${node.id}/loading`, options.identityMap),
          error: resolveGraphNodeId(`${node.id}/error`, options.identityMap),
        },
      },
      node.flags,
    );
  }

  return { stateNodes } as JsonGraphBuildResult<TSpec, TLogic>;
}

type CodeStateConfig<
  TInput,
  TState,
  TRuntime,
  TMutations extends StateMutationRegistry<TState>,
  TActionFactory,
  TInputRef extends SignalNodeRef<TInput> | StreamNodeRef<TInput>,
> = Omit<
  SignalDrivenStateNodeConfig<TInput, TState, TRuntime, TMutations, EmptyStateActionRegistry>,
  'input' | 'actions'
> & { input: TInputRef; actions?: TActionFactory };

type CodeStateActionFactory<
  TRuntime,
  TState,
  TMutations extends StateMutationRegistry<TState>,
> = (
  rt: StateNodeActionRuntime<
    TRuntime,
    TState,
    NoInfer<TMutations>,
    EmptyStateActionRegistry
  >,
) => StateActionRegistry;

export interface CodeGraphBuilder<TRuntime> {
  signal: (id: GraphNodeIdLike, initial: unknown, flags?: NodeFlags) => CodeGraphBuilder<TRuntime>;
  computed: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    getter: (rt: GraphRuntime<TRuntime>, prev?: unknown) => unknown,
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
  processor: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    outputs: readonly GraphNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
  consumer: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    run: (rt: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
  async: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    config: {
      initial: unknown;
      params: (rt: GraphRuntime<TRuntime>) => unknown[];
      task: (...args: unknown[]) => Promise<unknown>;
    },
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
  source<T>(
    id: StreamNodeIdLike,
    source: Stream<T> | Producer<T>,
    flags?: NodeFlags,
  ): CodeGraphBuilder<TRuntime>;
  signalDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: Omit<
      CodeStateConfig<TInput, TState, TRuntime, TMutations, TActionFactory, SignalNodeRef<TInput>>,
      'mutations' | 'actions'
    > & {
      mutations: TMutations & NoInfer<StateMutationRegistry<TState>>;
      actions: TActionFactory & CodeStateActionFactory<TRuntime, TState, TMutations>;
    },
  ): SignalDrivenStateSignalNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  signalDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: CodeStateConfig<TInput, TState, TRuntime, TMutations, undefined, SignalNodeRef<TInput>>,
  ): SignalDrivenStateSignalNode<TInput, TState, TMutations>;
  signalDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
    TActionFactory extends ((...payload: never[]) => StateActionRegistry) | undefined = undefined,
  >(
    id: GraphNodeIdLike,
    config: Omit<
      CodeStateConfig<TInput, TState, TRuntime, TMutations, TActionFactory, SignalNodeRef<TInput>>,
      'id'
    >,
  ): CodeGraphBuilder<TRuntime>;
  signalDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: Omit<
      CodeStateConfig<TInput, TState, TRuntime, TMutations, TActionFactory, SignalNodeRef<TInput>>,
      'mutations' | 'actions'
    > & {
      mutations: TMutations & NoInfer<StateMutationRegistry<TState>>;
      actions: TActionFactory & CodeStateActionFactory<TRuntime, TState, TMutations>;
    },
  ): SignalDrivenStateStreamNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  signalDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: CodeStateConfig<TInput, TState, TRuntime, TMutations, undefined, SignalNodeRef<TInput>>,
  ): SignalDrivenStateStreamNode<TInput, TState, TMutations>;
  signalDrivenStateStream<TInput, TState>(
    id: GraphNodeIdLike,
    config: Omit<
      CodeStateConfig<
        TInput,
        TState,
        TRuntime,
        EmptyStateMutationRegistry,
        EmptyStateActionRegistry,
        SignalNodeRef<TInput>
      >,
      'id'
    >,
  ): CodeGraphBuilder<TRuntime>;
  streamDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: Omit<
      CodeStateConfig<TInput, TState, TRuntime, TMutations, TActionFactory, StreamNodeRef<TInput>>,
      'mutations' | 'actions'
    > & {
      mutations: TMutations & NoInfer<StateMutationRegistry<TState>>;
      actions: TActionFactory & CodeStateActionFactory<TRuntime, TState, TMutations>;
    },
  ): StreamDrivenStateSignalNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  streamDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: CodeStateConfig<TInput, TState, TRuntime, TMutations, undefined, StreamNodeRef<TInput>>,
  ): StreamDrivenStateSignalNode<TInput, TState, TMutations>;
  streamDrivenStateSignal<TInput, TState>(
    id: GraphNodeIdLike,
    config: Omit<
      StreamDrivenStateNodeConfig<
        TInput,
        TState,
        TRuntime,
        EmptyStateMutationRegistry,
        EmptyStateActionRegistry
      >,
      'id'
    >,
  ): CodeGraphBuilder<TRuntime>;
  streamDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActionFactory extends (...payload: never[]) => StateActionRegistry,
  >(
    config: Omit<
      CodeStateConfig<TInput, TState, TRuntime, TMutations, TActionFactory, StreamNodeRef<TInput>>,
      'mutations' | 'actions'
    > & {
      mutations: TMutations & NoInfer<StateMutationRegistry<TState>>;
      actions: TActionFactory & CodeStateActionFactory<TRuntime, TState, TMutations>;
    },
  ): StreamDrivenStateStreamNode<
    TInput,
    TState,
    TMutations,
    StateActionsFromFactory<TActionFactory>
  >;
  streamDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: CodeStateConfig<TInput, TState, TRuntime, TMutations, undefined, StreamNodeRef<TInput>>,
  ): StreamDrivenStateStreamNode<TInput, TState, TMutations>;
  streamDrivenStateStream<TInput, TState>(
    id: GraphNodeIdLike,
    config: Omit<
      StreamDrivenStateNodeConfig<
        TInput,
        TState,
        TRuntime,
        EmptyStateMutationRegistry,
        EmptyStateActionRegistry
      >,
      'id'
    >,
  ): CodeGraphBuilder<TRuntime>;
}

export function createCodeGraphBuilder<TRuntime>(
  graph: DataGraph<TRuntime>,
): CodeGraphBuilder<TRuntime> {
  const registerStateNode = (
    method:
      | 'addSignalDrivenStateSignalNode'
      | 'addSignalDrivenStateStreamNode'
      | 'addStreamDrivenStateSignalNode'
      | 'addStreamDrivenStateStreamNode',
    idOrConfig: GraphNodeIdLike | Record<string, unknown>,
    maybeConfig?: Record<string, unknown>,
  ): unknown => {
    const config = maybeConfig ? { ...maybeConfig, id: idOrConfig as GraphNodeIdLike } : idOrConfig;
    const handle = (graph[method] as (config: never) => unknown)(config as never);
    return maybeConfig ? builder : handle;
  };

  const builder = {
    signal: (id: GraphNodeIdLike, initial: unknown, flags?: NodeFlags) => {
      graph.addSignal(id, initial, flags);
      return builder;
    },
    computed: (
      id: GraphNodeIdLike,
      deps: readonly GraphNodeIdLike[],
      getter: (rt: GraphRuntime<TRuntime>, prev?: unknown) => unknown,
      flags?: NodeFlags,
    ) => {
      graph.addComputed(id, deps, getter, flags);
      return builder;
    },
    processor: (
      id: GraphNodeIdLike,
      deps: readonly GraphNodeIdLike[],
      outputs: readonly GraphNodeIdLike[],
      run: (rt: GraphRuntime<TRuntime>) => void,
      flags?: NodeFlags,
    ) => {
      graph.addProcessor(id, deps, outputs, run, flags);
      return builder;
    },
    consumer: (
      id: GraphNodeIdLike,
      deps: readonly GraphNodeIdLike[],
      run: (rt: GraphRuntime<TRuntime>) => void,
      flags?: NodeFlags,
    ) => {
      graph.addConsumer(id, deps, run, flags);
      return builder;
    },
    async: (
      id: GraphNodeIdLike,
      deps: readonly GraphNodeIdLike[],
      config: {
        initial: unknown;
        params: (rt: GraphRuntime<TRuntime>) => unknown[];
        task: (...args: unknown[]) => Promise<unknown>;
      },
      flags?: NodeFlags,
    ) => {
      graph.addAsync<unknown[], unknown>(
        id,
        deps,
        {
          initial: config.initial,
          params: config.params,
          task: config.task,
        },
        flags,
      );
      return builder;
    },
    source: <T>(id: StreamNodeIdLike, source: Stream<T> | Producer<T>, flags?: NodeFlags) => {
      graph.addSource(id, source, flags);
      return builder;
    },
    signalDrivenStateSignal: (
      idOrConfig: GraphNodeIdLike | Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => registerStateNode('addSignalDrivenStateSignalNode', idOrConfig, config),
    signalDrivenStateStream: (
      idOrConfig: GraphNodeIdLike | Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => registerStateNode('addSignalDrivenStateStreamNode', idOrConfig, config),
    streamDrivenStateSignal: (
      idOrConfig: GraphNodeIdLike | Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => registerStateNode('addStreamDrivenStateSignalNode', idOrConfig, config),
    streamDrivenStateStream: (
      idOrConfig: GraphNodeIdLike | Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => registerStateNode('addStreamDrivenStateStreamNode', idOrConfig, config),
  } as unknown as CodeGraphBuilder<TRuntime>;

  return builder;
}
