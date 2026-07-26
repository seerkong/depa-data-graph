import type { JsonGraphSpecV1 } from './generate';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function parseJsonGraphSpecV1(value: unknown): JsonGraphSpecV1 {
  if (!isObject(value)) {
    throw new Error('Invalid graph spec: expected an object');
  }

  if (value.version !== 1) {
    throw new Error(`Invalid graph spec: expected version=1, got ${String(value.version)}`);
  }

  if (!Array.isArray(value.nodes)) {
    throw new Error('Invalid graph spec: expected nodes to be an array');
  }

  // Validate only the minimal shape we need for codegen.
  for (const node of value.nodes) {
    if (!isObject(node)) {
      throw new Error('Invalid graph spec: each node must be an object');
    }

    const kind = node.kind;
    const id = node.id;

    if (typeof kind !== 'string') {
      throw new Error('Invalid graph spec: node.kind must be a string');
    }
    if (typeof id !== 'string') {
      throw new Error('Invalid graph spec: node.id must be a string');
    }

    if (kind === 'signal') {
      // initial can be any JSON value.
      continue;
    }

    if (kind === 'computed') {
      if (!isStringArray(node.deps)) {
        throw new Error(`Invalid computed node '${id}': deps must be string[]`);
      }
      if (typeof node.logicKey !== 'string') {
        throw new Error(`Invalid computed node '${id}': logicKey must be string`);
      }
      continue;
    }

    if (kind === 'processor') {
      if (!isStringArray(node.deps)) {
        throw new Error(`Invalid processor node '${id}': deps must be string[]`);
      }
      if (!isStringArray(node.outputs)) {
        throw new Error(`Invalid processor node '${id}': outputs must be string[]`);
      }
      if (typeof node.logicKey !== 'string') {
        throw new Error(`Invalid processor node '${id}': logicKey must be string`);
      }
      continue;
    }

    if (kind === 'consumer') {
      if (!isStringArray(node.deps)) {
        throw new Error(`Invalid consumer node '${id}': deps must be string[]`);
      }
      if (typeof node.logicKey !== 'string') {
        throw new Error(`Invalid consumer node '${id}': logicKey must be string`);
      }
      continue;
    }

    if (kind === 'async') {
      if (!isStringArray(node.deps)) {
        throw new Error(`Invalid async node '${id}': deps must be string[]`);
      }
      if (typeof node.logicKey !== 'string') {
        throw new Error(`Invalid async node '${id}': logicKey must be string`);
      }
      // initial can be any JSON value.
      continue;
    }

    if (
      kind === 'signalDrivenStateSignal' ||
      kind === 'signalDrivenStateStream' ||
      kind === 'streamDrivenStateSignal' ||
      kind === 'streamDrivenStateStream'
    ) {
      if (typeof node.input !== 'string') {
        throw new Error(`Invalid state node '${id}': input must be string`);
      }
      if (typeof node.reducerKey !== 'string') {
        throw new Error(`Invalid state node '${id}': reducerKey must be string`);
      }
      if (node.mutationsKey !== undefined && typeof node.mutationsKey !== 'string') {
        throw new Error(`Invalid state node '${id}': mutationsKey must be string`);
      }
      if (node.actionsKey !== undefined && typeof node.actionsKey !== 'string') {
        throw new Error(`Invalid state node '${id}': actionsKey must be string`);
      }
      continue;
    }

    throw new Error(`Invalid graph spec: unknown node kind '${kind}'`);
  }

  return value as JsonGraphSpecV1;
}
