import type { DataGraph, GraphNode, Setter, StateNodeOperationRecord } from './graph';

export interface MiddlewareContext<TRuntime> {
  graph: DataGraph<TRuntime>;
  runtime: TRuntime;
}

export type BatchEvent = {
  phase: 'start' | 'end';
};

export interface GraphMiddleware<TRuntime> {
  name: string;

  beforeGet?: (id: string, ctx: MiddlewareContext<TRuntime>) => void;
  afterGet?: <T>(id: string, value: T, ctx: MiddlewareContext<TRuntime>) => T;

  beforeSet?: <T>(
    id: string,
    value: Setter<T>,
    ctx: MiddlewareContext<TRuntime>,
  ) => Setter<T> | undefined;
  afterSet?: <T>(id: string, value: Setter<T>, ctx: MiddlewareContext<TRuntime>) => void;

  beforeStateOperation?: (
    operation: StateNodeOperationRecord,
    ctx: MiddlewareContext<TRuntime>,
  ) => void;
  afterStateOperation?: (
    operation: StateNodeOperationRecord,
    result: unknown,
    ctx: MiddlewareContext<TRuntime>,
  ) => void;
  onStateOperationError?: (
    operation: StateNodeOperationRecord,
    error: unknown,
    ctx: MiddlewareContext<TRuntime>,
  ) => void;

  // GraphNode is generic over value type; middleware sees it as unknown.
  // Use `any` here to avoid strict function variance issues on GraphNode.set.
  onNodeAdd?: (node: GraphNode<any>, ctx: MiddlewareContext<TRuntime>) => void;
  onDispose?: (ctx: MiddlewareContext<TRuntime>) => void;
  onBatch?: (event: BatchEvent, ctx: MiddlewareContext<TRuntime>) => void;
}
