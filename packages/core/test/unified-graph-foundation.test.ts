import type { Listener } from 'xstream';
import { describe, expect, it } from 'vitest';

import { DataGraph } from '../src/graph';

describe('unified DataGraph foundation', () => {
  it('registers signal and stream nodes in one typed topology', () => {
    const graph = new DataGraph(() => ({}));
    const count = graph.addSignal('count', 1);
    const doubledCount = graph.addComputed(
      'doubled-count',
      ['count'],
      (rt) => rt.graph.get<number>('count') * 2,
    );
    const countEvents = graph.addSignalToStream<number>('count-events', count.ref);

    let listener!: Listener<number>;
    const events = graph.addSource<number>('events', {
      start(next) {
        listener = next;
      },
      stop() {},
    });
    const latestEvent = graph.addStreamToSignal(
      'latest-event',
      events.ref,
      0,
      (_state, event) => event,
    );
    const doubled = graph.addOperator<number>('doubled-events', [events.ref], (inputs) =>
      inputs.events.map((value) => (value as number) * 2),
    );
    const seen: number[] = [];
    const collector = graph.addSink<number>('collector', [doubled.ref], (value) =>
      seen.push(value),
    );

    expect(count.ref.protocol).toBe('signal');
    expect(count.ref.writable).toBe(true);
    expect(events.ref.protocol).toBe('stream');
    expect(graph.get(count.ref)).toBe(1);

    const subscription = graph
      .stream(collector.ref)
      .subscribe({ next: () => {}, error: () => {}, complete: () => {} });
    const countValues: number[] = [];
    const countSubscription = graph.stream(countEvents.ref).subscribe({
      next: (value) => countValues.push(value),
      error: () => {},
      complete: () => {},
    });
    graph.set(count.ref, 2);
    listener.next(3);

    expect(seen).toEqual([6]);
    expect(countValues).toEqual([1, 2]);
    expect(graph.get(doubledCount.ref)).toBe(4);
    expect(graph.get(latestEvent.ref)).toBe(3);
    expect(graph.validate()).toEqual([]);
    const snapshot = graph.snapshot();
    expect(snapshot.nodes.find((node) => node.id === 'count')).toMatchObject({
      id: 'count',
      kind: 'signal',
      outputSemantic: 'signal',
      lifecycle: 'active',
    });
    expect(snapshot.nodes.find((node) => node.id === 'events')).toMatchObject({
      id: 'events',
      kind: 'source',
      outputSemantic: 'stream',
      lifecycle: 'active',
      stream: { started: true, subscriberCount: 2 },
    });
    expect(snapshot.nodes.find((node) => node.id === 'doubled-events')).toMatchObject({
      id: 'doubled-events',
      kind: 'operator',
      outputSemantic: 'stream',
      lifecycle: 'active',
      stream: { started: true, subscriberCount: 1 },
    });
    expect(snapshot.nodes.find((node) => node.id === 'collector')).toMatchObject({
      id: 'collector',
      kind: 'sink',
      outputSemantic: 'stream',
      lifecycle: 'active',
      stream: { started: true, subscriberCount: 2 },
    });
    expect(snapshot.nodes.find((node) => node.id === 'count-events')).toMatchObject({
      kind: 'signalToStreamNode',
      outputSemantic: 'stream',
      stream: { started: true, subscriberCount: 1 },
    });
    expect(snapshot.nodes.find((node) => node.id === 'doubled-count')).toMatchObject({
      kind: 'computed',
      outputSemantic: 'signal',
      value: 4,
    });
    expect(snapshot.nodes.find((node) => node.id === 'latest-event')).toMatchObject({
      kind: 'streamToSignal',
      outputSemantic: 'signal',
      value: 3,
    });
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'count',
          to: 'doubled-count',
          kind: 'dependsOn',
          mode: 'signal',
          fromRef: { id: 'count', protocol: 'signal', writable: true },
          toRef: { id: 'doubled-count', protocol: 'signal', writable: false },
        }),
        expect.objectContaining({
          from: 'events',
          to: 'doubled-events',
          kind: 'streamDependsOn',
          mode: 'stream',
          fromRef: { id: 'events', protocol: 'stream' },
          toRef: { id: 'doubled-events', protocol: 'stream' },
        }),
        expect.objectContaining({
          from: 'doubled-events',
          to: 'collector',
          kind: 'streamDependsOn',
          mode: 'stream',
        }),
        expect.objectContaining({
          from: 'count',
          to: 'count-events',
          kind: 'explicitConversion',
          mode: 'explicit-conversion',
          fromRef: { id: 'count', protocol: 'signal', writable: true },
          toRef: { id: 'count-events', protocol: 'stream' },
        }),
        expect.objectContaining({
          from: 'events',
          to: 'latest-event',
          kind: 'explicitConversion',
          mode: 'explicit-conversion',
          fromRef: { id: 'events', protocol: 'stream' },
          toRef: { id: 'latest-event', protocol: 'signal', writable: false },
        }),
      ]),
    );

    // xstream shares the producer, while the unified snapshot reports each
    // graph-level active consumer (the conversion/operator plus this observer).
    const directSourceSubscription = graph.stream(events.ref).subscribe({
      next: () => {},
      error: () => {},
      complete: () => {},
    });
    expect(graph.snapshot().nodes.find((node) => node.id === 'events')).toMatchObject({
      stream: { started: true, subscriberCount: 3 },
    });

    directSourceSubscription.unsubscribe();
    countSubscription.unsubscribe();
    subscription.unsubscribe();
    graph.dispose();
  });

  it('rejects protocol-mismatched reads at the graph boundary', () => {
    const graph = new DataGraph(() => ({}));
    const count = graph.addSignal('count', 1);

    expect(() => graph.stream(count.ref)).toThrow(/not a stream/i);
  });
});
