export type NodeSection = 'input' | 'output' | 'state' | 'internal';

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

export type SlotDefinition<TValue, TSection extends NodeSection> = {
  readonly kind: 'slot-definition';
  readonly section: TSection;
  readonly __value?: TValue;
};

type InputDefinition<TValue> = SlotDefinition<TValue, 'input'>;
type OutputDefinition<TValue> = SlotDefinition<TValue, 'output'>;
type StateDefinition<TValue> = SlotDefinition<TValue, 'state'>;
type InternalDefinition<TValue> = SlotDefinition<TValue, 'internal'>;

export type GraphModuleDefinition = {
  inputs?: Record<string, InputDefinition<any>>;
  outputs?: Record<string, OutputDefinition<any>>;
  state?: Record<string, StateDefinition<any>>;
  internals?: Record<string, InternalDefinition<any>>;
};

type SectionRefs<
  TSectionDef,
  TSection extends NodeSection,
> = TSectionDef extends Record<string, SlotDefinition<any, TSection>>
  ? {
      readonly [K in keyof TSectionDef]: TSectionDef[K] extends SlotDefinition<infer TValue, TSection>
        ? NodeRef<TValue, TSection>
        : never;
    }
  : {};

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

export function toNodeId(ref: string | NodeRef<unknown, NodeSection>): string {
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
  section: Record<string, SlotDefinition<any, TSection>> | undefined,
  kind: TSection,
  scope?: string,
): Record<string, NodeRef<unknown, TSection>> {
  if (!section) {
    return {};
  }

  const refs: Record<string, NodeRef<unknown, TSection>> = {};

  for (const key of Object.keys(section)) {
    refs[key] = createNodeRef(moduleId, kind, key, scope);
  }

  return refs;
}

function createNodeRef<TValue, TSection extends NodeSection>(
  moduleId: string,
  section: TSection,
  key: string,
  scope?: string,
): NodeRef<TValue, TSection> {
  const localId = `${moduleId}.${SECTION_SEGMENT[section]}.${key}`;
  const id = scope ? `${scope}::${localId}` : localId;

  return {
    [NODE_REF_BRAND]: true,
    id,
    moduleId,
    localId,
    key,
    section,
    scope,
  };
}
