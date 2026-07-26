import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('explicit deps semantics', () => {
  it('computed recomputes only when declared deps change', async () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 0);
    graph.addSignal('b', 0);

    let computeCalls = 0;

    graph.addComputed<number>('c', ['a'], (rt) => {
      computeCalls += 1;
      return rt.graph.get<number>('a') + rt.graph.get<number>('b');
    });

    expect(graph.get<number>('c')).toBe(0);
    expect(computeCalls).toBeGreaterThanOrEqual(1);

    const callsAfterFirstRead = computeCalls;

    graph.set<number>('b', 1);
    await tick();

    expect(graph.get<number>('c')).toBe(0);
    expect(computeCalls).toBe(callsAfterFirstRead);

    graph.set<number>('a', 1);
    await tick();

    expect(computeCalls).toBe(callsAfterFirstRead);
    expect(graph.get<number>('c')).toBe(2);
    expect(computeCalls).toBe(callsAfterFirstRead + 1);
  });

  it('processor runs only when declared deps change', async () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 0);
    graph.addSignal('b', 0);
    graph.addSignal('out', 0);

    let runs = 0;

    graph.addProcessor('p', ['a'], ['out'], (rt) => {
      runs += 1;
      rt.graph.set<number>('out', rt.graph.get<number>('b'));
    });

    expect(graph.get<number>('out')).toBe(0);

    const runsAfterInit = runs;

    graph.set<number>('b', 1);
    await tick();

    expect(runs).toBe(runsAfterInit);
    expect(graph.get<number>('out')).toBe(0);

    graph.set<number>('a', 1);
    await tick();

    expect(runs).toBeGreaterThan(runsAfterInit);
    expect(graph.get<number>('out')).toBe(1);
  });

  it('async runs only when declared deps change', async () => {
    const graph = new DataGraph(() => ({}));

    graph.addSignal('a', 0);
    graph.addSignal('b', 0);

    let calls = 0;

    graph.addAsync<[number], number>('job', ['a'], {
      params: (rt) => [rt.graph.get<number>('b')] as const,
      task: async (b) => {
        calls += 1;
        return b * 2;
      },
      initial: 0,
    });

    expect(graph.get<number>('job/result')).toBe(0);

    const callsAfterInit = calls;

    graph.set<number>('b', 2);
    await tick();

    expect(calls).toBe(callsAfterInit);
    expect(graph.get<number>('job/result')).toBe(0);

    graph.set<number>('a', 1);
    await tick();
    await tick();

    expect(calls).toBe(callsAfterInit + 1);
    expect(graph.get<number>('job/result')).toBe(4);
  });

  it('deps audit can throw on undeclared reads', () => {
    const graph = new DataGraph(() => ({}));
    graph.setDepsAudit('throw');

    graph.addSignal('a', 0);
    graph.addSignal('b', 0);

    graph.addComputed<number>('c', ['a'], (rt) => rt.graph.get<number>('b'));

    expect(() => {
      graph.get<number>('c');
    }).toThrow(/undeclared/i);
  });
});
