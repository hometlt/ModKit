import { describe, expect, it } from 'vitest'
import { operationId } from '@modkit/core'
import type {
  FieldType,
  FieldWriteRequest,
  SubjectKindDefinitionSpecV1,
} from '../src/fields/index.js'
import {
  fieldTypeV1Schema,
  fieldSchemaV1Schema,
  fieldWriteRequestV1Schema,
  subjectKindDefinitionSpecV1Schema,
} from '../src/schemas/fields.js'
import { validateWithSchema } from '../src/manifest/validate.js'
import { createSpecSchemaRegistry } from '../src/manifest/spec-registry.js'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  SUBJECT_KIND_DEFINITION_CONTRIBUTION_CONTRACT,
} from '../src/manifest/contribution-contract-registry.js'
import { validateContributionManifest } from '../src/manifest/spec-registry.js'
import { validateSubjectDescriptorV2 } from '../src/asset-capabilities/validate-descriptor.js'
import type { ResolvedAssetDescriptorWire } from '../src/asset-capabilities/types.js'

const types = [
  { kind: 'text', multiline: true, pattern: '.*', maxLength: 20 },
  { kind: 'number', min: -1, max: 5, integer: true, unit: 'm' },
  { kind: 'boolean' },
  { kind: 'enum', members: [{ id: 'a', label: 'A' }], unknown: 'preserve' },
  { kind: 'flags', members: [{ id: 'a' }] },
  { kind: 'color', model: 'rgba' },
  { kind: 'vector', size: 3, unit: 'm' },
  { kind: 'duration' },
  { kind: 'date' },
  { kind: 'bytes' },
  { kind: 'id' },
  { kind: 'path' },
  { kind: 'text-key', catalog: 'strings' },
  {
    kind: 'subject-ref',
    subjectKind: 'entity',
    filter: {
      sameTypeAs: 'selected',
      requireTags: ['unit'],
      excludeTags: ['default'],
      predicate: { id: 'buildable', params: { level: 1 } },
    },
  },
  { kind: 'asset-ref', accepts: { formatIds: ['dds'], traits: ['image.raster'] } },
  { kind: 'script', language: 'galaxy' },
  { kind: 'struct', fields: [{ key: 'a', label: 'A', type: { kind: 'boolean' } }] },
  { kind: 'array', item: { kind: 'array', item: { kind: 'text' } }, max: 3 },
  { kind: 'record', key: { kind: 'id' }, value: { kind: 'struct', fields: [] } },
  {
    kind: 'instructions',
    keywords: { move: [{ kind: 'vector', size: 2 }] },
    delimiter: ';',
    listDelimiter: ',',
  },
  { kind: 'json', schema: { $ref: 'example/value' } },
  { kind: 'custom', typeId: 'example/temperature', params: { scale: 'celsius', aliases: [null] } },
] as const satisfies readonly FieldType[]

const descriptor: ResolvedAssetDescriptorWire = {
  schemaVersion: 2,
  subjectUri: 'memory://fields/sample',
  revision: 'content-hash.sha256:sample',
  origin: {
    kind: 'single',
    binding: {
      id: 'content',
      role: 'content',
      source: { id: 'sample', uri: 'memory://fields/sample' },
      required: true,
      ownership: 'owned',
      revision: 'content-hash.sha256:sample',
    },
  },
  interpretation: 'codec',
  identity: {
    codecId: 'example/fields',
    codecVersion: '1.0.0',
    formatId: 'fields',
    formatLabel: 'Fields',
    confidence: 1,
    detection: [],
  },
  constraints: { readOnly: false, seekable: true, randomAccess: true, trusted: false },
  diagnostics: [],
  traits: [],
  dataSources: [],
  operations: [
    { id: 'edit.field', handlerId: 'editField', state: 'available', mutatesSource: true },
  ],
  metadata: [
    {
      id: 'properties',
      label: 'Properties',
      order: 1,
      entries: [
        {
          key: 'count',
          value: 3,
          type: { kind: 'number' },
          unit: 'items',
          editable: { write: { operation: 'edit.field' } },
          provenance: [{ label: 'File', range: { byteOffset: '0', byteLength: '2' } }],
          knowledgeTarget: { kind: 'concept', ecosystem: 'example', conceptId: 'count' },
        },
      ],
    },
  ],
}

describe('field contracts', () => {
  it.each(types)('validates $kind and rejects extra wire properties', async type => {
    expect(await validateWithSchema(fieldTypeV1Schema, type)).toEqual([])
    expect(await validateWithSchema(fieldTypeV1Schema, { ...type, runtime: 'hidden' })).not.toEqual(
      [],
    )
    expect(
      await validateWithSchema(fieldSchemaV1Schema, { key: 'value', label: 'Value', type }),
    ).toEqual([])
  })

  it.each([
    { kind: 'color', model: 'hsv' },
    { kind: 'vector', size: 5 },
    { kind: 'text', maxLength: -1 },
    { kind: 'array', item: { kind: 'unknown' } },
    { kind: 'enum', members: [{ label: 'no id' }] },
    { kind: 'subject-ref', subjectKind: 'entity', filter: { predicate: { params: {} } } },
    { kind: 'record', key: { kind: 'id' } },
    { kind: 'struct', fields: [{ key: 'a' }] },
    { kind: 'instructions', keywords: { move: [{ kind: 'vector', size: 9 }] }, delimiter: ';' },
  ])('rejects malformed nested field %#', async value => {
    expect(await validateWithSchema(fieldTypeV1Schema, value)).not.toEqual([])
  })

  it('keeps null a valid explicit write and rejects missing values', async () => {
    const request: FieldWriteRequest = {
      groupId: 'properties',
      key: 'value',
      path: ['a'],
      value: null,
    }
    expect(await validateWithSchema(fieldWriteRequestV1Schema, request)).toEqual([])
    expect(
      await validateWithSchema(fieldWriteRequestV1Schema, { groupId: 'properties', key: 'value' }),
    ).not.toEqual([])
  })

  it('accepts typed metadata, brands writes and preserves provenance', async () => {
    const result = await validateSubjectDescriptorV2(descriptor)
    expect(result.diagnostics).toEqual([])
    expect(result.descriptor).toEqual(descriptor)
    expect(operationId('subject.compare', { contributionId: 'example/fields' })).toBe(
      'subject.compare',
    )
    expect(operationId('subject.select', { contributionId: 'example/fields' })).toBe(
      'subject.select',
    )
  })

  it('rejects a field referring to an undeclared write handler', async () => {
    const result = await validateSubjectDescriptorV2({ ...descriptor, operations: [] })
    expect(result.descriptor).toBeUndefined()
    expect(
      result.diagnostics.some(item => item.code === 'x3.sdk/invalid-field-write-operation'),
    ).toBe(true)
  })

  it('registers subject kinds as data-only and checks semantic duplicates', async () => {
    const spec: SubjectKindDefinitionSpecV1 = {
      kindId: 'entity',
      label: 'Entity',
      icon: { path: 'icons/entity.svg' },
      card: { sections: ['properties'], preview: 'none' },
      selector: { facets: ['type'], predicates: [{ id: 'buildable', label: 'Buildable' }] },
    }
    expect(await validateWithSchema(subjectKindDefinitionSpecV1Schema, spec)).toEqual([])
    const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)
    const manifest = {
      schemaVersion: 1,
      contract: { id: SUBJECT_KIND_DEFINITION_CONTRIBUTION_CONTRACT, major: 1 },
      id: 'example/entity',
      displayName: 'Entity',
      spec,
    }
    expect((await validateContributionManifest(manifest, registry)).specState).toBe('validated')
    const invalid = await validateContributionManifest(
      { ...manifest, spec: { ...spec, parentKinds: ['entity'] } },
      registry,
    )
    expect(invalid.specState).toBe('invalid')
    expect(invalid.inventoryEligible).toBe(false)
    expect(invalid.diagnostics.some(item => item.code === 'x3.sdk/subject-kind-self-parent')).toBe(
      true,
    )
    expect(
      await validateWithSchema(subjectKindDefinitionSpecV1Schema, {
        ...spec,
        icon: { path: '../outside.svg' },
      }),
    ).not.toEqual([])
  })
})
