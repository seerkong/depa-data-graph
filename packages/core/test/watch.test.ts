import { signal } from 'alien-signals';
import { describe, expect, it } from 'vitest';

import { untracked, watch } from '../src/watch';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('watch', () => {
  it('immediate triggers callback on first run', async () => {
    const value$ = signal(0);
    const seen: Array<{ next: number; prev: number | undefined }> = [];

    const stop = watch(
      () => value$(),
      (next, prev) => {
        seen.push({ next, prev });
      },
      { immediate: true },
    );

    await tick();

    stop();

    expect(seen).toEqual([{ next: 0, prev: undefined }]);
  });

  it('triggers callback on change and stops after stop()', async () => {
    const value$ = signal(0);
    const seen: Array<{ next: number; prev: number | undefined }> = [];

    const stop = watch(
      () => value$(),
      (next, prev) => {
        seen.push({ next, prev });
      },
      { immediate: false },
    );

    await tick();

    value$(1);
    await tick();

    value$(2);
    await tick();

    stop();

    value$(3);
    await tick();

    expect(seen).toEqual([
      { next: 1, prev: 0 },
      { next: 2, prev: 1 },
    ]);
  });

  it('does not trigger callback when value is stable', async () => {
    const trigger$ = signal(0);
    const calls: number[] = [];

    const stop = watch(
      () => {
        trigger$();
        return 1;
      },
      (next) => {
        calls.push(next);
      },
      { immediate: false },
    );

    await tick();

    trigger$(1);
    await tick();

    trigger$(2);
    await tick();

    stop();

    expect(calls).toEqual([]);
  });

  it('untracked executes fn and returns value', () => {
    expect(untracked(() => 123)).toBe(123);
  });
});
