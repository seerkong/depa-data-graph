import { Stream, type Producer } from 'xstream';

import { DataGraph } from './graph';
import type {
  EmptyStateActionRegistry,
  EmptyStateMutationRegistry,
  GraphNode,
  GraphRuntime,
  NodeFlags,
  Setter,
  SignalDrivenStateSignalNode,
  SignalDrivenStateStreamNode,
  SignalNodeRef,
  StateActionRegistry,
  StateActionsFromFactory,
  StateMutationRegistry,
  StateNodeActionRuntime,
  StreamDrivenStateSignalNode,
  StreamDrivenStateStreamNode,
  StreamNodeRef,
} from './graph';

export type SignalSchema<T> = {
  kind: 'signal';
  initial: T;
  flags?: NodeFlags;
};

export type StreamSchema<T> = {
  kind: 'stream';
  source: Stream<T> | Producer<T>;
  flags?: NodeFlags;
};

export type ComputedSchema<T, TRuntime = unknown> = {
  kind: 'computed';
  deps: readonly string[];
  getter: (rt: GraphRuntime<TRuntime>, prev?: T) => T;
  flags?: NodeFlags;
};

type StateSchemaConfig<
  TInput,
  TState,
  TRuntime,
  TMutations extends StateMutationRegistry<TState>,
  TActionFactory,
> = {
  input: string;
  initial: TState | (() => TState);
  reducer: (state: TState, input: TInput) => TState;
  mutations?: TMutations & NoInfer<StateMutationRegistry<TState>>;
  actions?: TActionFactory;
  flags?: NodeFlags;
  readonly __runtime?: TRuntime;
};

type StateSchemaActionFactory<
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

type StateSchemaOperationsConfig<
  TInput,
  TState,
  TRuntime,
  TMutations extends StateMutationRegistry<TState>,
  TActions extends StateActionRegistry,
> = Omit<
  StateSchemaConfig<
    TInput,
    TState,
    TRuntime,
    TMutations,
    StateSchemaActionFactory<TRuntime, TState, TMutations>
  >,
  'mutations' | 'actions'
> & {
  mutations: TMutations & NoInfer<StateMutationRegistry<TState>>;
  actions: (
    rt: StateNodeActionRuntime<
      TRuntime,
      TState,
      NoInfer<TMutations>,
      EmptyStateActionRegistry
    >,
  ) => TActions;
};

export type StateNodeSchema<
  TKind extends
    | 'signalDrivenStateSignal'
    | 'signalDrivenStateStream'
    | 'streamDrivenStateSignal'
    | 'streamDrivenStateStream',
  TInput,
  TState,
  TRuntime = unknown,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActionFactory = undefined,
> = StateSchemaConfig<TInput, TState, TRuntime, TMutations, TActionFactory> & { kind: TKind };

type AnyStateNodeSchema =
  | StateNodeSchema<'signalDrivenStateSignal', any, any, any, any, any>
  | StateNodeSchema<'signalDrivenStateStream', any, any, any, any, any>
  | StateNodeSchema<'streamDrivenStateSignal', any, any, any, any, any>
  | StateNodeSchema<'streamDrivenStateStream', any, any, any, any, any>;

export type TypedGraphSchema = Record<
  string,
  SignalSchema<any> | StreamSchema<any> | ComputedSchema<any, any> | AnyStateNodeSchema
>;

export function signal<T>(initial: T, flags?: NodeFlags): SignalSchema<T> {
  return { kind: 'signal', initial, flags };
}

export function stream<T>(source: Stream<T> | Producer<T>, flags?: NodeFlags): StreamSchema<T> {
  return { kind: 'stream', source, flags };
}

export function computed<T, TRuntime = unknown>(
  deps: readonly string[],
  getter: (rt: GraphRuntime<TRuntime>, prev?: T) => T,
  flags?: NodeFlags,
): ComputedSchema<T, TRuntime> {
  return { kind: 'computed', deps, getter, flags };
}

function stateSchema<
  const TKind extends
    | 'signalDrivenStateSignal'
    | 'signalDrivenStateStream'
    | 'streamDrivenStateSignal'
    | 'streamDrivenStateStream',
  TInput,
  TState,
  TRuntime,
  TMutations extends StateMutationRegistry<TState>,
  TActionFactory,
>(
  kind: TKind,
  config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, TActionFactory>,
): StateNodeSchema<TKind, TInput, TState, TRuntime, TMutations, TActionFactory> {
  return { kind, ...config };
}

export function signalDrivenStateSignal<
  TInput,
  TState,
  TRuntime = unknown,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActionFactory extends
    | StateSchemaActionFactory<TRuntime, TState, TMutations>
    | undefined = undefined,
>(config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, TActionFactory>) {
  return stateSchema('signalDrivenStateSignal', config);
}

export function signalDrivenStateStream<
  TInput,
  TState,
  TRuntime = unknown,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActionFactory extends
    | StateSchemaActionFactory<TRuntime, TState, TMutations>
    | undefined = undefined,
>(config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, TActionFactory>) {
  return stateSchema('signalDrivenStateStream', config);
}

export function streamDrivenStateSignal<
  TInput,
  TState,
  TRuntime = unknown,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActionFactory extends
    | StateSchemaActionFactory<TRuntime, TState, TMutations>
    | undefined = undefined,
>(config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, TActionFactory>) {
  return stateSchema('streamDrivenStateSignal', config);
}

export function streamDrivenStateStream<
  TInput,
  TState,
  TRuntime = unknown,
  TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  TActionFactory extends
    | StateSchemaActionFactory<TRuntime, TState, TMutations>
    | undefined = undefined,
>(config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, TActionFactory>) {
  return stateSchema('streamDrivenStateStream', config);
}

export interface StateNodeSchemaBuilder<TRuntime> {
  signalDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActions extends StateActionRegistry,
  >(
    config: StateSchemaOperationsConfig<TInput, TState, TRuntime, TMutations, TActions>,
  ): StateNodeSchema<
    'signalDrivenStateSignal',
    TInput,
    TState,
    TRuntime,
    TMutations,
    StateSchemaActionFactory<TRuntime, TState, TMutations> &
      ((rt: StateNodeActionRuntime<TRuntime, TState, TMutations>) => TActions)
  >;
  signalDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, undefined>,
  ): StateNodeSchema<'signalDrivenStateSignal', TInput, TState, TRuntime, TMutations>;

  signalDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActions extends StateActionRegistry,
  >(
    config: StateSchemaOperationsConfig<TInput, TState, TRuntime, TMutations, TActions>,
  ): StateNodeSchema<
    'signalDrivenStateStream',
    TInput,
    TState,
    TRuntime,
    TMutations,
    StateSchemaActionFactory<TRuntime, TState, TMutations> &
      ((rt: StateNodeActionRuntime<TRuntime, TState, TMutations>) => TActions)
  >;
  signalDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, undefined>,
  ): StateNodeSchema<'signalDrivenStateStream', TInput, TState, TRuntime, TMutations>;

  streamDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActions extends StateActionRegistry,
  >(
    config: StateSchemaOperationsConfig<TInput, TState, TRuntime, TMutations, TActions>,
  ): StateNodeSchema<
    'streamDrivenStateSignal',
    TInput,
    TState,
    TRuntime,
    TMutations,
    StateSchemaActionFactory<TRuntime, TState, TMutations> &
      ((rt: StateNodeActionRuntime<TRuntime, TState, TMutations>) => TActions)
  >;
  streamDrivenStateSignal<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, undefined>,
  ): StateNodeSchema<'streamDrivenStateSignal', TInput, TState, TRuntime, TMutations>;

  streamDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState>,
    TActions extends StateActionRegistry,
  >(
    config: StateSchemaOperationsConfig<TInput, TState, TRuntime, TMutations, TActions>,
  ): StateNodeSchema<
    'streamDrivenStateStream',
    TInput,
    TState,
    TRuntime,
    TMutations,
    StateSchemaActionFactory<TRuntime, TState, TMutations> &
      ((rt: StateNodeActionRuntime<TRuntime, TState, TMutations>) => TActions)
  >;
  streamDrivenStateStream<
    TInput,
    TState,
    TMutations extends StateMutationRegistry<TState> = EmptyStateMutationRegistry,
  >(
    config: StateSchemaConfig<TInput, TState, TRuntime, TMutations, undefined>,
  ): StateNodeSchema<'streamDrivenStateStream', TInput, TState, TRuntime, TMutations>;
}

/**
 * Binds the business-runtime type before individual schema nodes are declared,
 * allowing the remaining state/action generics to be inferred from each config.
 */
export function createStateNodeSchemaBuilder<TRuntime>(): StateNodeSchemaBuilder<TRuntime> {
  const create = (kind: AnyStateNodeSchema['kind'], config: StateSchemaConfig<any, any, any, any, any>) =>
    stateSchema(kind, config);
  return {
    signalDrivenStateSignal: (config: never) => create('signalDrivenStateSignal', config),
    signalDrivenStateStream: (config: never) => create('signalDrivenStateStream', config),
    streamDrivenStateSignal: (config: never) => create('streamDrivenStateSignal', config),
    streamDrivenStateStream: (config: never) => create('streamDrivenStateStream', config),
  } as StateNodeSchemaBuilder<TRuntime>;
}

type SchemaIds<TSchema extends TypedGraphSchema> = keyof TSchema & string;

type SchemaValue<TSchema extends TypedGraphSchema, TId extends SchemaIds<TSchema>> =
  TSchema[TId] extends SignalSchema<infer TValue>
    ? TValue
    : TSchema[TId] extends StreamSchema<infer TValue>
      ? TValue
      : TSchema[TId] extends ComputedSchema<infer TValue, any>
        ? TValue
        : TSchema[TId] extends StateNodeSchema<any, any, infer TState, any, any, any>
          ? TState
          : never;

type WritableSignalIds<TSchema extends TypedGraphSchema> = {
  [K in keyof TSchema]: TSchema[K] extends SignalSchema<any> ? K : never;
}[keyof TSchema] &
  string;

type TypedSetValue<TSchema extends TypedGraphSchema, TId extends string> =
  TId extends WritableSignalIds<TSchema>
    ? Setter<SchemaValue<TSchema, Extract<TId, SchemaIds<TSchema>>>>
    : TId extends SchemaIds<TSchema>
      ? never
      : Setter<unknown>;

type SchemaNode<TSchema extends TypedGraphSchema, TId extends SchemaIds<TSchema>> =
  TSchema[TId] extends SignalSchema<infer TValue>
    ? GraphNode<TValue, SignalNodeRef<TValue, true>>
    : TSchema[TId] extends StreamSchema<infer TValue>
      ? GraphNode<TValue, StreamNodeRef<TValue>>
      : TSchema[TId] extends ComputedSchema<infer TValue, any>
        ? GraphNode<TValue, SignalNodeRef<TValue, false>>
        : TSchema[TId] extends StateNodeSchema<
              infer TKind,
              infer TInput,
              infer TState,
              any,
              infer TMutations,
              infer TActionFactory
            >
          ? TKind extends 'signalDrivenStateSignal'
            ? SignalDrivenStateSignalNode<
                TInput,
                TState,
                TMutations,
                StateActionsFromFactory<TActionFactory>
              >
            : TKind extends 'signalDrivenStateStream'
              ? SignalDrivenStateStreamNode<
                  TInput,
                  TState,
                  TMutations,
                  StateActionsFromFactory<TActionFactory>
                >
              : TKind extends 'streamDrivenStateSignal'
                ? StreamDrivenStateSignalNode<
                    TInput,
                    TState,
                    TMutations,
                    StateActionsFromFactory<TActionFactory>
                  >
                : StreamDrivenStateStreamNode<
                    TInput,
                    TState,
                    TMutations,
                    StateActionsFromFactory<TActionFactory>
                  >
          : never;

export type TypedGraph<TRuntime, TSchema extends TypedGraphSchema> = Omit<
  DataGraph<TRuntime>,
  'get' | 'peek' | 'set' | 'node'
> & {
  readonly nodes: { readonly [TId in SchemaIds<TSchema>]: SchemaNode<TSchema, TId> };

  get<TId extends SchemaIds<TSchema>>(id: TId): SchemaValue<TSchema, TId>;
  get<T>(id: string): T;

  peek<TId extends SchemaIds<TSchema>>(id: TId): SchemaValue<TSchema, TId>;
  peek<T>(id: string): T;

  set<TId extends string>(id: TId, value: TypedSetValue<TSchema, TId>): void;

  node<TId extends SchemaIds<TSchema>>(id: TId): GraphNode<SchemaValue<TSchema, TId>>;
  node<T = unknown>(id: string): GraphNode<T>;
};

export function createTypedGraph<TRuntime, const TSchema extends TypedGraphSchema>(
  schema: TSchema,
  getRuntime: () => TRuntime,
): TypedGraph<TRuntime, TSchema> {
  const graph = new DataGraph(getRuntime);
  const nodes: Record<string, unknown> = {};

  for (const [id, node] of Object.entries(schema)) {
    if (node.kind === 'signal') {
      nodes[id] = graph.addSignal(id, node.initial, node.flags ?? {});
    } else if (node.kind === 'stream') {
      nodes[id] = graph.addSource(id, node.source, node.flags ?? {});
    }
  }

  for (const [id, node] of Object.entries(schema)) {
    if (node.kind === 'computed') {
      nodes[id] = graph.addComputed(id, [...node.deps], node.getter, node.flags ?? {});
    }
  }

  for (const [id, node] of Object.entries(schema)) {
    if (node.kind === 'signal' || node.kind === 'stream' || node.kind === 'computed') {
      continue;
    }

    const inputNode = nodes[node.input] as
      | GraphNode<unknown>
      | { readonly output: SignalNodeRef<unknown> | StreamNodeRef<unknown> }
      | undefined;
    if (!inputNode) {
      throw new Error(`Unknown schema state-node input: ${node.input}`);
    }
    const input = 'output' in inputNode ? inputNode.output : inputNode.ref;
    const config = { ...node, id, input };

    if (node.kind === 'signalDrivenStateSignal') {
      nodes[id] = graph.addSignalDrivenStateSignalNode(config as never);
    } else if (node.kind === 'signalDrivenStateStream') {
      nodes[id] = graph.addSignalDrivenStateStreamNode(config as never);
    } else if (node.kind === 'streamDrivenStateSignal') {
      nodes[id] = graph.addStreamDrivenStateSignalNode(config as never);
    } else {
      nodes[id] = graph.addStreamDrivenStateStreamNode(config as never);
    }
  }

  Object.defineProperty(graph, 'nodes', { value: Object.freeze(nodes), enumerable: true });
  return graph as unknown as TypedGraph<TRuntime, TSchema>;
}
