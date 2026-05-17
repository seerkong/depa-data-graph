import { DataGraph } from './graph';
import type { GraphContext, GraphNode, NodeFlags, Setter } from './graph';

export type SignalSchema<T> = {
  kind: 'signal';
  initial: T;
  flags?: NodeFlags;
};

export type ComputedSchema<T> = {
  kind: 'computed';
  deps: readonly string[];
  getter: (ctx: GraphContext<any>, prev?: T) => T;
  flags?: NodeFlags;
};

export type TypedGraphSchema = Record<string, SignalSchema<any> | ComputedSchema<any>>;

export function signal<T>(initial: T, flags?: NodeFlags): SignalSchema<T> {
  return { kind: 'signal', initial, flags };
}

export function computed<T>(
  deps: readonly string[],
  getter: (ctx: GraphContext<any>, prev?: T) => T,
  flags?: NodeFlags,
): ComputedSchema<T> {
  return { kind: 'computed', deps, getter, flags };
}

type SchemaIds<TSchema extends TypedGraphSchema> = keyof TSchema & string;

type SchemaValue<TSchema extends TypedGraphSchema, TId extends SchemaIds<TSchema>> =
  TSchema[TId] extends SignalSchema<infer TValue>
    ? TValue
    : TSchema[TId] extends ComputedSchema<infer TValue>
      ? TValue
      : never;

type SignalIds<TSchema extends TypedGraphSchema> = {
  [K in keyof TSchema]: TSchema[K] extends SignalSchema<any> ? K : never;
}[keyof TSchema] &
  string;

type TypedSetValue<TSchema extends TypedGraphSchema, TId extends string> =
  TId extends SignalIds<TSchema>
    ? Setter<SchemaValue<TSchema, Extract<TId, SchemaIds<TSchema>>>>
    : TId extends SchemaIds<TSchema>
      ? never
      : Setter<unknown>;

export type TypedGraph<TRuntime, TSchema extends TypedGraphSchema> = Omit<
  DataGraph<TRuntime>,
  'get' | 'peek' | 'set' | 'node'
> & {
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

  // Ensure signals exist before computeds that may depend on them.
  for (const [id, node] of Object.entries(schema)) {
    if (node.kind !== 'signal') {
      continue;
    }
    graph.addSignal(id, node.initial, node.flags ?? {});
  }

  for (const [id, node] of Object.entries(schema)) {
    if (node.kind !== 'computed') {
      continue;
    }
    graph.addComputed(id, [...node.deps], node.getter, node.flags ?? {});
  }

  return graph as unknown as TypedGraph<TRuntime, TSchema>;
}
