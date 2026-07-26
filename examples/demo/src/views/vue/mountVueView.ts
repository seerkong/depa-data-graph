import { computed, createApp, defineComponent, h } from 'vue';

import { useGraphSignal } from 'depa-data-graph-vue';

import type { DemoRuntime } from '../../app/runtime';
import { MODEL } from '../../app/runtime';
import { createActorSubgraph, getActorSubgraphRefs } from '../../app/subgraphs/createActorSubgraph';

export function mountVueView(root: HTMLElement, runtime: DemoRuntime): void {
  if (!runtime.subgraphs.vue) {
    runtime.subgraphs.vue = createActorSubgraph(runtime, 'vue');
  }
  const App = defineComponent({
    name: 'VuePanel',
    setup() {
      const counter = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.counter);
      const plus300 = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.plus300);
      const ping = useGraphSignal<number, DemoRuntime>(runtime.graph, MODEL.ping('vue'));

      const derivedIsEven = useGraphSignal<boolean, DemoRuntime>(
        runtime.graph,
        MODEL.derived.isEven,
      );
      const derivedLabel = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.derived.label);

      const helloInput = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.hello.input);
      const helloName = useGraphSignal<string, DemoRuntime>(runtime.graph, MODEL.hello.name);
      const helloError = useGraphSignal<string | null, DemoRuntime>(
        runtime.graph,
        MODEL.hello.error,
      );

      const subgraph = runtime.subgraphs.vue;
      const subLabel = subgraph
        ? useGraphSignal<string, DemoRuntime>(subgraph, getActorSubgraphRefs('vue').outputs.label)
        : null;

      const localSummary = computed(() => {
        const c = counter.value;
        return `local computed: counter*2=${c * 2}`;
      });

      const onInput = (e: Event) => {
        runtime.stateNodes.controls.mutations.setInput((e.target as HTMLInputElement).value);
      };

      return () =>
        h('div', { class: 'list' }, [
          h('div', { class: 'kv' }, [
            h('div', { class: 'k' }, 'counter'),
            h('div', { class: 'code' }, String(counter.value)),

            h('div', { class: 'k' }, 'plus300'),
            h('div', { class: 'code' }, String(plus300.value)),

            h('div', { class: 'k' }, 'derived'),
            h('div', { class: 'code' }, `${derivedLabel.value} (isEven=${derivedIsEven.value})`),

            h('div', { class: 'k' }, 'pings'),
            h('div', { class: 'code' }, String(ping.value)),

            h('div', { class: 'k' }, 'local'),
            h('div', { class: 'code' }, localSummary.value),

            h('div', { class: 'k' }, 'subgraph'),
            h('div', { class: 'code' }, subLabel ? subLabel.value : ''),

            h('div', { class: 'k' }, 'name'),
            h('div', { class: 'code' }, helloName.value),

            h('div', { class: 'k' }, 'input'),
            h('div', {}, [
              h('input', {
                type: 'text',
                value: helloInput.value,
                onInput,
              }),
              helloError.value ? h('div', { class: 'small' }, helloError.value) : null,
            ]),
          ]),

          h('div', { class: 'row' }, [
            h(
              'button',
              {
                onClick: () => runtime.stateNodes.controls.mutations.increase(1),
              },
              '+1',
            ),
            h(
              'button',
              {
                onClick: () => runtime.stateNodes.controls.actions.increaseByRuntimeStep(),
              },
              '+10',
            ),
            h(
              'button',
              {
                onClick: () => runtime.stateNodes.controls.actions.submit(),
              },
              'Submit',
            ),
          ]),
        ]);
    },
  });

  createApp(App).mount(root);
}
