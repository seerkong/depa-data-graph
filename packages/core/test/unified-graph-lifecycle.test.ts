import type { Listener } from 'xstream';
import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushStops(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await tick();
  }
}

class ManualScheduler {
  private nextId = 1;
  private readonly tasks = new Map<number, () => void>();

  schedule(task: () => void): () => void {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, task);
    return () => {
      this.tasks.delete(id);
    };
  }

  pending(): number {
    return this.tasks.size;
  }

  runNext(): void {
    const entry = this.tasks.entries().next().value as [number, () => void] | undefined;
    if (!entry) {
      return;
    }
    this.tasks.delete(entry[0]);
    entry[1]();
  }
}

describe('unified DataGraph lifecycle and feedback', () => {
  it('keeps sources/operators lazy and activates sinks eagerly', async () => {
    const graph = new DataGraph(() => ({}));
    let sourceListener!: Listener<number>;
    let starts = 0;
    let stops = 0;

    const source = graph.addSource<number>('source', {
      start(listener) {
        starts += 1;
        sourceListener = listener;
      },
      stop() {
        stops += 1;
      },
    });
    const operator = graph.addOperator<number>('operator', [source.ref], (inputs) =>
      inputs.source.map((value) => (value as number) * 2),
    );

    expect(starts).toBe(0);
    expect(graph.snapshot().nodes.find((node) => node.id === 'source')).toMatchObject({
      lifecycle: 'inactive',
      stream: { started: false, subscriberCount: 0 },
    });
    expect(graph.snapshot().nodes.find((node) => node.id === 'operator')).toMatchObject({
      lifecycle: 'inactive',
      stream: { started: false, subscriberCount: 0 },
    });

    const seen: number[] = [];
    graph.addSink<number>('sink', [operator.ref], (value) => seen.push(value));

    expect(starts).toBe(1);
    expect(graph.snapshot().nodes.find((node) => node.id === 'sink')).toMatchObject({
      lifecycle: 'active',
      stream: { started: true, subscriberCount: 1 },
    });

    sourceListener.next(2);
    expect(seen).toEqual([4]);

    graph.dispose();
    await flushStops();

    expect(stops).toBe(1);
    expect(graph.snapshot().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'source', lifecycle: 'disposed' }),
        expect.objectContaining({ id: 'operator', lifecycle: 'disposed' }),
        expect.objectContaining({ id: 'sink', lifecycle: 'disposed' }),
      ]),
    );
  });

  it('stops graph-owned Stream observations and rejects late activation after dispose', async () => {
    const graph = new DataGraph(() => ({}));
    let sourceListener!: Listener<number>;
    let stops = 0;
    const source = graph.addSource<number>('source', {
      start(listener) {
        sourceListener = listener;
      },
      stop() {
        stops += 1;
      },
    });

    const seen: number[] = [];
    const subscription = graph.stream(source.ref).subscribe({
      next: (value) => seen.push(value),
      error: () => {},
      complete: () => {},
    });
    sourceListener.next(1);

    graph.dispose();
    await flushStops();
    sourceListener.next(2);

    expect(stops).toBe(1);
    expect(seen).toEqual([1]);

    let completed = 0;
    graph.stream(source.ref).subscribe({
      next: () => {},
      error: () => {},
      complete: () => {
        completed += 1;
      },
    });
    expect(completed).toBe(1);

    subscription.unsubscribe();
  });

  it('rejects a mixed Signal/Stream cycle without an explicit boundary', () => {
    const graph = new DataGraph(() => ({}));
    const state = graph.addComputed<number>('state', ['latest'], () => 0);
    const commands = graph.addSignalToStream('commands', state.ref);
    graph.addStreamToSignal('latest', commands.ref, 0, (_current, value) => value);

    expect(graph.validate()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'mixedCycle',
          path: expect.arrayContaining(['state', 'commands', 'latest']),
          suggestion: expect.stringMatching(/feedback|delay|scheduler/i),
        }),
      ]),
    );
  });

  it('detects a mixed cycle closed by a processor writesTo edge', () => {
    const graph = new DataGraph(() => ({}));
    const state = graph.addSignal('state', 0);
    const commands = graph.addSignalToStream('commands', state.ref);
    const latest = graph.addStreamToSignal('latest', commands.ref, 0, (_current, value) => value);
    graph.addProcessor('write-state', [latest.ref], [state.ref], (rt) =>
      rt.graph.set(state.ref, rt.graph.get(latest.ref)),
    );

    expect(graph.validate()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'mixedCycle',
          path: expect.arrayContaining(['state', 'commands', 'latest', 'write-state']),
        }),
      ]),
    );

    graph.dispose();
  });

  it('rejects a scheduler that does not advance delivery to a later turn', () => {
    const graph = new DataGraph(() => ({}));
    const signal = graph.addSignal('signal', 1);
    const events = graph.addSignalToStream('events', signal.ref);
    const boundary = graph.addFeedbackBoundary('invalid-boundary', events.ref, {
      kind: 'scheduler',
      queue: 'fifo',
      schedule: (task) => {
        task();
        return () => {};
      },
    });
    let receivedError: unknown;

    graph.stream(boundary.ref).subscribe({
      next: () => {},
      error: (error) => {
        receivedError = error;
      },
      complete: () => {},
    });

    expect(receivedError).toBeInstanceOf(Error);
    expect((receivedError as Error).message).toMatch(/later turn/i);
    graph.dispose();
  });

  it('runs a legal mixed cycle across an explicit scheduled boundary and cancels it', async () => {
    const scheduler = new ManualScheduler();
    const graph = new DataGraph(() => ({}));
    const state = graph.addComputed<number>(
      'state',
      ['latest'],
      (rt) => rt.graph.get<number>('latest') + 1,
    );
    const commands = graph.addSignalToStream('commands', state.ref);
    const nextTurn = graph.addFeedbackBoundary('next-turn', commands.ref, {
      kind: 'scheduler',
      queue: 'fifo',
      schedule: (task) => scheduler.schedule(task),
    });
    const latest = graph.addStreamToSignal('latest', nextTurn.ref, 0, (_current, value) => value);

    expect(graph.validate()).toEqual([]);
    expect(scheduler.pending()).toBe(1);
    const snapshot = graph.snapshot();
    expect(snapshot.nodes.find((node) => node.id === 'next-turn')).toMatchObject({
      kind: 'feedbackBoundary',
      feedback: { kind: 'scheduler', queue: 'fifo' },
    });
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'commands',
          to: 'next-turn',
          boundary: 'scheduler',
        }),
      ]),
    );

    scheduler.runNext();
    expect(graph.get(latest.ref)).toBe(1);
    expect(scheduler.pending()).toBe(1);

    graph.dispose();
    await flushStops();
    expect(scheduler.pending()).toBe(0);
    scheduler.runNext();
    expect(graph.get(latest.ref)).toBe(1);
  });
});
