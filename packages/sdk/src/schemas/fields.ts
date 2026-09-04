/** Closed JSON Schema authority for field metadata, edit requests and subject kinds. */
import { deepFreeze } from '@modkit/core'
import {
  jsonSchemaRefSchema,
  knowledgeTargetSchema,
  writerRequirementSchema,
} from './contribution-specs.js'
import { extensionAssetReferenceSchema } from './extension-manifest.js'
import { OPERATION_PATTERN } from './patterns.js'

const text = { type: 'string' } as const
const id = { type: 'string', minLength: 1 } as const
const strings = { type: 'array', items: id } as const
const boolean = { type: 'boolean' } as const
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const
const json = { $ref: '#/$defs/jsonValue' } as const
const field = { $ref: '#/$defs/fieldType' } as const
const member = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id, label: text },
} as const
const members = { type: 'array', items: member } as const

export const subjectFilterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: id,
    sameTypeAs: id,
    text,
    requireTags: strings,
    excludeTags: strings,
    predicate: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id, params: json },
    },
  },
} as const

export const fieldSchemaValueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'label', 'type'],
  properties: {
    key: id,
    label: text,
    type: field,
    cardinality: { enum: ['scalar', 'append', 'indexed'] },
    description: text,
    knowledgeTarget: knowledgeTargetSchema,
  },
} as const

export const fieldTypeValueSchema = {
  title: 'FieldType',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'text' }, multiline: boolean, pattern: text, maxLength: count },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { const: 'number' },
        min: { type: 'number' },
        max: { type: 'number' },
        integer: boolean,
        unit: text,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'boolean' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'members'],
      properties: { kind: { const: 'enum' }, members, unknown: text },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'members'],
      properties: { kind: { const: 'flags' }, members },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'model'],
      properties: { kind: { const: 'color' }, model: { enum: ['rgb', 'rgba', 'argb'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'size'],
      properties: { kind: { const: 'vector' }, size: { enum: [2, 3, 4] }, unit: text },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { enum: ['duration', 'date', 'bytes', 'id', 'path'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'text-key' }, catalog: id },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'subjectKind'],
      properties: { kind: { const: 'subject-ref' }, subjectKind: id, filter: subjectFilterSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'accepts'],
      properties: {
        kind: { const: 'asset-ref' },
        accepts: {
          type: 'object',
          additionalProperties: false,
          properties: { formatIds: strings, traits: strings },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'language'],
      properties: { kind: { const: 'script' }, language: id },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'fields'],
      properties: {
        kind: { const: 'struct' },
        fields: { type: 'array', items: fieldSchemaValueSchema },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'item'],
      properties: { kind: { const: 'array' }, item: field, max: count },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'key', 'value'],
      properties: { kind: { const: 'record' }, key: field, value: field },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'keywords', 'delimiter'],
      properties: {
        kind: { const: 'instructions' },
        keywords: { type: 'object', additionalProperties: { type: 'array', items: field } },
        delimiter: text,
        listDelimiter: text,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'json' }, schema: jsonSchemaRefSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'typeId'],
      properties: { kind: { const: 'custom' }, typeId: id, params: json },
    },
  ],
} as const

export const fieldSchemaDefinitions = {
  jsonValue: {
    title: 'JsonValue',
    oneOf: [
      { type: 'null' },
      boolean,
      { type: 'number' },
      text,
      { type: 'array', items: json },
      { type: 'object', additionalProperties: json },
    ],
  },
  fieldType: fieldTypeValueSchema,
} as const

export const fieldEditableValueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['write'],
  properties: {
    editor: id,
    readonlyReason: text,
    write: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['operation'],
          properties: { operation: { type: 'string', pattern: OPERATION_PATTERN } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['writer'],
          properties: { writer: writerRequirementSchema },
        },
      ],
    },
  },
} as const

export const fieldTypeV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/field-type.v1.schema.json',
  $defs: fieldSchemaDefinitions,
  ...field,
} as const
export const fieldSchemaV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/field-schema.v1.schema.json',
  $defs: fieldSchemaDefinitions,
  ...fieldSchemaValueSchema,
} as const
export const fieldWriteRequestV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/field-write-request.v1.schema.json',
  $defs: fieldSchemaDefinitions,
  type: 'object',
  additionalProperties: false,
  required: ['groupId', 'key', 'value'],
  properties: { groupId: id, key: id, path: { type: 'array', items: text }, value: json },
} as const
export const subjectKindDefinitionSpecV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/subject-kind-definition-spec.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['kindId', 'label'],
  properties: {
    kindId: id,
    label: text,
    icon: extensionAssetReferenceSchema,
    parentKinds: strings,
    card: {
      type: 'object',
      additionalProperties: false,
      required: ['sections'],
      properties: { sections: strings, preview: { enum: ['raster', 'model', 'none'] } },
    },
    selector: {
      type: 'object',
      additionalProperties: false,
      required: ['facets', 'predicates'],
      properties: {
        facets: strings,
        predicates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label'],
            properties: { id, label: text, params: jsonSchemaRefSchema },
          },
        },
      },
    },
    diff: {
      type: 'object',
      additionalProperties: false,
      required: ['profile'],
      properties: { profile: { enum: ['generic', 'provider'] } },
    },
    knowledgeEcosystem: id,
  },
} as const

deepFreeze(fieldTypeV1Schema)
deepFreeze(fieldSchemaV1Schema)
deepFreeze(fieldWriteRequestV1Schema)
deepFreeze(subjectKindDefinitionSpecV1Schema)
