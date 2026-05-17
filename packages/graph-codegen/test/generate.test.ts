import { describe, expect, it } from 'vitest';

import { generateGraphIdentitySurface, generateGraphModel } from '../src/generate';

describe('graph-codegen', () => {
  it('generates GraphModel with async subnodes', () => {
    const spec = {
      version: 1,
      nodes: [
        { kind: 'signal', id: 'counter', initial: 0 },
        { kind: 'computed', id: 'doubled', deps: ['counter'], logicKey: 'doubled' },
        { kind: 'async', id: 'fetchUser', deps: [], initial: null, logicKey: 'fetchUser' },
      ],
    } as const;

    const out = generateGraphModel(spec);

    expect(out).toContain('export interface GraphModel');

    expect(out).toContain('counter: number;');
    expect(out).toContain('doubled: unknown;');

    expect(out).toContain("'fetchUser/result': null;");
    expect(out).toContain("'fetchUser/loading': boolean;");
    expect(out).toContain("'fetchUser/error': string | null;");
  });

  it('generates module-aware identity surface from flat json graph spec', () => {
    const spec = {
      version: 1,
      nodes: [
        { kind: 'signal', id: 'counter', initial: 0, flags: { in: true, out: true } },
        { kind: 'signal', id: 'hello/input', initial: '', flags: { in: true, out: true } },
        { kind: 'computed', id: 'doubled', deps: ['counter'], logicKey: 'doubled', flags: { out: true } },
        { kind: 'computed', id: 'private/preview', deps: ['counter'], logicKey: 'preview' },
        { kind: 'processor', id: 'processor/logCounter', deps: ['counter'], outputs: [], logicKey: 'logCounter' },
        { kind: 'async', id: 'fetchUser', deps: [], initial: null, logicKey: 'fetchUser', flags: { out: true } },
        { kind: 'async', id: 'loadDraft', deps: [], initial: { draft: true }, logicKey: 'loadDraft' },
      ],
    } as const;

    const out = generateGraphIdentitySurface(spec, {
      moduleId: 'demoGraph',
      exportName: 'DemoGraphIdentity',
    });

    expect(out).toContain("export const GraphModule = defineGraphModule('demoGraph'");
    expect(out).toContain("import { defineGraphModule, input, internal, output, state } from 'depa-data-graph-core';");
    expect(out).toContain('counter: input<number>(),');
    expect(out).toContain('hello_input: input<string>(),');
    expect(out).toContain('counter: state<number>(),');
    expect(out).toContain('hello_input: state<string>(),');
    expect(out).toContain('doubled: output<unknown>(),');
    expect(out).toContain('private_preview: internal<unknown>(),');
    expect(out).toContain('processor_logCounter: internal<void>(),');
    expect(out).toContain('loadDraft_result: internal<Record<string, unknown>>(),');
    expect(out).toContain('loadDraft_loading: internal<boolean>(),');
    expect(out).toContain('loadDraft_error: internal<string | null>(),');
    expect(out).toContain("'counter': GraphModule.state.counter,");
    expect(out).toContain("'hello/input': GraphModule.state.hello_input,");
    expect(out).toContain("'counter': GraphModule.inputs.counter,");
    expect(out).toContain("'hello/input': GraphModule.inputs.hello_input,");
    expect(out).toContain("'counter': GraphModule.outputs.counter,");
    expect(out).toContain("'hello/input': GraphModule.outputs.hello_input,");
    expect(out).toContain("'doubled': GraphModule.outputs.doubled,");
    expect(out).toContain("'private/preview': GraphModule.internals.private_preview,");
    expect(out).toContain("'fetchUser/result': GraphModule.outputs.fetchUser_result,");
    expect(out).toContain("'loadDraft/result': GraphModule.internals.loadDraft_result,");
    expect(out).not.toContain("'private/preview': GraphModule.outputs.private_preview,");
    expect(out).not.toContain("'loadDraft/result': GraphModule.outputs.loadDraft_result,");
    expect(out).toContain('export const DemoGraphIdentity = {');
  });
});
