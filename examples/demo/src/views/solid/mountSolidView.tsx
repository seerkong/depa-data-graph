/** @jsxImportSource solid-js */

import { createMemo } from 'solid-js';
import { render } from 'solid-js/web';

import { useGraphSignal } from 'depa-data-graph-solid';

import type { DemoRuntime } from '../../app/runtime';
import { MODEL } from '../../app/runtime';
import { createActorSubgraph, getActorSubgraphRefs } from '../../app/subgraphs/createActorSubgraph';

function SolidPanel(props: { runtime: DemoRuntime }) {
  const { runtime } = props;

  if (!runtime.subgraphs.solid) {
    runtime.subgraphs.solid = createActorSubgraph(runtime, 'solid');
  }

  const counter = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.counter);
  const plus300 = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.plus300);
  const times10 = useGraphSignal<number, DemoRuntime>(runtime.graph, 'manual/counterTimes10');
  const ping = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.ping('solid'));

  const derivedIsEven = useGraphSignal<boolean, DemoRuntime>(runtime.graph, MODEL.derived.isEven);
  const derivedLabel = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.derived.label);

  const helloInput = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.hello.input);
  const helloName = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.hello.name);
  const helloError = useGraphSignal<string | null, DemoRuntime>(runtime.graph, MODEL.hello.error);

  const local = createMemo(() => counter() * 2);

  const subgraph = runtime.subgraphs.solid!;
  const subLabel = useGraphSignal<string, DemoRuntime>(subgraph, getActorSubgraphRefs('solid').outputs.label);

  return (
    <div class="list">
      <div class="kv">
        <div class="k">counter</div>
        <div class="code">{counter()}</div>

        <div class="k">plus300</div>
        <div class="code">{plus300()}</div>

        <div class="k">times10</div>
        <div class="code">{times10()}</div>

        <div class="k">local</div>
        <div class="code">{local()}</div>

        <div class="k">subgraph</div>
        <div class="code">{subLabel()}</div>

        <div class="k">derived</div>
        <div class="code">
          {derivedLabel()} (isEven={String(derivedIsEven())})
        </div>

        <div class="k">pings</div>
        <div class="code">{ping()}</div>

        <div class="k">name</div>
        <div class="code">{helloName()}</div>

        <div class="k">input</div>
        <div>
          <input
            type="text"
            value={helloInput()}
            onInput={(e) => runtime.intents.setInput(e.currentTarget.value)}
          />
          {helloError() ? <div class="small">{helloError()}</div> : null}
        </div>
      </div>

      <div class="row">
        <button onClick={() => runtime.intents.increase(1)}>+1</button>
        <button onClick={() => runtime.intents.increase(10)}>+10</button>
        <button onClick={() => runtime.intents.submit()}>Submit</button>
      </div>
    </div>
  );
}

export function mountSolidView(root: HTMLElement, runtime: DemoRuntime): void {
  if (!runtime.subgraphs.solid) {
    runtime.subgraphs.solid = createActorSubgraph(runtime, 'solid');
  }

  render(() => <SolidPanel runtime={runtime} />, root);
}
