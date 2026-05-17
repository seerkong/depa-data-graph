import { effect } from 'alien-signals';

import type { DemoRuntime } from '../../app/runtime';

export function mountGraphPanel(root: HTMLElement, runtime: DemoRuntime): void {
  const pre = document.createElement('pre');
  pre.className = 'code';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.wordBreak = 'break-word';

  root.append(pre);

  effect(() => {
    const out: Record<string, unknown> = {
      main: runtime.graph.snapshot(),
      subgraphs: {},
    };

    runtime.graph.revision()();

    for (const [id, graph] of Object.entries(runtime.subgraphs)) {
      if (!graph) {
        continue;
      }
      graph.revision()();
      (out.subgraphs as Record<string, unknown>)[id] = graph.snapshot();
    }

    pre.textContent = JSON.stringify(out, null, 2);
  });
}
