import xs from 'xstream';
import { describe, expect, it, vi } from 'vitest';

import { DataGraph } from '../src/graph';
import {
  signalToStream,
  StreamBridgeManager,
  subscribeStreamToSignal,
} from '../src/stream/stream-bridge';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushStops(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await tick();
  }
}

describe('stream-bridge', () => {
  it('subscribeStreamToSignal adds signal and resets on complete', async () => {
    const graph = new DataGraph(() => ({}));

    const stream$ = xs.create<number>({
      start: (listener) => {
        listener.next(1);
        listener.next(2);
        listener.complete();
      },
      stop: () => {},
    });

    let completed = 0;

    const unsub = subscribeStreamToSignal(graph, 's', stream$, {
      initial: 0,
      resetOnComplete: true,
      onComplete: () => {
        completed += 1;
      },
    });

    expect(graph.get<number>('s')).toBe(0);
    expect(completed).toBe(1);

    unsub();
  });

  it('subscribeStreamToSignal applies reducer', () => {
    const graph = new DataGraph(() => ({}));

    const stream$ = xs.of('a', 'b');

    subscribeStreamToSignal(graph, 's', stream$, {
      initial: '',
      reducer: (prev, next) => prev + next,
    });

    expect(graph.get<string>('s')).toBe('ab');
  });

  it('subscribeStreamToSignal forwards errors to onError', () => {
    const graph = new DataGraph(() => ({}));

    const err = new Error('boom');
    const stream$ = xs.create<number>({
      start: (listener) => {
        listener.error(err);
      },
      stop: () => {},
    });

    let got: unknown;

    subscribeStreamToSignal(graph, 's', stream$, {
      initial: 0,
      onError: (e) => {
        got = e;
      },
    });

    expect(got).toBe(err);
  });

  it('subscribeStreamToSignal logs error when onError is missing', () => {
    const graph = new DataGraph(() => ({}));

    const err = new Error('boom');
    const stream$ = xs.create<number>({
      start: (listener) => {
        listener.error(err);
      },
      stop: () => {},
    });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    subscribeStreamToSignal(graph, 's', stream$, {
      initial: 0,
    });

    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it('graph.dispose triggers stream unsubscribe', async () => {
    const graph = new DataGraph(() => ({}));

    let stopCalls = 0;
    const stream$ = xs.create<number>({
      start: () => {},
      stop: () => {
        stopCalls += 1;
      },
    });

    subscribeStreamToSignal(graph, 's', stream$, {
      initial: 0,
    });

    graph.dispose();
    await flushStops();

    expect(stopCalls).toBe(1);
  });

  it('signalToStream reports error when signal id is missing', async () => {
    const graph = new DataGraph(() => ({}));

    const stream$ = signalToStream(graph, 'missing');

    let gotError: unknown;

    const sub = stream$.subscribe({
      next: () => {},
      error: (e) => {
        gotError = e;
      },
      complete: () => {},
    });

    await tick();

    expect(gotError).toBeInstanceOf(Error);

    sub.unsubscribe();
    await flushStops();
  });

  it('StreamBridgeManager manages subscriptions by id', async () => {
    const graph = new DataGraph(() => ({}));

    let stopA = 0;
    const a$ = xs.create<number>({
      start: () => {},
      stop: () => {
        stopA += 1;
      },
    });

    let stopB = 0;
    const b$ = xs.create<number>({
      start: () => {},
      stop: () => {
        stopB += 1;
      },
    });

    const manager = new StreamBridgeManager(graph);

    manager.subscribe('id', a$, 's', { initial: 0 });
    expect(manager.has('id')).toBe(true);
    expect(manager.keys()).toEqual(['id']);

    manager.subscribe('id', b$, 's', { initial: 0 });
    await flushStops();
    expect(stopA).toBe(1);

    manager.unsubscribe('id');
    await flushStops();
    expect(stopB).toBe(1);
    expect(manager.has('id')).toBe(false);

    manager.subscribe('a', xs.never(), 'a', { initial: 0 });
    manager.subscribe('b', xs.never(), 'b', { initial: 0 });

    manager.dispose();
    await flushStops();

    expect(manager.keys()).toEqual([]);
  });
});
