import type { SignalNodeRef, StreamNodeRef } from './graph';

export type NodeSection = 'input' | 'output' | 'state' | 'internal';
export type NodeProtocol = 'signal' | 'stream';

type SectionKey = 'inputs' | 'outputs' | 'state' | 'internals';

const NODE_REF_BRAND = Symbol.for('@depa-data-graph/node-ref');

export type NodeRef<TValue = unknown, TSection extends NodeSection = NodeSection> = {
  readonly [NODE_REF_BRAND]: true;
  readonly id: string;
  readonly moduleId: string;
  readonly localId: string;
  readonly key: string;
  readonly section: TSection;
  readonly scope?: string;
  readonly __value?: TValue;
};

export type SlotDefinition<
  TValue,
  TSection extends NodeSection,
  TProtocol extends NodeProtocol | undefined = undefined,
> = {
  readonly kind: 'slot-definition';
  readonly section: TSection;
  readonly protocol?: TProtocol;
  readonly __value?: TValue;
};

type InputDefinition<
  TValue,
  TProtocol extends NodeProtocol | undefined = undefined,
> = SlotDefinition<TValue, 'input', TProtocol>;
type OutputDefinition<
  TValue,
  TProtocol extends NodeProtocol | undefined = undefined,
> = SlotDefinition<TValue, 'output', TProtocol>;
type StateDefinition<
  TValue,
  TProtocol extends NodeProtocol | undefined = undefined,
> = SlotDefinition<TValue, 'state', TProtocol>;
type InternalDefinition<
  TValue,
  TProtocol extends NodeProtocol | undefined = undefined,
> = SlotDefinition<TValue, 'internal', TProtocol>;

export type ModuleSignalNodeRef<TValue, TSection extends NodeSection> = NodeRef<TValue, TSection> &
  SignalNodeRef<TValue, TSection extends 'input' | 'state' ? true : false>;
export type ModuleStreamNodeRef<TValue, TSection extends NodeSection> = NodeRef<TValue, TSection> &
  StreamNodeRef<TValue>;

export type GraphModuleDefinition = {
  inputs?: Record<string, InputDefinition<any, NodeProtocol | undefined>>;
  outputs?: Record<string, OutputDefinition<any, NodeProtocol | undefined>>;
  state?: Record<string, StateDefinition<any, NodeProtocol | undefined>>;
  internals?: Record<string, InternalDefinition<any, NodeProtocol | undefined>>;
};

type SectionRefs<TSectionDef, TSection extends NodeSection> =
  TSectionDef extends Record<string, SlotDefinition<any, TSection, NodeProtocol | undefined>>
    ? {
        readonly [K in keyof TSectionDef]: TSectionDef[K] extends SlotDefinition<
          infer TValue,
          TSection,
          infer TProtocol
        >
          ? TProtocol extends 'signal'
            ? ModuleSignalNodeRef<TValue, TSection>
            : TProtocol extends 'stream'
              ? ModuleStreamNodeRef<TValue, TSection>
              : NodeRef<TValue, TSection>
          : never;
      }
    : Record<never, never>;

export type GraphModule<TDef extends GraphModuleDefinition = GraphModuleDefinition> = {
  readonly kind: 'graph-module';
  readonly moduleId: string;
  readonly inputs: SectionRefs<TDef['inputs'], 'input'>;
  readonly outputs: SectionRefs<TDef['outputs'], 'output'>;
  readonly state: SectionRefs<TDef['state'], 'state'>;
  readonly internals: SectionRefs<TDef['internals'], 'internal'>;
  readonly public: {
    readonly inputs: SectionRefs<TDef['inputs'], 'input'>;
    readonly outputs: SectionRefs<TDef['outputs'], 'output'>;
  };
  readonly definition: TDef;
};

export type MountedGraphModule<TDef extends GraphModuleDefinition = GraphModuleDefinition> = {
  readonly kind: 'mounted-graph-module';
  readonly moduleId: string;
  readonly scope: string;
  readonly inputs: SectionRefs<TDef['inputs'], 'input'>;
  readonly outputs: SectionRefs<TDef['outputs'], 'output'>;
  readonly state: SectionRefs<TDef['state'], 'state'>;
  readonly internals: SectionRefs<TDef['internals'], 'internal'>;
  readonly public: {
    readonly inputs: SectionRefs<TDef['inputs'], 'input'>;
    readonly outputs: SectionRefs<TDef['outputs'], 'output'>;
  };
  readonly definition: TDef;
};

const SECTION_SEGMENT: Record<NodeSection, SectionKey> = {
  input: 'inputs',
  output: 'outputs',
  state: 'state',
  internal: 'internals',
};

export function input<TValue>(): InputDefinition<TValue> {
  return { kind: 'slot-definition', section: 'input' };
}

export function output<TValue>(): OutputDefinition<TValue> {
  return { kind: 'slot-definition', section: 'output' };
}

export function state<TValue>(): StateDefinition<TValue> {
  return { kind: 'slot-definition', section: 'state' };
}

export function internal<TValue>(): InternalDefinition<TValue> {
  return { kind: 'slot-definition', section: 'internal' };
}

export function signalInput<TValue>(): InputDefinition<TValue, 'signal'> {
  return { kind: 'slot-definition', section: 'input', protocol: 'signal' };
}

export function streamInput<TValue>(): InputDefinition<TValue, 'stream'> {
  return { kind: 'slot-definition', section: 'input', protocol: 'stream' };
}

export function signalOutput<TValue>(): OutputDefinition<TValue, 'signal'> {
  return { kind: 'slot-definition', section: 'output', protocol: 'signal' };
}

export function streamOutput<TValue>(): OutputDefinition<TValue, 'stream'> {
  return { kind: 'slot-definition', section: 'output', protocol: 'stream' };
}

export function signalState<TValue>(): StateDefinition<TValue, 'signal'> {
  return { kind: 'slot-definition', section: 'state', protocol: 'signal' };
}

export function streamState<TValue>(): StateDefinition<TValue, 'stream'> {
  return { kind: 'slot-definition', section: 'state', protocol: 'stream' };
}

export function signalInternal<TValue>(): InternalDefinition<TValue, 'signal'> {
  return { kind: 'slot-definition', section: 'internal', protocol: 'signal' };
}

export function streamInternal<TValue>(): InternalDefinition<TValue, 'stream'> {
  return { kind: 'slot-definition', section: 'internal', protocol: 'stream' };
}

export function defineGraphModule<const TDef extends GraphModuleDefinition>(
  moduleId: string,
  definition: TDef,
): GraphModule<TDef> {
  return buildGraphModule(moduleId, definition);
}

export function mountGraph<const TDef extends GraphModuleDefinition>(
  module: GraphModule<TDef>,
  options: { scope: string },
): MountedGraphModule<TDef> {
  return buildMountedGraphModule(module.moduleId, module.definition, options.scope);
}

export function isNodeRef(value: unknown): value is NodeRef<unknown, NodeSection> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    NODE_REF_BRAND in (value as Record<PropertyKey, unknown>) &&
    (value as Record<PropertyKey, unknown>)[NODE_REF_BRAND] === true,
  );
}

export function toNodeId(
  ref: string | NodeRef<unknown, NodeSection> | { readonly id: string },
): string {
  return typeof ref === 'string' ? ref : ref.id;
}

function buildGraphModule<const TDef extends GraphModuleDefinition>(
  moduleId: string,
  definition: TDef,
): GraphModule<TDef> {
  const inputs = materializeSection(moduleId, definition.inputs, 'input');
  const outputs = materializeSection(moduleId, definition.outputs, 'output');
  const stateRefs = materializeSection(moduleId, definition.state, 'state');
  const internals = materializeSection(moduleId, definition.internals, 'internal');

  return {
    kind: 'graph-module',
    moduleId,
    inputs: inputs as SectionRefs<TDef['inputs'], 'input'>,
    outputs: outputs as SectionRefs<TDef['outputs'], 'output'>,
    state: stateRefs as SectionRefs<TDef['state'], 'state'>,
    internals: internals as SectionRefs<TDef['internals'], 'internal'>,
    public: {
      inputs: inputs as SectionRefs<TDef['inputs'], 'input'>,
      outputs: outputs as SectionRefs<TDef['outputs'], 'output'>,
    },
    definition,
  };
}

function buildMountedGraphModule<const TDef extends GraphModuleDefinition>(
  moduleId: string,
  definition: TDef,
  scope: string,
): MountedGraphModule<TDef> {
  const inputs = materializeSection(moduleId, definition.inputs, 'input', scope);
  const outputs = materializeSection(moduleId, definition.outputs, 'output', scope);
  const stateRefs = materializeSection(moduleId, definition.state, 'state', scope);
  const internals = materializeSection(moduleId, definition.internals, 'internal', scope);

  return {
    kind: 'mounted-graph-module',
    moduleId,
    scope,
    inputs: inputs as SectionRefs<TDef['inputs'], 'input'>,
    outputs: outputs as SectionRefs<TDef['outputs'], 'output'>,
    state: stateRefs as SectionRefs<TDef['state'], 'state'>,
    internals: internals as SectionRefs<TDef['internals'], 'internal'>,
    public: {
      inputs: inputs as SectionRefs<TDef['inputs'], 'input'>,
      outputs: outputs as SectionRefs<TDef['outputs'], 'output'>,
    },
    definition,
  };
}

function materializeSection<TSection extends NodeSection>(
  moduleId: string,
  section: Record<string, SlotDefinition<any, TSection, NodeProtocol | undefined>> | undefined,
  kind: TSection,
  scope?: string,
): Record<
  string,
  | NodeRef<unknown, TSection>
  | ModuleSignalNodeRef<unknown, TSection>
  | ModuleStreamNodeRef<unknown, TSection>
> {
  if (!section) {
    return {};
  }

  const refs: Record<
    string,
    | NodeRef<unknown, TSection>
    | ModuleSignalNodeRef<unknown, TSection>
    | ModuleStreamNodeRef<unknown, TSection>
  > = {};

  for (const key of Object.keys(section)) {
    refs[key] = createNodeRef(moduleId, kind, key, section[key].protocol, scope);
  }

  return refs;
}

function createNodeRef<TValue, TSection extends NodeSection>(
  moduleId: string,
  section: TSection,
  key: string,
  protocol?: NodeProtocol,
  scope?: string,
):
  | NodeRef<TValue, TSection>
  | ModuleSignalNodeRef<TValue, TSection>
  | ModuleStreamNodeRef<TValue, TSection> {
  const localId = `${moduleId}.${SECTION_SEGMENT[section]}.${key}`;
  const id = scope ? `${scope}::${localId}` : localId;

  const ref: NodeRef<TValue, TSection> = {
    [NODE_REF_BRAND]: true,
    id,
    moduleId,
    localId,
    key,
    section,
    scope,
  };

  if (protocol === 'signal') {
    return {
      ...ref,
      protocol,
      writable: (section === 'input' || section === 'state') as TSection extends 'input' | 'state'
        ? true
        : false,
    };
  }
  if (protocol === 'stream') {
    return { ...ref, protocol };
  }
  return ref;
}
