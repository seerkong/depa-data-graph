import { effect, setActiveSub } from 'alien-signals';

export type StopHandle = () => void;

export function untracked<T>(fn: () => T): T {
  const prev = setActiveSub(undefined);
  try {
    return fn();
  } finally {
    setActiveSub(prev);
  }
}

export function watch<T>(
  getter: () => T,
  cb: (value: T, prev: T | undefined) => void,
  options?: { immediate?: boolean },
): StopHandle {
  let inited = false;
  let prevValue: T | undefined;

  return effect(() => {
    const next = getter();

    if (!inited) {
      inited = true;
      prevValue = next;
      if (options?.immediate) {
        cb(next, undefined);
      }
      return;
    }

    if (!Object.is(prevValue, next)) {
      const prev = prevValue;
      prevValue = next;
      cb(next, prev);
    }
  });
}
