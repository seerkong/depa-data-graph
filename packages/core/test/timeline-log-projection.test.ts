import { describe, expect, it } from 'vitest';

import { AppendOnlyEventLog, OrderedTimeline } from '../src/stream/timeline';
import { DataGraph } from '../src/graph';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('timeline/log/projection foundations', () => {
  it('preserves ordered append semantics across timeline channels', async () => {
    const timeline = new OrderedTimeline<string>();
    const control = timeline.createChannel('control');
    const content = timeline.createChannel('content');

    const timelineSeen: Array<string> = [];
    const controlSeen: Array<string> = [];
    const contentSeen: Array<string> = [];

    const timelineSub = timeline.stream({ replay: false }).subscribe({
      next: (entry) => timelineSeen.push(`${entry.seq}:${entry.channel}:${entry.value}`),
      error: () => {},
      complete: () => {},
    });
    const controlSub = control.stream({ replay: false }).subscribe({
      next: (entry) => controlSeen.push(`${entry.seq}:${entry.channel}:${entry.value}`),
      error: () => {},
      complete: () => {},
    });
    const contentSub = content.stream({ replay: false }).subscribe({
      next: (entry) => contentSeen.push(`${entry.seq}:${entry.channel}:${entry.value}`),
      error: () => {},
      complete: () => {},
    });

    control.append('c1');
    content.append('t1');
    control.append('c2');
    await tick();

    expect(timelineSeen).toEqual(['1:control:c1', '2:content:t1', '3:control:c2']);
    expect(controlSeen).toEqual(['1:control:c1', '3:control:c2']);
    expect(contentSeen).toEqual(['2:content:t1']);

    timelineSub.unsubscribe();
    controlSub.unsubscribe();
    contentSub.unsubscribe();
    timeline.dispose();
  });

  it('replays append-only event logs to late subscribers', async () => {
    const log = new AppendOnlyEventLog<string>();

    log.append('a');
    log.append('b');

    const seen: string[] = [];
    const sub = log.stream().subscribe({
      next: (entry) => seen.push(`${entry.seq}:${entry.value}`),
      error: () => {},
      complete: () => {},
    });

    await tick();

    expect(seen).toEqual(['1:a', '2:b']);

    sub.unsubscribe();
    log.dispose();
  });

  it('builds reducer projections from existing log history and future appends', async () => {
    const log = new AppendOnlyEventLog<number>();
    log.append(2);
    log.append(3);

    const graph = new DataGraph(() => ({}));
    const entries = graph.addSource('log-entries', log.stream());
    const projection = graph.addStreamDrivenStateSignalNode({
      id: 'log-projection',
      input: entries.ref,
      initial: 0,
      reducer: (state, entry) => state + entry.value,
    });

    expect(projection.getState()).toBe(5);

    const seen: number[] = [];
    graph.addConsumer('projection-observer', [projection.output], () => {
      seen.push(projection.getState());
    });

    log.append(4);
    await tick();

    expect(seen).toEqual([5, 9]);

    graph.dispose();
    log.dispose();
  });

  it('stops emitting projection updates after disposal', async () => {
    const log = new AppendOnlyEventLog<number>();
    const graph = new DataGraph(() => ({}));
    const entries = graph.addSource('disposable-log-entries', log.stream());
    const projection = graph.addStreamDrivenStateStreamNode({
      id: 'disposable-log-projection',
      input: entries.ref,
      initial: 0,
      reducer: (state, entry) => state + entry.value,
    });

    const seen: number[] = [];
    const sub = graph.stream(projection.output).subscribe({
      next: (value) => seen.push(value),
      error: () => {},
      complete: () => {},
    });

    projection.dispose();
    log.append(1);
    await tick();

    expect(seen).toEqual([0]);

    sub.unsubscribe();
    graph.dispose();
    log.dispose();
  });
});
