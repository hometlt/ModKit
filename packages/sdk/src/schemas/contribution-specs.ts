/** Strict A-1 schemas selected by the contribution envelope contract. */

import { deepFreeze, UINT64_DECIMAL_PATTERN } from '@modkitx-x3/core'
import { STANDARD_DATA_SOURCE_CONTRACTS } from '../asset-capabilities/data-source-ids.js'
import {
  METHOD_NAME_PATTERN,
  NAMESPACED_DOTTED_PATTERN,
  OPERATION_PATTERN,
  QUALIFIED_PATTERN,
  SEGMENT_PATTERN,
  SEMVER_PATTERN,
  VERSION_RANGE_PATTERN,
} from './patterns.js'
import { PERMISSION_CLASSES } from './contribution-manifest.js'

const nonEmptyString = { type: 'string', minLength: 1 } as const
const qualifiedId = { type: 'string', pattern: QUALIFIED_PATTERN } as const
const namespacedDottedId = { type: 'string', pattern: NAMESPACED_DOTTED_PATTERN } as const
const operationId = { type: 'string', pattern: OPERATION_PATTERN } as const
const decimalU64 = { type: 'string', pattern: UINT64_DECIMAL_PATTERN } as const

export const jsonSchemaRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['$ref'],
  properties: { $ref: nonEmptyString },
} as const

export const resourceBudgetWireSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['maxInputBytes', 'maxDepth', 'maxNodes', 'maxScalarBytes', 'maxDiagnostics'],
  properties: {
    maxInputBytes: decimalU64,
    maxDepth: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxNodes: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxScalarBytes: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxDiagnostics: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    deadlineMs: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
} as const

export const dataSourceRefWireSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['contract', 'major'],
      properties: {
        contract: { enum: STANDARD_DATA_SOURCE_CONTRACTS },
        major: { const: 1 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['contract', 'major', 'opaque'],
      properties: {
        contract: { ...qualifiedId, not: { enum: STANDARD_DATA_SOURCE_CONTRACTS } },
        major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        opaque: { const: true },
      },
    },
  ],
} as const

const contractRequirementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['contract', 'major'],
  properties: {
    contract: qualifiedId,
    major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: 'string', pattern: VERSION_RANGE_PATTERN },
  },
} as const

const formatRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['formatId', 'label'],
  properties: {
    formatId: nonEmptyString,
    label: nonEmptyString,
    mediaType: nonEmptyString,
  },
} as const

/**
 * NXT-101B: a declared, data-only byte signature. `from: 'start'` anchors the pattern at
 * `offset` from the beginning; `from: 'end'` anchors it `offset` bytes before EOF (the pattern
 * occupies `[size - offset, size - offset + bytes)`, so `offset ≥ pattern length`). `maskHex`
 * (same length) ANDs both sides before comparing. Bounds keep the host's candidate index
 * reads bounded: offset ≤ 4096, pattern ≤ 64 bytes, ≤ 8 signatures per codec.
 */
const signatureRuleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'offset', 'bytesHex'],
  properties: {
    from: { enum: ['start', 'end'] },
    offset: { type: 'integer', minimum: 0, maximum: 4096 },
    bytesHex: { type: 'string', pattern: '^(?:[0-9a-f]{2}){1,64}$' },
    maskHex: { type: 'string', pattern: '^(?:[0-9a-f]{2}){1,64}$' },
  },
} as const

const matchRulesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    extensions: { type: 'array', items: nonEmptyString },
    mediaTypes: { type: 'array', items: nonEmptyString },
    pathGlobs: { type: 'array', items: nonEmptyString },
    signatures: { type: 'array', items: signatureRuleSchema, maxItems: 8 },
  },
} as const

const probePlanSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'ranges', 'maxBytes'],
      properties: {
        kind: { const: 'bytes' },
        ranges: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'length'],
            properties: {
              from: { enum: ['start', 'end'] },
              length: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            },
          },
        },
        maxBytes: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'markers', 'maxEntries', 'maxBytes', 'maxDepth', 'maxPathBytes'],
      properties: {
        kind: { const: 'namespace' },
        markers: {
          type: 'array',
          items: nonEmptyString,
          minItems: 1,
          maxItems: 256,
          uniqueItems: true,
        },
        prefixes: { type: 'array', items: nonEmptyString },
        maxEntries: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxBytes: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxDepth: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxPathBytes: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'maxSubjects', 'maxRelationDepth'],
      properties: {
        kind: { const: 'derived' },
        maxSubjects: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxRelationDepth: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    },
  ],
} as const

const traitDefinitionRequirementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: namespacedDottedId,
    definitionRange: { type: 'string', pattern: VERSION_RANGE_PATTERN },
  },
} as const

const traitQueryRequirementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    ...traitDefinitionRequirementSchema.properties,
    states: {
      type: 'array',
      items: { enum: ['available', 'partial', 'disabled', 'dependency-required'] },
      minItems: 1,
      uniqueItems: true,
    },
  },
} as const

const companionRuleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'role', 'required', 'patterns', 'searchScopes'],
  properties: {
    id: { type: 'string', pattern: SEGMENT_PATTERN },
    role: nonEmptyString,
    required: { type: 'boolean' },
    patterns: { type: 'array', items: nonEmptyString, minItems: 1 },
    expected: {
      type: 'object',
      additionalProperties: false,
      properties: {
        all: { type: 'array', items: traitQueryRequirementSchema },
        any: { type: 'array', items: traitQueryRequirementSchema },
        none: { type: 'array', items: traitQueryRequirementSchema },
      },
    },
    searchScopes: {
      type: 'array',
      minItems: 1,
      items: {
        enum: [
          'sibling-directory',
          'current-mount',
          'enclosing-container',
          'workspace-dependency-layer',
          'explicit-user-selection',
        ],
      },
    },
  },
} as const

const representationDeclSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'contract', 'major', 'stage', 'lossy'],
  properties: {
    id: nonEmptyString,
    contract: qualifiedId,
    major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    stage: { enum: ['authored', 'compiled', 'runtime'] },
    lossy: { type: 'boolean' },
  },
} as const

const operationDeclSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'handlerId', 'mutatesSource'],
  properties: {
    id: operationId,
    handlerId: nonEmptyString,
    mutatesSource: { type: 'boolean' },
    requiredPermissions: { type: 'array', items: { enum: PERMISSION_CLASSES } },
    requiresContract: contractRequirementSchema,
    inputSchema: jsonSchemaRefSchema,
    outputKinds: {
      type: 'array',
      items: {
        enum: ['json', 'bytes', 'stream', 'source', 'artifact', 'none', 'edit-plan', 'transaction'],
      },
    },
  },
} as const

const traitDeclarationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'representation', 'presence'],
  properties: {
    id: namespacedDottedId,
    definitionVersion: { type: 'string', pattern: SEMVER_PATTERN },
    representation: { enum: ['source', 'compiled', 'runtime'] },
    presence: { enum: ['may-expose', 'will-expose'] },
    prerequisites: { type: 'array', items: contractRequirementSchema },
    evidenceRefs: { type: 'array', items: nonEmptyString, uniqueItems: true },
  },
} as const

const fidelityNotesSchema = { type: 'array', items: nonEmptyString } as const

const fidelityClaimSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['roundTrip', 'preservesUnknownData'],
      properties: {
        roundTrip: { const: 'byte-identical' },
        preservesUnknownData: { const: true },
        notes: fidelityNotesSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['roundTrip', 'preservesUnknownData'],
      properties: {
        roundTrip: { const: 'semantic' },
        preservesUnknownData: { type: 'boolean' },
        notes: fidelityNotesSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['roundTrip', 'preservesUnknownData'],
      properties: {
        roundTrip: { enum: ['lossy', 'none'] },
        preservesUnknownData: { const: false },
        notes: fidelityNotesSchema,
      },
    },
  ],
} as const

const codecFidelityEvidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'formatId',
    'representationId',
    'claim',
    'evidenceId',
    'corpusId',
    'corpusDigest',
    'conformanceProfile',
    'optionsFingerprint',
    'inputClass',
    'provenAt',
  ],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    claim: fidelityClaimSchema,
    evidenceId: nonEmptyString,
    corpusId: nonEmptyString,
    corpusDigest: nonEmptyString,
    conformanceProfile: qualifiedId,
    optionsFingerprint: nonEmptyString,
    inputClass: nonEmptyString,
    provenAt: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$',
    },
  },
} as const

const codecContributionRequired = [
  'formatRefs',
  'roles',
  'sourceTopology',
  'artifactStages',
  'openIntents',
  'match',
  'probe',
  'representations',
  'publishesDataSources',
  'operations',
  'implementationTier',
  'budgets',
] as const

const codecContributionProperties = {
  formatRefs: { type: 'array', items: formatRefSchema, minItems: 1 },
  roles: {
    type: 'array',
    items: { enum: ['container', 'media', 'byte-transform', 'semantic', 'index', 'sidecar'] },
    minItems: 1,
  },
  artifactStages: {
    type: 'array',
    items: { enum: ['authored', 'compiled', 'runtime'] },
    minItems: 1,
  },
  openIntents: {
    type: 'array',
    items: { enum: ['probe', 'inspect', 'thumbnail', 'full', 'stream', 'export'] },
    minItems: 1,
  },
  match: matchRulesSchema,
  companions: { type: 'array', items: companionRuleSchema },
  representations: { type: 'array', items: representationDeclSchema, minItems: 1 },
  publishesDataSources: { type: 'array', items: dataSourceRefWireSchema },
  requires: { type: 'array', items: contractRequirementSchema },
  operations: { type: 'array', items: operationDeclSchema },
  traitDeclarations: { type: 'array', items: traitDeclarationSchema },
  fidelityEvidence: { type: 'array', items: codecFidelityEvidenceSchema },
  implementationTier: {
    type: 'object',
    additionalProperties: false,
    required: ['claimed'],
    properties: { claimed: { enum: [1, 2, 3, 4, 5] } },
  },
  budgets: resourceBudgetWireSchema,
} as const

export const codecContributionSpecV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/codec-contribution-spec.v1.schema.json',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { enum: ['single', 'bundle'] },
        probe: probePlanSchema.oneOf[0],
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: 'namespace' },
        probe: probePlanSchema.oneOf[1],
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: 'derived' },
        probe: probePlanSchema.oneOf[2],
      },
    },
  ],
} as const

const serviceContractOfferDeclarationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['offerId', 'contract', 'major', 'version'],
  properties: {
    offerId: { type: 'string', pattern: SEGMENT_PATTERN },
    contract: qualifiedId,
    major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    version: { type: 'string', pattern: SEMVER_PATTERN },
    facet: { title: 'JsonValue' },
  },
} as const

export const serviceProviderContributionSpecV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/service-provider-contribution-spec.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['provides', 'lifecycleScope'],
  properties: {
    provides: { type: 'array', items: serviceContractOfferDeclarationSchema, minItems: 1 },
    requires: { type: 'array', items: contractRequirementSchema },
    inputs: { type: 'array', items: nonEmptyString },
    outputs: { type: 'array', items: traitDeclarationSchema },
    protocolOperations: { type: 'array', items: nonEmptyString },
    replacement: {
      type: 'object',
      additionalProperties: false,
      required: ['target', 'compatible'],
      properties: { target: contractRequirementSchema, compatible: { type: 'boolean' } },
    },
    lifecycleScope: { enum: ['session', 'operation', 'process'] },
    applicableVariants: { type: 'array', items: { type: 'string', pattern: SEGMENT_PATTERN } },
  },
} as const

const traitRequirementSchema = traitQueryRequirementSchema

const viewerApplicabilitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    interpretation: { enum: ['none', 'codec', 'any'] },
    sourceBytes: {
      type: 'object',
      additionalProperties: false,
      properties: { maximum: decimalU64 },
    },
    longestLineBytes: {
      type: 'object',
      additionalProperties: false,
      required: ['maximum', 'whenUnknown'],
      properties: {
        maximum: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        whenUnknown: { enum: ['eligible', 'ineligible'] },
      },
    },
  },
} as const

export const viewerContributionSpecV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/viewer-contribution-spec.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'consumesDataSources', 'priority'],
  properties: {
    kind: { enum: ['stage', 'tree', 'panel', 'toolbar', 'transport', 'status', 'fallback'] },
    requiresTraits: { type: 'array', items: traitRequirementSchema },
    requiresOperations: { type: 'array', items: operationId },
    consumesDataSources: { type: 'array', items: dataSourceRefWireSchema },
    /*
     * Sources a viewer reads when the subject publishes them and does without when it does not.
     *
     * Kept apart from `consumesDataSources` because that list decides eligibility: a facet named
     * there would cost the stage every subject that publishes none of them, which is the opposite
     * of optional. Naming them separately is what lets one generic viewer consume the optional
     * model facets instead of splitting into a contribution per facet combination.
     */
    optionalDataSources: { type: 'array', items: dataSourceRefWireSchema },
    applicability: viewerApplicabilitySchema,
    hosts: { type: 'array', items: nonEmptyString },
    priority: { type: 'number' },
    conflicts: { type: 'array', items: nonEmptyString },
    singletonGroup: nonEmptyString,
  },
} as const

const writerRequirementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['formatId', 'representationId', 'mutationMode', 'minimumRoundTrip'],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    mutationMode: { enum: ['export-only', 'mutate'] },
    minimumRoundTrip: { enum: ['byte-identical', 'semantic', 'lossy', 'none'] },
  },
} as const

/**
 * Standalone facet schemas of `common.edit/writer@1` (ADR-HOST-002 §3): the request facet is the
 * editor's `writer` requirement, the offer facet adds the provider's identity and its fidelity
 * evidence id. Published so the standard writer contract definition can reference them.
 */
export const writerRequirementV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/writer-requirement.v1.schema.json',
  ...writerRequirementSchema,
} as const

export const writerOfferV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/writer-offer.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [...writerRequirementSchema.required, 'providerId', 'fidelityEvidenceId'],
  properties: {
    ...writerRequirementSchema.properties,
    providerId: nonEmptyString,
    fidelityEvidenceId: nonEmptyString,
  },
} as const

export const editorContributionSpecV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/editor-contribution-spec.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'sessionModel',
    'selectionKinds',
    'semanticLocationKinds',
    'requiresTransactions',
    'requiresOperations',
    'consumesDataSources',
    'writer',
    'priority',
  ],
  properties: {
    sessionModel: { enum: ['single-subject', 'multi-subject', 'workspace'] },
    selectionKinds: { type: 'array', items: nonEmptyString, uniqueItems: true },
    semanticLocationKinds: { type: 'array', items: nonEmptyString, uniqueItems: true },
    requiresTransactions: { type: 'boolean' },
    requiresOperations: { type: 'array', items: operationId, uniqueItems: true },
    consumesDataSources: { type: 'array', items: dataSourceRefWireSchema, uniqueItems: true },
    writer: writerRequirementSchema,
    hosts: { type: 'array', items: nonEmptyString, uniqueItems: true },
    priority: { type: 'number' },
    scaleLimits: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maximumSubjects: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumRows: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumSourceBytes: decimalU64,
      },
    },
  },
} as const

export const traitDefinitionSpecV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/trait-definition-spec.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'version', 'scope', 'parametersSchema', 'transport'],
  properties: {
    schemaVersion: { const: 1 },
    id: namespacedDottedId,
    version: { type: 'string', pattern: SEMVER_PATTERN },
    scope: {
      anyOf: [
        {
          enum: [
            'source',
            'asset',
            'subject',
            'workspace',
            'service',
            'operation',
            'view-session',
            'representation',
          ],
        },
        { type: 'string', pattern: QUALIFIED_PATTERN },
      ],
    },
    parametersSchema: jsonSchemaRefSchema,
    transport: { enum: ['json', 'structured-clone'] },
    documentation: nonEmptyString,
    imports: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'range'],
        properties: {
          id: namespacedDottedId,
          range: { type: 'string', pattern: VERSION_RANGE_PATTERN },
        },
      },
    },
  },
} as const

/**
 * Data-source method surface (NXT-103): the contract-definition-owned description of *how* a
 * data-source object is called across an execution boundary — method names, what each returns
 * (a value, a leased capability, a leased plain value, a pull iterator, a push event stream), where
 * the trailing `AbortSignal` goes, which methods are optional on the ABI, and bounded limits. It is
 * data about the contract, never executable authority: the host capability-RPC core turns it into
 * proxies; no transport or application keeps a method allowlist of its own.
 */
const methodName = { type: 'string', pattern: METHOD_NAME_PATTERN } as const

const dataSourceSurfaceRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['contract', 'major'],
  properties: {
    contract: qualifiedId,
    major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
} as const

const dataSourceMethodLimitsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    maxPageItems: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    maxBytes: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxStringLength: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
} as const

/** A top-level key of an object argument: `{ arg: 0, key: 'signal' }` (`ParseRequest.signal`). */
const argKeyRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['arg', 'key'],
  properties: {
    arg: { type: 'integer', minimum: 0, maximum: 16 },
    key: methodName,
  },
} as const

const dataSourceMethodSurfaceCommon = {
  /**
   * Where the executing side places the `AbortSignal`: appended last, nowhere, or as a key of an
   * object argument (the consumer strips that key before sending, the executor re-creates it).
   */
  signal: { anyOf: [{ enum: ['last', 'none'] }, argKeyRefSchema] },
  /** Where a progress callback lives inside an object argument (`invoke(…, { onProgress })`). */
  progress: argKeyRefSchema,
  /**
   * Positional argument count before the signal. The executing side pads omitted trailing
   * arguments with `undefined` up to `arity` before appending the signal, so
   * `encoded(trackId?, signal?)` called as `encoded()` still receives its signal last.
   */
  arity: { type: 'integer', minimum: 0, maximum: 16 },
  /** The ABI declares the method with `?`; an implementation may lack it. */
  optional: { type: 'boolean' },
  limits: dataSourceMethodLimitsSchema,
} as const

/** `lease` names the surface of what it leases; every other kind is result-free by construction. */
export const dataSourceMethodSurfaceV1Schema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'result'],
      properties: {
        kind: { const: 'lease' },
        result: dataSourceSurfaceRefSchema,
        /** `'lease'` materializes `{ value, release }`; `'bare'` (default) the capability object itself. */
        wrapper: { enum: ['lease', 'bare'] },
        ...dataSourceMethodSurfaceCommon,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { enum: ['value', 'leased-value', 'iterable', 'events'] },
        ...dataSourceMethodSurfaceCommon,
      },
    },
  ],
} as const

export const dataSourceSurfaceV1Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['methods'],
  properties: {
    /** A `value` method whose completion also releases the capability (`dispose`-style ABIs). */
    releaseVia: methodName,
    /**
     * Data properties of the object copied to the consumer with its handle (`TextSyntaxProvider.contract`);
     * exposed as read-only properties next to the proxied methods.
     */
    fields: { type: 'array', items: methodName, maxItems: 64, uniqueItems: true },
    methods: {
      type: 'object',
      minProperties: 1,
      propertyNames: methodName,
      additionalProperties: dataSourceMethodSurfaceV1Schema,
    },
  },
} as const

export const serviceContractDefinitionSpecV1Schema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'kind',
    'contract',
    'major',
    'offerFacet',
    'requestFacet',
    'matching',
    'conformanceProfile',
  ],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: 'service' },
    contract: qualifiedId,
    major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    offerFacet: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['presence'],
          properties: { presence: { const: 'forbidden' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['presence', 'schema'],
          properties: {
            presence: { enum: ['optional', 'required'] },
            schema: jsonSchemaRefSchema,
          },
        },
      ],
    },
    requestFacet: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['presence'],
          properties: { presence: { const: 'forbidden' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['presence', 'schema'],
          properties: {
            presence: { enum: ['optional', 'required'] },
            schema: jsonSchemaRefSchema,
          },
        },
      ],
    },
    matching: {
      type: 'object',
      additionalProperties: false,
      required: ['profile', 'major'],
      properties: {
        profile: qualifiedId,
        major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        configuration: { title: 'JsonValue' },
      },
    },
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema,
  },
} as const

export const dataSourceContractDefinitionSpecV1Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'kind', 'contract', 'major', 'schema', 'conformanceProfile'],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: 'data-source' },
    contract: qualifiedId,
    major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    schema: jsonSchemaRefSchema,
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema,
  },
} as const

export const contractDefinitionSpecV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/contract-definition-spec.v1.schema.json',
  oneOf: [serviceContractDefinitionSpecV1Schema, dataSourceContractDefinitionSpecV1Schema],
} as const

/** Compatibility export; the contract-definition data-source arm is the only wire authority. */
export const dataSourceContributionSpecV1Schema = dataSourceContractDefinitionSpecV1Schema

deepFreeze(jsonSchemaRefSchema)
deepFreeze(resourceBudgetWireSchema)
deepFreeze(dataSourceRefWireSchema)
deepFreeze(codecContributionSpecV1Schema)
deepFreeze(serviceProviderContributionSpecV1Schema)
deepFreeze(viewerContributionSpecV1Schema)
deepFreeze(editorContributionSpecV1Schema)
deepFreeze(traitDefinitionSpecV1Schema)
deepFreeze(serviceContractDefinitionSpecV1Schema)
deepFreeze(dataSourceMethodSurfaceV1Schema)
deepFreeze(dataSourceSurfaceV1Schema)
deepFreeze(dataSourceContractDefinitionSpecV1Schema)
deepFreeze(contractDefinitionSpecV1Schema)
