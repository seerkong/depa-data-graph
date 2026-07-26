import { bindElement, createReactiveStore } from 'depa-data-graph-vanilla';

import type { DemoRuntime } from '../../app/runtime';
import { MODEL } from '../../app/runtime';
import { createActorSubgraph, getActorSubgraphRefs } from '../../app/subgraphs/createActorSubgraph';

export function mountVanillaView(root: HTMLElement, runtime: DemoRuntime): void {
  if (!runtime.subgraphs.vanilla) {
    runtime.subgraphs.vanilla = createActorSubgraph(runtime, 'vanilla');
  }

  const subgraph = runtime.subgraphs.vanilla;

  const container = document.createElement('div');
  container.className = 'list';

  const meta = document.createElement('div');
  meta.className = 'small';
  meta.textContent = 'This panel updates via alien-signals effect + DOM.';

  const kv = document.createElement('div');
  kv.className = 'kv';

  const valueCounter = addKv(kv, 'counter');
  const valuePlus300 = addKv(kv, 'plus300');
  const valueTimes10 = addKv(kv, 'times10');
  const valueAsync = addKv(kv, 'asyncPlus100');
  const valueName = addKv(kv, 'name');
  const valueDerived = addKv(kv, 'derived');
  const valuePing = addKv(kv, 'pings');
  const valueLocal = addKv(kv, 'local computed');
  const valueSubgraph = addKv(kv, 'subgraph label');

  const row1 = document.createElement('div');
  row1.className = 'row';

  const btnInc = document.createElement('button');
  btnInc.textContent = '+1';
  btnInc.onclick = () => runtime.stateNodes.controls.mutations.increase(1);

  const btnInc10 = document.createElement('button');
  btnInc10.textContent = '+10';
  btnInc10.onclick = () => runtime.stateNodes.controls.actions.increaseByRuntimeStep();

  row1.append(btnInc, btnInc10);

  const row2 = document.createElement('div');
  row2.className = 'row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'type here...';
  input.oninput = (e) => {
    runtime.stateNodes.controls.mutations.setInput((e.currentTarget as HTMLInputElement).value);
  };

  const btnSubmit = document.createElement('button');
  btnSubmit.textContent = 'Submit';
  btnSubmit.onclick = () => runtime.stateNodes.controls.actions.submit();

  const btnReset = document.createElement('button');
  btnReset.textContent = 'Reset';
  btnReset.onclick = () => runtime.stateNodes.controls.mutations.reset();

  row2.append(input, btnSubmit, btnReset);

  container.append(meta, kv, row1, row2);
  root.append(container);

  bindElement(runtime.graph, MODEL.counter, valueCounter, { property: 'textContent' });
  bindElement(runtime.graph, MODEL.plus300, valuePlus300, { property: 'textContent' });
  bindElement(runtime.graph, 'manual/counterTimes10', valueTimes10, { property: 'textContent' });
  bindElement(runtime.graph, MODEL.ping('vanilla'), valuePing, { property: 'textContent' });

  const localStore = createReactiveStore(runtime.graph, [MODEL.counter] as const);
  localStore.subscribe((snapshot: Record<string, unknown>) => {
    const c = snapshot[MODEL.counter] as number;
    valueLocal.textContent = String(c * 2);
  });

  const derivedStore = createReactiveStore(runtime.graph, [
    MODEL.derived.label,
    MODEL.derived.isEven,
  ] as const);
  derivedStore.subscribe((snapshot: Record<string, unknown>) => {
    const label = snapshot[MODEL.derived.label] as string;
    const isEven = snapshot[MODEL.derived.isEven] as boolean;
    valueDerived.textContent = `${label} (isEven=${String(isEven)})`;
  });

  const asyncStore = createReactiveStore(runtime.graph, [
    MODEL.asyncPlus100.loading,
    MODEL.asyncPlus100.result,
    MODEL.asyncPlus100.error,
  ] as const);
  asyncStore.subscribe((snapshot: Record<string, unknown>) => {
    const loading = snapshot[MODEL.asyncPlus100.loading] as boolean;
    const result = snapshot[MODEL.asyncPlus100.result] as number;
    const error = snapshot[MODEL.asyncPlus100.error] as string | null;

    valueAsync.textContent = loading ? 'loading...' : error ? `error: ${error}` : String(result);
  });

  const helloStore = createReactiveStore(runtime.graph, [
    MODEL.hello.input,
    MODEL.hello.name,
    MODEL.hello.error,
  ] as const);
  helloStore.subscribe((snapshot: Record<string, unknown>) => {
    const inputValue = snapshot[MODEL.hello.input] as string;
    const name = snapshot[MODEL.hello.name] as string;
    const error = snapshot[MODEL.hello.error] as string | null;

    valueName.textContent = error ? `error: ${error}` : `${name} (input=${inputValue})`;

    if (input.value !== inputValue) {
      input.value = inputValue;
    }
  });

  if (subgraph) {
    bindElement(subgraph, getActorSubgraphRefs('vanilla').outputs.label, valueSubgraph, {
      property: 'textContent',
    });
  }
}

function addKv(parent: HTMLElement, key: string): HTMLElement {
  const k = document.createElement('div');
  k.className = 'k';
  k.textContent = key;

  const v = document.createElement('div');
  v.className = 'code';

  parent.append(k, v);
  return v;
}
