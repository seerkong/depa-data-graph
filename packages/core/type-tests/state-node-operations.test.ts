import { DataGraph } from '../src';

type Assert<T extends true> = T;
type IsAssignable<T, U> = T extends U ? true : false;

type Runtime = {
  api: {
    loadCount(id: string): Promise<number>;
  };
};

const graph = new DataGraph<Runtime>(() => ({
  api: { loadCount: async (id) => id.length },
}));
const input = graph.addSignal('input', 0);

const counter = graph.addSignalDrivenStateSignalNode({
  id: 'counter',
  input: input.ref,
  initial: { count: 0, loading: false },
  reducer: (state, value) => ({ ...state, count: state.count + value }),
  mutations: {
    increment: (state, by: number) => ({ ...state, count: state.count + by }),
    markLoading: (state, loading: boolean) => ({ ...state, loading }),
    replace: (state, count: number) => ({ ...state, count }),
  },
  actions: (rt) => ({
    async load(id: string) {
      const value: number = rt.graph.get(input.ref);
      const current: number = rt.getState().count;
      const loaded = await rt.bizRuntime.api.loadCount(id);
      rt.mutations.markLoading(true);
      rt.mutations.replace(loaded + value + current);
      return rt.getState().count;
    },
    increment(by: number) {
      return rt.mutations.increment(by);
    },
  }),
});

const mutationResult: { count: number; loading: boolean } = counter.mutations.increment(2);
const mutationOperation = counter.operations.mutations.increment(2);
const dispatchedMutation: { count: number; loading: boolean } = counter.dispatch(mutationOperation);
const actionResult: Promise<number> = counter.actions.load('id');
const actionOperation = counter.operations.actions.load('id');
const dispatchedAction: Promise<number> = counter.dispatch(actionOperation);

// Mutation and action names are independently namespaced.
const sameVerbMutation = counter.operations.mutations.increment(1);
const sameVerbAction = counter.operations.actions.increment(1);

// @ts-expect-error Mutation payload is inferred from its registry definition.
counter.mutations.increment('2');
// @ts-expect-error Unknown mutation names are not exposed.
counter.mutations.reset();
// @ts-expect-error Action payload is inferred from its registry definition.
counter.actions.load(2);
// @ts-expect-error Unknown action names are not exposed.
counter.actions.save('id');
// @ts-expect-error Dispatch rejects arbitrary operation objects.
counter.dispatch({ kind: 'mutation', name: 'increment', payload: [1] });
// @ts-expect-error Dispatch does not accept next state.
counter.dispatch({ count: 1, loading: false });
// @ts-expect-error State handles do not expose arbitrary updater mutation.
counter.mutate((state: { count: number }) => state);

type _operationKinds = Assert<
  IsAssignable<typeof sameVerbMutation.kind | typeof sameVerbAction.kind, 'mutation' | 'action'>
>;

void mutationResult;
void dispatchedMutation;
void actionResult;
void dispatchedAction;
void sameVerbMutation;
void sameVerbAction;
