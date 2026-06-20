import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';

describe('DataGraph.validate()', () => {
  it('reports missing deps and outputs', () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 0);
    graph.addComputed('c', ['missing'], () => 123);
    graph.addProcessor('p', ['a'], ['out'], () => {});

    const errors = graph.validate();

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'missingDep', from: 'c', to: 'missing' }),
        expect.objectContaining({ kind: 'missingOutput', from: 'p', to: 'out' }),
      ]),
    );
  });

  it('reports non-writable outputs', () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 0);
    graph.addComputed('readonly', ['a'], (ctx) => ctx.graph.get<number>('a'));
    graph.addProcessor('p', ['a'], ['readonly'], () => {});

    const errors = graph.validate();

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'outputNotWritable', from: 'p', to: 'readonly' }),
      ]),
    );
  });

  it('reports cycles in declared deps', () => {
    const graph = new DataGraph(() => ({}));

    graph.addComputed('x', ['y'], (ctx) => ctx.graph.get<number>('y'));
    graph.addComputed('y', ['x'], (ctx) => ctx.graph.get<number>('x'));

    const errors = graph.validate();
    const cycle = errors.find((e) => e.kind === 'cycle');

    expect(cycle).toBeDefined();
    expect(cycle?.path).toEqual(expect.arrayContaining(['x', 'y']));
  });
});
