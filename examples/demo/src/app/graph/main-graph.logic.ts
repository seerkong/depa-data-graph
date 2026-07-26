import type { JsonGraphLogicRegistry, GraphRuntime } from 'depa-data-graph-core';

import type { DemoRuntime } from '../runtime';

const IDS = {
  counter: 'counter',
  plus100: 'plus100',
  helloInput: 'hello/input',
  helloError: 'hello/validationError',
  isEven: 'counter/isEven',
  label: 'counter/label',
} as const;

export const mainGraphLogic: JsonGraphLogicRegistry<DemoRuntime> = {
  computed: {
    plus100: (rt) => rt.graph.get<number>(IDS.counter) + 100,
    plus300: (rt) => rt.graph.get<number>(IDS.plus100) + 200,
  },
  processor: {
    counterDerived: (rt) => {
      const c = rt.graph.get<number>(IDS.counter);
      rt.graph.set<boolean>(IDS.isEven, c % 2 === 0);
      rt.graph.set<string>(IDS.label, c % 2 === 0 ? 'even' : 'odd');
    },
    validateInput: (rt) => {
      const text = rt.graph.get<string>(IDS.helloInput);
      const trimmed = text.trim();
      const err = trimmed.length > 12 ? 'Too long (max 12 chars)' : null;
      rt.graph.set<string | null>(IDS.helloError, err);
    },
  },
  consumer: {},
  async: {
    asyncPlus100: {
      params: (rt: GraphRuntime<DemoRuntime>) => [rt.graph.get<number>(IDS.counter)],
      task: async (...args: unknown[]) => {
        await delay(350);
        const v = args[0];
        return Number(v) + 100;
      },
    },
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
