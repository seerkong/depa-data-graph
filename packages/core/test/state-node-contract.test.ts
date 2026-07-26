import type { Listener } from 'xstream';
import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src';

describe('unified state node contract', () => {
  it('bootstraps both Signal-driven node kinds from the current Signal value', () => {
    const graph = new DataGraph(() => ({}));
    const input = graph.addSignal('signal-input', 2);
    const signalState = graph.addSignalDrivenStateSignalNode({
      id: 'signal-driven-signal',
      input: input.ref,
      initial: 1,
      reducer: (state, value) => state + value,
    });
    const streamState = graph.addSignalDrivenStateStreamNode({
      id: 'signal-driven-stream',
      input: input.ref,
      initial: 1,
      reducer: (state, value) => state + value,
    });

    expect(signalState.getState()).toBe(3);
    expect(graph.get(signalState.output)).toBe(3);
    expect(streamState.getState()).toBe(3);

    const values: number[] = [];
    graph.stream(streamState.output).subscribe({
      next: (value) => values.push(value),
      error: () => {},
      complete: () => {},
    });
    expect(values).toEqual([3]);

    expect(graph.snapshot().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'signal-driven-signal',
          kind: 'signalDrivenStateSignal',
          outputSemantic: 'signal',
          lifecycle: 'active',
          value: 3,
        }),
        expect.objectContaining({
          id: 'signal-driven-stream',
          kind: 'signalDrivenStateStream',
          outputSemantic: 'stream',
          lifecycle: 'active',
          value: 3,
        }),
      ]),
    );

    graph.dispose();
  });

  it('keeps both Stream-driven node kinds eager without output subscribers', () => {
    const graph = new DataGraph(() => ({}));
    let listener!: Listener<number>;
    let starts = 0;
    const input = graph.addSource<number>('stream-input', {
      start(next) {
        starts += 1;
        listener = next;
      },
      stop() {},
    });
    const signalState = graph.addStreamDrivenStateSignalNode({
      id: 'stream-driven-signal',
      input: input.ref,
      initial: 0,
      reducer: (state, value) => state + value,
    });
    const streamState = graph.addStreamDrivenStateStreamNode({
      id: 'stream-driven-stream',
      input: input.ref,
      initial: 0,
      reducer: (state, value) => state + value,
    });

    expect(starts).toBe(1);
    listener.next(2);
    listener.next(3);

    expect(signalState.getState()).toBe(5);
    expect(graph.get(signalState.output)).toBe(5);
    expect(streamState.getState()).toBe(5);

    signalState.dispose();
    streamState.dispose();
    listener.next(4);
    expect(signalState.getState()).toBe(5);
    expect(streamState.getState()).toBe(5);
    expect(graph.snapshot().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'stream-driven-signal', lifecycle: 'disposed' }),
        expect.objectContaining({ id: 'stream-driven-stream', lifecycle: 'disposed' }),
      ]),
    );

    graph.dispose();
  });

  it('deduplicates Signal state publication with Object.is', () => {
    const graph = new DataGraph(() => ({}));
    const input = graph.addSignal('dedup-input', 0);
    const state = graph.addSignalDrivenStateSignalNode({
      id: 'dedup-state',
      input: input.ref,
      initial: { stable: true },
      reducer: (current) => current,
    });
    let runs = 0;
    graph.addConsumer('dedup-observer', [state.output], () => {
      runs += 1;
    });

    expect(runs).toBe(1);
    graph.set(input.ref, 1);
    graph.set(input.ref, 2);

    expect(state.getState()).toEqual({ stable: true });
    expect(runs).toBe(1);

    graph.dispose();
  });

  it('does not register a state node when bootstrap reduction fails', () => {
    const graph = new DataGraph(() => ({}));
    const input = graph.addSignal('failing-bootstrap-input', 1);

    expect(() =>
      graph.addSignalDrivenStateSignalNode({
        id: 'failing-bootstrap-state',
        input: input.ref,
        initial: 0,
        reducer: () => {
          throw new Error('bootstrap failed');
        },
      }),
    ).toThrow('bootstrap failed');
    expect(graph.snapshot().nodes.some((node) => node.id === 'failing-bootstrap-state')).toBe(
      false,
    );

    graph.dispose();
  });

  it('emits every Stream state transition and replays only current state', async () => {
    const graph = new DataGraph(() => ({}));
    let listener!: Listener<number>;
    const input = graph.addSource<number>('same-state-events', {
      start(next) {
        listener = next;
      },
      stop() {},
    });
    const state = graph.addStreamDrivenStateStreamNode({
      id: 'same-state-stream',
      input: input.ref,
      initial: 0,
      reducer: (current) => current,
    });
    const first: number[] = [];
    const firstSubscription = graph.stream(state.output).subscribe({
      next: (value) => first.push(value),
      error: () => {},
      complete: () => {},
    });

    listener.next(1);
    listener.next(2);
    expect(first).toEqual([0, 0, 0]);

    const later: number[] = [];
    const laterSubscription = graph.stream(state.output).subscribe({
      next: (value) => later.push(value),
      error: () => {},
      complete: () => {},
    });
    expect(later).toEqual([state.getState()]);

    listener.next(3);
    expect(first).toEqual([0, 0, 0, 0]);
    expect(later).toEqual([0, 0]);

    firstSubscription.unsubscribe();
    laterSubscription.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterDisconnect: number[] = [];
    graph.stream(state.output).subscribe({
      next: (value) => afterDisconnect.push(value),
      error: () => {},
      complete: () => {},
    });
    expect(afterDisconnect).toEqual([state.getState()]);

    graph.dispose();
  });
});
