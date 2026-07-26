import {
  DataGraph,
  type FeedbackBoundaryOptions,
  type FeedbackQueuePolicy,
  type GraphValidationError,
  type StreamNodeRef,
} from '../src';

const graph = new DataGraph(() => ({}));
const source = graph.addSource<number>('source', { start: () => {}, stop: () => {} });

const queue: FeedbackQueuePolicy = 'latest';
const options = {
  kind: 'scheduler',
  queue,
  schedule: (_task: () => void) => () => {},
} satisfies FeedbackBoundaryOptions;

const boundary = graph.addFeedbackBoundary('boundary', source.ref, options);
const boundaryRef: StreamNodeRef<number> = boundary.ref;
void boundaryRef;

declare const error: GraphValidationError;
if (error.kind === 'mixedCycle') {
  const path: string[] = error.path;
  void path;
}

const signal = graph.addSignal('signal', 0);
// @ts-expect-error A feedback boundary requires a Stream input.
graph.addFeedbackBoundary('invalid-boundary', signal.ref, options);

// @ts-expect-error Queue policy must define deterministic buffering behavior.
const invalidQueue: FeedbackQueuePolicy = 'unbounded';
void invalidQueue;
