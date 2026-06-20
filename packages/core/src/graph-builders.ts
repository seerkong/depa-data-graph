import type { DataGraph, GraphRuntime, GraphNodeIdLike, NodeFlags } from './graph';
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

export type JsonGraphNode =
  | JsonSignalNode
  | JsonComputedNode
  | JsonProcessorNode
  | JsonAsyncNode
  | JsonConsumerNode;

export interface JsonGraphSpecV1 {
  version: 1;
  nodes: JsonGraphNode[];
}

export interface JsonGraphLogicRegistry<TRuntime> {
  computed: Record<string, (ctx: GraphRuntime<TRuntime>, prev?: unknown) => unknown>;
  processor: Record<string, (ctx: GraphRuntime<TRuntime>) => void>;
  consumer: Record<string, (ctx: GraphRuntime<TRuntime>) => void>;
  async: Record<
    string,
    {
      params: (ctx: GraphRuntime<TRuntime>) => unknown[];
      task: (...args: unknown[]) => Promise<unknown>;
    }
  >;
}

export type JsonGraphIdentityMap = Readonly<Record<string, GraphNodeIdLike>>;

export type JsonGraphPublicPortMap = Readonly<{
  inputs?: Readonly<Record<string, GraphNodeIdLike>>;
  outputs?: Readonly<Record<string, GraphNodeIdLike>>;
}>;

export type BuildGraphFromJsonOptions = Readonly<{
  identityMap?: JsonGraphIdentityMap;
  publicPorts?: JsonGraphPublicPortMap;
}>;

function resolveGraphNodeId(
  id: string,
  identityMap?: JsonGraphIdentityMap,
): GraphNodeIdLike {
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
    graph.addConsumer(`__json_graph_bridge__/${rawId}/input-to-primary`, [inputId], (ctx) => {
      ctx.graph.set(primaryId, ctx.graph.get(inputId));
    });
    graph.addConsumer(`__json_graph_bridge__/${rawId}/primary-to-input`, [primaryId], (ctx) => {
      ctx.graph.set(inputId, ctx.graph.get(primaryId));
    });
  }

  const outputClashesWithPrimary = outputId && isSameGraphNodeId(outputId, primaryId);
  const outputClashesWithInput = outputId && inputId && isSameGraphNodeId(outputId, inputId);
  if (!outputId || outputClashesWithPrimary || outputClashesWithInput) {
    return;
  }

  graph.addComputed(outputId, [primaryId], (ctx) => ctx.graph.get(primaryId), { out: true, computed: true });
}

export function buildGraphFromJson<TRuntime>(
  graph: DataGraph<TRuntime>,
  spec: JsonGraphSpecV1,
  logic: JsonGraphLogicRegistry<TRuntime>,
  options: BuildGraphFromJsonOptions = {},
): void {
  if (spec.version !== 1) {
    throw new Error(`Unsupported graph spec version: ${String(spec.version)}`);
  }

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
        (ctx, prev) => fn(ctx, prev),
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
        (ctx) => fn(ctx),
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
        (ctx) => fn(ctx),
        node.flags,
      );
      continue;
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
}

export interface CodeGraphBuilder<TRuntime> {
  signal: (id: GraphNodeIdLike, initial: unknown, flags?: NodeFlags) => CodeGraphBuilder<TRuntime>;
  computed: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    getter: (ctx: GraphRuntime<TRuntime>, prev?: unknown) => unknown,
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
  processor: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    outputs: readonly GraphNodeIdLike[],
    run: (ctx: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
  consumer: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    run: (ctx: GraphRuntime<TRuntime>) => void,
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
  async: (
    id: GraphNodeIdLike,
    deps: readonly GraphNodeIdLike[],
    config: {
      initial: unknown;
      params: (ctx: GraphRuntime<TRuntime>) => unknown[];
      task: (...args: unknown[]) => Promise<unknown>;
    },
    flags?: NodeFlags,
  ) => CodeGraphBuilder<TRuntime>;
}

export function createCodeGraphBuilder<TRuntime>(
  graph: DataGraph<TRuntime>,
): CodeGraphBuilder<TRuntime> {
  const builder: CodeGraphBuilder<TRuntime> = {
    signal: (id, initial, flags) => {
      graph.addSignal(id, initial, flags);
      return builder;
    },
    computed: (id, deps, getter, flags) => {
      graph.addComputed(id, deps, getter, flags);
      return builder;
    },
    processor: (id, deps, outputs, run, flags) => {
      graph.addProcessor(id, deps, outputs, run, flags);
      return builder;
    },
    consumer: (id, deps, run, flags) => {
      graph.addConsumer(id, deps, run, flags);
      return builder;
    },
    async: (id, deps, config, flags) => {
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
  };

  return builder;
}
