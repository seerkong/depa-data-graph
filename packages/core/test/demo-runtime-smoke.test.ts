import { describe, expect, it } from 'vitest';

import { createDemoRuntime, MODEL } from '../../../examples/demo/src/app/runtime';

describe('unified state-node demo runtime', () => {
  it('drives UI state through typed mutations/actions and installs the complete showcase', () => {
    const runtime = createDemoRuntime();

    expect(runtime.graph.get<number>(MODEL.counter)).toBe(1);
    runtime.stateNodes.controls.mutations.increase(2);
    expect(runtime.graph.get<number>(MODEL.counter)).toBe(3);

    runtime.stateNodes.controls.actions.increaseByRuntimeStep();
    expect(runtime.graph.get<number>(MODEL.counter)).toBe(13);

    runtime.stateNodes.controls.mutations.setInput('Ada');
    runtime.stateNodes.controls.actions.submit();
    expect(runtime.graph.get<string>(MODEL.hello.name)).toBe('Ada');

    const kinds = runtime.graph.snapshot().nodes.map((node) => node.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'signalDrivenStateSignal',
        'signalDrivenStateStream',
        'streamDrivenStateSignal',
        'streamDrivenStateStream',
        'signalToStreamNode',
        'streamToSignal',
      ]),
    );

    runtime.stateNodes.controls.mutations.reset();
    expect(runtime.graph.get<number>(MODEL.counter)).toBe(1);
    runtime.graph.dispose();
  });
});
