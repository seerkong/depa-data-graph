import { createCodeGraphBuilder } from '../src/graph-builders';
import { DataGraph, type GraphNode } from '../src/graph';
import { defineGraphModule, mountGraph, output, state } from '../src/module-identity';

const graph = new DataGraph(() => ({}));
const builder = createCodeGraphBuilder(graph);

const stage = mountGraph(
  defineGraphModule('stage', {
    state: {
      lexicalSeq: state<number>(),
    },
    outputs: {
      semanticSeq: output<number>(),
    },
  } as const),
  { scope: 'agent/main' },
);

builder
  .signal(stage.state.lexicalSeq, 1)
  .computed(stage.outputs.semanticSeq, [stage.state.lexicalSeq], (rt) => {
    const lexical: number = rt.graph.get(stage.state.lexicalSeq);
    return lexical * 2;
  });

graph.set(stage.state.lexicalSeq, 2);
graph.set(stage.state.lexicalSeq, (prev) => prev + 1);

const lexical: number = graph.get(stage.state.lexicalSeq);
void lexical;

const semantic: number = graph.get(stage.outputs.semanticSeq);
void semantic;

const stateNode: GraphNode<number> = graph.node(stage.state.lexicalSeq);
void stateNode;

const outputNode: GraphNode<number> = graph.node(stage.outputs.semanticSeq);
void outputNode;
