import type { DataGraph, GraphNode, Setter } from './graph';

export type TypeToken<T> = {
  readonly __type?: T;
};

export const types = {
  string: (): TypeToken<string> => ({}) as TypeToken<string>,
  number: (): TypeToken<number> => ({}) as TypeToken<number>,
  boolean: (): TypeToken<boolean> => ({}) as TypeToken<boolean>,
  unknown: (): TypeToken<unknown> => ({}) as TypeToken<unknown>,
  nullable: <T>(_: TypeToken<T>): TypeToken<T | null> => ({}) as TypeToken<T | null>,
  array: <T>(_: TypeToken<T>): TypeToken<T[]> => ({}) as TypeToken<T[]>,
} as const;

export type ModelSchema = Record<string, TypeToken<any>>;

export type ModelId<TSchema extends ModelSchema> = keyof TSchema & string;

export type ModelValue<TSchema extends ModelSchema, TId extends ModelId<TSchema>> =
  TSchema[TId] extends TypeToken<infer TValue> ? TValue : never;

export function defineModel<const TSchema extends ModelSchema>(schema: TSchema): TSchema {
  return schema;
}

export type TypedGraph<TRuntime, TSchema extends ModelSchema> = Omit<
  DataGraph<TRuntime>,
  'get' | 'peek' | 'set' | 'node'
> & {
  get<TId extends ModelId<TSchema>>(id: TId): ModelValue<TSchema, TId>;
  peek<TId extends ModelId<TSchema>>(id: TId): ModelValue<TSchema, TId>;
  set<TId extends ModelId<TSchema>>(id: TId, value: Setter<ModelValue<TSchema, TId>>): void;
  node<TId extends ModelId<TSchema>>(id: TId): GraphNode<ModelValue<TSchema, TId>>;
};

export function asTypedGraph<TRuntime, const TSchema extends ModelSchema>(
  graph: DataGraph<TRuntime>,
  _schema: TSchema,
): TypedGraph<TRuntime, TSchema> {
  return graph as unknown as TypedGraph<TRuntime, TSchema>;
}
