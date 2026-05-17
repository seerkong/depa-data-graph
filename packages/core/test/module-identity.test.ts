import { describe, expect, it } from 'vitest';

import {
  defineGraphModule,
  input,
  internal,
  isNodeRef,
  mountGraph,
  output,
  state,
  toNodeId,
} from '../src/module-identity';

describe('graph module identity core', () => {
  it('builds structured refs with public and internal sections', () => {
    const stage = defineGraphModule('stage', {
      inputs: {
        lexicalEvents: input<string[]>(),
      },
      outputs: {
        semanticEvents: output<string[]>(),
      },
      state: {
        lexicalSeq: state<number>(),
      },
      internals: {
        lexicalToSyntactic: internal<void>(),
      },
    } as const);

    expect(isNodeRef(stage.inputs.lexicalEvents)).toBe(true);
    expect(isNodeRef(stage.outputs.semanticEvents)).toBe(true);
    expect(isNodeRef(stage.state.lexicalSeq)).toBe(true);
    expect(isNodeRef(stage.internals.lexicalToSyntactic)).toBe(true);

    expect(toNodeId(stage.inputs.lexicalEvents)).toBe('stage.inputs.lexicalEvents');
    expect(toNodeId(stage.outputs.semanticEvents)).toBe('stage.outputs.semanticEvents');
    expect(toNodeId(stage.state.lexicalSeq)).toBe('stage.state.lexicalSeq');
    expect(toNodeId(stage.internals.lexicalToSyntactic)).toBe('stage.internals.lexicalToSyntactic');

    expect(Object.keys(stage.public)).toEqual(['inputs', 'outputs']);
    expect(stage.public.inputs.lexicalEvents).toBe(stage.inputs.lexicalEvents);
    expect(stage.public.outputs.semanticEvents).toBe(stage.outputs.semanticEvents);
  });

  it('mounts the same module into isolated runtime scopes', () => {
    const stage = defineGraphModule('stage', {
      inputs: {
        lexicalEvents: input<string[]>(),
      },
      outputs: {
        semanticEvents: output<string[]>(),
      },
      state: {
        lexicalSeq: state<number>(),
      },
    } as const);

    const main = mountGraph(stage, { scope: 'agent/main' });
    const reviewer = mountGraph(stage, { scope: 'agent/reviewer' });

    expect(main.scope).toBe('agent/main');
    expect(reviewer.scope).toBe('agent/reviewer');

    expect(toNodeId(main.inputs.lexicalEvents)).toBe('agent/main::stage.inputs.lexicalEvents');
    expect(toNodeId(main.outputs.semanticEvents)).toBe('agent/main::stage.outputs.semanticEvents');
    expect(toNodeId(main.state.lexicalSeq)).toBe('agent/main::stage.state.lexicalSeq');

    expect(toNodeId(reviewer.inputs.lexicalEvents)).toBe('agent/reviewer::stage.inputs.lexicalEvents');
    expect(toNodeId(reviewer.outputs.semanticEvents)).toBe('agent/reviewer::stage.outputs.semanticEvents');
    expect(toNodeId(reviewer.state.lexicalSeq)).toBe('agent/reviewer::stage.state.lexicalSeq');

    expect(toNodeId(main.inputs.lexicalEvents)).not.toBe(toNodeId(reviewer.inputs.lexicalEvents));
    expect(main.public.inputs.lexicalEvents).toBe(main.inputs.lexicalEvents);
    expect(main.public.outputs.semanticEvents).toBe(main.outputs.semanticEvents);
  });
});
