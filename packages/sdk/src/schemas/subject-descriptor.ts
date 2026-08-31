/** Strict, wire-first schema authority for the MK3 AnyDescriptor v2 union. */

import { deepFreeze, sourceSpanSchema, UINT64_DECIMAL_PATTERN } from '@modkit/core'
import { dataSourceRefWireSchema } from './contribution-specs.js'
import { REVISION_ID_PATTERN } from '../subjects/refs.js'
import {
  NAMESPACED_DOTTED_PATTERN,
  OPERATION_PATTERN,
  QUALIFIED_PATTERN,
  SEMVER_PATTERN,
} from './patterns.js'

// The standalone schema has its own `$id`; embedded copies intentionally keep only the
// value shape so the descriptor authority never contains repeated nested schema IDs.
const sourceSpanValueSchema = { oneOf: sourceSpanSchema.oneOf } as const

const nonEmptyString = { type: 'string', minLength: 1 } as const
const nonWhitespaceString = { type: 'string', pattern: '\\S' } as const
const revisionString = { type: 'string', pattern: REVISION_ID_PATTERN } as const
const namespacedDottedId = { type: 'string', pattern: NAMESPACED_DOTTED_PATTERN } as const
const operationId = { type: 'string', pattern: OPERATION_PATTERN } as const
const stringArray = { type: 'array', items: { type: 'string' } } as const

const jsonValueRef = { $ref: '#/$defs/jsonValue' } as const
const jsonValueSchema = {
  title: 'JsonValue',
  oneOf: [
    { type: 'null' },
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string' },
    { type: 'array', items: jsonValueRef },
    { type: 'object', additionalProperties: jsonValueRef },
  ],
} as const

const assetSourceRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'uri'],
  properties: {
    id: nonWhitespaceString,
    uri: nonWhitespaceString,
    parentIds: { type: 'array', items: nonWhitespaceString, minItems: 1 },
  },
} as const

const sourceBindingDescriptorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'role', 'source', 'required', 'ownership', 'revision'],
  properties: {
    id: nonEmptyString,
    role: nonEmptyString,
    source: assetSourceRefSchema,
    required: { type: 'boolean' },
    ownership: { enum: ['owned', 'companion', 'external'] },
    revision: revisionString,
    mediaType: nonEmptyString,
  },
} as const

const subjectSnapshotRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['bindingId', 'role', 'subjectUri', 'revision', 'compositionFingerprint'],
  properties: {
    bindingId: nonEmptyString,
    role: nonEmptyString,
    subjectUri: nonEmptyString,
    revision: revisionString,
    compositionFingerprint: nonEmptyString,
  },
} as const

const derivationRecipeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['extensionId', 'extensionVersion', 'contributionId', 'operation'],
  properties: {
    extensionId: { type: 'string', pattern: QUALIFIED_PATTERN },
    extensionVersion: { type: 'string', pattern: SEMVER_PATTERN },
    contributionId: { type: 'string', pattern: QUALIFIED_PATTERN },
    operation: operationId,
    parameters: jsonValueRef,
  },
} as const

const materializedAssetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'revision'],
  properties: {
    source: assetSourceRefSchema,
    revision: revisionString,
    mediaType: nonEmptyString,
  },
} as const

const assetOriginDescriptorSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'binding'],
      properties: {
        kind: { const: 'single' },
        binding: sourceBindingDescriptorSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bindings'],
      properties: {
        kind: { const: 'bundle' },
        bindings: { type: 'array', items: sourceBindingDescriptorSchema, minItems: 1 },
        primary: nonEmptyString,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'root', 'revision'],
      properties: {
        kind: { const: 'namespace' },
        root: assetSourceRefSchema,
        revision: revisionString,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'inputs'],
      properties: {
        kind: { const: 'derived' },
        inputs: { type: 'array', items: subjectSnapshotRefSchema, minItems: 1 },
        recipe: derivationRecipeSchema,
        materialization: materializedAssetSchema,
      },
    },
  ],
} as const

const diagnosticSourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    extensionId: { type: 'string', pattern: QUALIFIED_PATTERN },
    contributionId: { type: 'string', pattern: QUALIFIED_PATTERN },
  },
} as const

const assetDiagnosticSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'code', 'category', 'severity', 'message'],
  properties: {
    id: nonEmptyString,
    code: { type: 'string', pattern: QUALIFIED_PATTERN },
    category: {
      enum: [
        'syntax',
        'structure',
        'fidelity',
        'dependency',
        'security',
        'performance',
        'operation',
        'io',
        'unknown',
      ],
    },
    severity: { enum: ['error', 'warning', 'information', 'hint'] },
    message: { type: 'string' },
    source: diagnosticSourceSchema,
    path: {
      type: 'array',
      items: {
        oneOf: [
          { type: 'string' },
          { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        ],
      },
    },
    range: sourceSpanValueSchema,
    data: jsonValueRef,
    relatedIds: stringArray,
  },
} as const

const traitProperties = {
  id: namespacedDottedId,
  descriptorVersion: { const: 1 },
  definitionVersion: { type: 'string', pattern: SEMVER_PATTERN },
  parameters: jsonValueRef,
} as const

const traitInstanceSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'descriptorVersion', 'state'],
      properties: { ...traitProperties, state: { const: 'available' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'descriptorVersion', 'state', 'diagnosticIds'],
      properties: {
        ...traitProperties,
        state: { enum: ['partial', 'disabled', 'dependency-required'] },
        diagnosticIds: { ...stringArray, minItems: 1 },
      },
    },
  ],
} as const

const jsonSchemaRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['$ref'],
  properties: { $ref: nonEmptyString },
} as const

const operationProperties = {
  id: operationId,
  handlerId: nonEmptyString,
  mutatesSource: { type: 'boolean' },
  inputSchema: jsonSchemaRefSchema,
} as const

const assetOperationDescriptorSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'handlerId', 'state', 'mutatesSource'],
      properties: { ...operationProperties, state: { const: 'available' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'handlerId', 'state', 'mutatesSource', 'reason'],
      properties: {
        ...operationProperties,
        state: { enum: ['disabled', 'dependency-required'] },
        reason: nonEmptyString,
      },
    },
  ],
} as const

const assetConstraintsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['readOnly', 'seekable', 'randomAccess', 'trusted'],
  properties: {
    readOnly: { type: 'boolean' },
    seekable: { type: 'boolean' },
    randomAccess: { type: 'boolean' },
    trusted: { type: 'boolean' },
    maxDecodedBytes: { type: 'string', pattern: UINT64_DECIMAL_PATTERN },
    unsupportedFeatures: stringArray,
  },
} as const

const metadataEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value'],
  properties: {
    key: nonEmptyString,
    value: jsonValueRef,
  },
} as const

const metadataGroupSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'entries'],
  properties: {
    id: nonEmptyString,
    label: { type: 'string' },
    entries: { type: 'array', items: metadataEntrySchema },
  },
} as const

const companionBaseProperties = {
  id: nonEmptyString,
  role: nonEmptyString,
  required: { type: 'boolean' },
  cardinality: { enum: ['one', 'zero-or-one', 'one-or-more', 'many'] },
  state: { enum: ['resolved', 'missing', 'ambiguous'] },
} as const

const requiredCompanionProperties = {
  ...companionBaseProperties,
  required: { const: true },
  cardinality: { enum: ['one', 'one-or-more'] },
} as const

const optionalCompanionProperties = {
  ...companionBaseProperties,
  required: { const: false },
  cardinality: { enum: ['zero-or-one', 'many'] },
} as const

const companionCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'revision'],
  properties: { source: assetSourceRefSchema, revision: revisionString },
} as const

const companionBindingIdsSchema = {
  type: 'array',
  items: nonEmptyString,
  minItems: 1,
  uniqueItems: true,
} as const

const singleCompanionBindingIdSchema = {
  ...companionBindingIdsSchema,
  maxItems: 1,
} as const

const companionDiagnosticIdsSchema = {
  type: 'array',
  items: nonEmptyString,
  minItems: 1,
  uniqueItems: true,
} as const

const companionDescriptorSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state', 'bindingIds'],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: 'one' },
        state: { const: 'resolved' },
        bindingIds: singleCompanionBindingIdSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state', 'bindingIds'],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: 'one-or-more' },
        state: { const: 'resolved' },
        bindingIds: companionBindingIdsSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state', 'bindingIds'],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: 'zero-or-one' },
        state: { const: 'resolved' },
        bindingIds: singleCompanionBindingIdSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state', 'bindingIds'],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: 'many' },
        state: { const: 'resolved' },
        bindingIds: companionBindingIdsSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state', 'diagnosticIds'],
      properties: {
        ...requiredCompanionProperties,
        state: { const: 'missing' },
        diagnosticIds: companionDiagnosticIdsSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state'],
      properties: {
        ...optionalCompanionProperties,
        state: { const: 'missing' },
        diagnosticIds: { type: 'array', items: nonEmptyString, uniqueItems: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state', 'candidates', 'diagnosticIds'],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: 'one' },
        state: { const: 'ambiguous' },
        candidates: {
          type: 'array',
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true,
        },
        diagnosticIds: companionDiagnosticIdsSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'role', 'required', 'cardinality', 'state', 'candidates', 'diagnosticIds'],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: 'zero-or-one' },
        state: { const: 'ambiguous' },
        candidates: {
          type: 'array',
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true,
        },
        diagnosticIds: companionDiagnosticIdsSchema,
      },
    },
  ],
} as const

const detectionEvidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'weight'],
  properties: {
    kind: { enum: ['magic', 'structure', 'companion', 'context', 'extension', 'user-override'] },
    weight: { type: 'number' },
    note: { type: 'string' },
  },
} as const

const detectionResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['codecId', 'confidence', 'evidence', 'requiredRanges'],
  properties: {
    codecId: { type: 'string', pattern: QUALIFIED_PATTERN },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', items: detectionEvidenceSchema },
    requiredRanges: { type: 'array', items: sourceSpanValueSchema },
    diagnostics: { type: 'array', items: assetDiagnosticSchema },
  },
} as const

const resolvedIdentitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['codecId', 'codecVersion', 'formatId', 'formatLabel', 'confidence', 'detection'],
  properties: {
    codecId: { type: 'string', pattern: QUALIFIED_PATTERN },
    codecVersion: { type: 'string', pattern: SEMVER_PATTERN },
    formatId: nonEmptyString,
    formatLabel: nonEmptyString,
    mediaType: nonEmptyString,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    detection: { type: 'array', items: detectionEvidenceSchema },
  },
} as const

const subjectRequired = [
  'schemaVersion',
  'subjectUri',
  'origin',
  'traits',
  'operations',
  'constraints',
  'dataSources',
  'diagnostics',
  'revision',
] as const

const subjectProperties = {
  schemaVersion: { const: 2 },
  subjectUri: nonWhitespaceString,
  origin: assetOriginDescriptorSchema,
  traits: { type: 'array', items: traitInstanceSchema },
  operations: { type: 'array', items: assetOperationDescriptorSchema },
  constraints: assetConstraintsSchema,
  dataSources: { type: 'array', items: dataSourceRefWireSchema },
  diagnostics: { type: 'array', items: assetDiagnosticSchema },
  revision: revisionString,
} as const

const unresolvedSourceDescriptorSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...subjectRequired, 'interpretation', 'candidates'],
  properties: {
    ...subjectProperties,
    interpretation: { const: 'none' },
    candidates: { type: 'array', items: detectionResultSchema },
  },
} as const

const resolvedAssetDescriptorSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...subjectRequired, 'interpretation', 'identity', 'metadata'],
  properties: {
    ...subjectProperties,
    interpretation: { const: 'codec' },
    identity: resolvedIdentitySchema,
    metadata: { type: 'array', items: metadataGroupSchema },
    companions: { type: 'array', items: companionDescriptorSchema },
  },
} as const

/**
 * Single wire authority for both persistent descriptor-v2 states. The exact wire remains
 * provisional until A-5, but every object is already closed against implementation bindings.
 */
export const subjectDescriptorV2Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/subject-descriptor.v2.schema.json',
  $defs: { jsonValue: jsonValueSchema },
  oneOf: [unresolvedSourceDescriptorSchema, resolvedAssetDescriptorSchema],
} as const

/**
 * Type-inference adapter for json-schema-to-ts, which cannot recurse through `$ref` cycles.
 * It is derived from the wire authority and replaces only the recursive JSON-value definition;
 * schema-drift deserializes that marker back to the public `JsonValue` type.
 */
export const subjectDescriptorV2InferenceSchema = {
  ...subjectDescriptorV2Schema,
  $defs: {
    ...subjectDescriptorV2Schema.$defs,
    jsonValue: { title: 'JsonValue' },
  },
} as const

/** Name the union explicitly for consumers that work with `AnyDescriptor`. */
export const anyDescriptorV2Schema = subjectDescriptorV2Schema

deepFreeze(subjectDescriptorV2Schema)
deepFreeze(subjectDescriptorV2InferenceSchema)
