import { Stream } from 'xstream';

export interface TimelineEntry<T> {
  seq: number;
  at: number;
  value: T;
  channel?: string;
}

export interface TimelineStreamOptions {
  replay?: boolean;
}

export interface TimelineChannel<T> {
  readonly id: string;
  append(value: T): TimelineEntry<T>;
  entries(): readonly TimelineEntry<T>[];
  stream(options?: TimelineStreamOptions): Stream<TimelineEntry<T>>;
  dispose(): void;
}

type EntryListener<T> = (entry: TimelineEntry<T>) => void;
type ValueListener<T> = (value: T) => void;

function createReplayableStream<T>(
  getEntries: () => readonly T[],
  addListener: (listener: ValueListener<T>) => () => void,
  isDisposed: () => boolean,
  options: { replay?: boolean; emitCurrent?: boolean } | undefined,
): Stream<T> {
  const replay = options?.replay ?? true;
  const emitCurrent = options?.emitCurrent ?? true;
  let unsubscribe: (() => void) | null = null;

  return Stream.create<T>({
    start: (listener) => {
      unsubscribe?.();
      unsubscribe = null;

      const shouldReplay = replay && emitCurrent;
      if (shouldReplay) {
        for (const value of getEntries()) {
          listener.next(value);
        }
      }

      if (isDisposed()) {
        listener.complete();
        return;
      }

      unsubscribe = addListener((value) => listener.next(value));
    },
    stop: () => {
      unsubscribe?.();
      unsubscribe = null;
    },
  });
}

class TimelineChannelImpl<T> implements TimelineChannel<T> {
  private readonly localEntries: TimelineEntry<T>[] = [];
  private readonly listeners = new Set<ValueListener<TimelineEntry<T>>>();
  private disposed = false;

  constructor(
    readonly id: string,
    private readonly appendToParent: (value: T, channel: string) => TimelineEntry<T>,
    private readonly removeFromParent: (id: string) => void,
  ) {}

  append(value: T): TimelineEntry<T> {
    if (this.disposed) {
      throw new Error(`Timeline channel '${this.id}' is disposed`);
    }

    return this.appendToParent(value, this.id);
  }

  entries(): readonly TimelineEntry<T>[] {
    return [...this.localEntries];
  }

  stream(options?: TimelineStreamOptions): Stream<TimelineEntry<T>> {
    return createReplayableStream(
      () => this.entries(),
      (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      () => this.disposed,
      options,
    );
  }

  push(entry: TimelineEntry<T>): void {
    if (this.disposed) {
      return;
    }

    this.localEntries.push(entry);
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  close(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.close();
    this.removeFromParent(this.id);
  }
}

export class OrderedTimeline<T> {
  private readonly timelineEntries: TimelineEntry<T>[] = [];
  private readonly listeners = new Set<EntryListener<T>>();
  private readonly channels = new Map<string, TimelineChannelImpl<T>>();
  private disposed = false;
  private nextSeq = 1;

  append(value: T, options: { channel?: string } = {}): TimelineEntry<T> {
    if (this.disposed) {
      throw new Error('OrderedTimeline is disposed');
    }

    const entry: TimelineEntry<T> = {
      seq: this.nextSeq,
      at: Date.now(),
      value,
      channel: options.channel,
    };
    this.nextSeq += 1;

    this.timelineEntries.push(entry);
    for (const listener of this.listeners) {
      listener(entry);
    }

    if (options.channel) {
      this.channels.get(options.channel)?.push(entry);
    }

    return entry;
  }

  entries(): readonly TimelineEntry<T>[] {
    return [...this.timelineEntries];
  }

  size(): number {
    return this.timelineEntries.length;
  }

  stream(options?: TimelineStreamOptions): Stream<TimelineEntry<T>> {
    return createReplayableStream(
      () => this.entries(),
      (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      () => this.disposed,
      options,
    );
  }

  createChannel(id: string): TimelineChannel<T> {
    if (this.disposed) {
      throw new Error('OrderedTimeline is disposed');
    }
    if (this.channels.has(id)) {
      throw new Error(`Duplicate timeline channel id: ${id}`);
    }

    const channel = new TimelineChannelImpl<T>(
      id,
      (value, channelId) => this.append(value, { channel: channelId }),
      (channelId) => {
        this.channels.delete(channelId);
      },
    );
    this.channels.set(id, channel);
    return channel;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.listeners.clear();

    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();
  }
}

export class AppendOnlyEventLog<T> extends OrderedTimeline<T> {}
