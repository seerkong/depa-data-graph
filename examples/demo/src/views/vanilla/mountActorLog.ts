import { effect } from 'alien-signals';

import type { DemoRuntime } from '../../app/runtime';

export function mountActorLog(root: HTMLElement, runtime: DemoRuntime): void {
  const list = document.createElement('div');
  list.className = 'list';

  root.append(list);

  effect(() => {
    const entries = runtime.actorLog$();
    list.replaceChildren();

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i]!;
      const item = document.createElement('div');
      item.className = 'item';

      const line1 = document.createElement('div');
      line1.className = 'row';

      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = e.kind;

      const text = document.createElement('span');
      text.className = 'code';

      if (e.kind === 'consumer') {
        text.textContent = `${e.consumerId} #${e.id} ${new Date(e.ts).toLocaleTimeString()}`;
      } else {
        text.textContent = `${e.from} -> ${e.to} #${e.id} ${new Date(e.ts).toLocaleTimeString()}`;
      }

      line1.append(pill, text);

      const line2 = document.createElement('div');
      line2.className = 'code';

      if (e.kind === 'consumer') {
        line2.textContent = e.message;
      } else {
        line2.textContent = e.error ? `error: ${e.error}` : JSON.stringify(e.msg);
      }

      item.append(line1, line2);
      list.append(item);
    }
  });
}
