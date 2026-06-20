import React from 'react';
import { createRoot } from 'react-dom/client';

import { useGraphComputed, useGraphSignal } from 'depa-data-graph-react';

import type { DemoRuntime } from '../../app/runtime';
import { MODEL } from '../../app/runtime';
import { createActorSubgraph, getActorSubgraphRefs } from '../../app/subgraphs/createActorSubgraph';

function ReactPanel(props: { runtime: DemoRuntime }) {
  const { runtime } = props;

  const counter = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.counter);
  const plus300 = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.plus300);
  const times10 = useGraphSignal<number, DemoRuntime>(runtime.graph, 'manual/counterTimes10');
  const ping = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.ping('react'));

  const derivedIsEven = useGraphSignal<boolean, DemoRuntime>(runtime.graph, MODEL.derived.isEven);
  const derivedLabel = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.derived.label);

  const helloInput = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.hello.input);
  const helloName = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.hello.name);
  const helloError = useGraphSignal<string | null, DemoRuntime>(runtime.graph, MODEL.hello.error);

  const asyncLoading = useGraphSignal<boolean, DemoRuntime>(
    runtime.graph,
    MODEL.asyncPlus100.loading,
  );
  const asyncResult = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.asyncPlus100.result);
  const asyncError = useGraphSignal<string | null, DemoRuntime>(
    runtime.graph,
    MODEL.asyncPlus100.error,
  );

  const localComputed = useGraphComputed<number, DemoRuntime>(
    runtime.graph,
    () => runtime.graph.get<number>(MODEL.counter) * 2,
  );

  const sg = runtime.subgraphs.react!;
  const subLabel = useGraphSignal<string, DemoRuntime>(sg, getActorSubgraphRefs('react').outputs.label);

  return (
    <div className="list">
      <div className="kv">
        <div className="k">counter</div>
        <div className="code">{counter}</div>

        <div className="k">plus300</div>
        <div className="code">{plus300}</div>

        <div className="k">times10</div>
        <div className="code">{times10}</div>

        <div className="k">local</div>
        <div className="code">{localComputed}</div>

        <div className="k">subgraph</div>
        <div className="code">{subLabel}</div>

        <div className="k">async</div>
        <div className="code">
          {asyncLoading ? 'loading...' : asyncError ? `error: ${asyncError}` : asyncResult}
        </div>

        <div className="k">derived</div>
        <div className="code">
          {derivedLabel} (isEven={String(derivedIsEven)})
        </div>

        <div className="k">pings</div>
        <div className="code">{ping}</div>

        <div className="k">name</div>
        <div className="code">{helloName}</div>

        <div className="k">input</div>
        <div>
          <input
            type="text"
            value={helloInput}
            onChange={(e) => runtime.intents.setInput(e.currentTarget.value)}
          />
          {helloError ? <div className="small">{helloError}</div> : null}
        </div>
      </div>

      <div className="row">
        <button onClick={() => runtime.intents.increase(1)}>+1</button>
        <button onClick={() => runtime.intents.increase(10)}>+10</button>
        <button onClick={() => runtime.intents.submit()}>Submit</button>
      </div>
    </div>
  );
}

export function mountReactView(root: HTMLElement, runtime: DemoRuntime): void {
  if (!runtime.subgraphs.react) {
    runtime.subgraphs.react = createActorSubgraph(runtime, 'react');
  }

  createRoot(root).render(<ReactPanel runtime={runtime} />);
}
