import { readFileSync } from 'node:fs'
import type { AnyDescriptor, AssetOperationDescriptor, MetadataGroup } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import {
  base64OfUtf8,
  declaredMutatingOperations,
  editOffer,
  invokeRefusalMessage,
  metadataEntries,
} from '../src/edit-operations.js'

const manifests = {
  png: new URL('../../../extensions/images/contributions/codec-png.json', import.meta.url),
  mp3: new URL('../../../extensions/audio/contributions/codec-mp3.json', import.meta.url),
  jpeg: new URL('../../../extensions/images/contributions/codec-jpeg.json', import.meta.url),
  zip: new URL('../../../extensions/archives/contributions/codec-zip.json', import.meta.url),
}

function operations(name: keyof typeof manifests): readonly AssetOperationDescriptor[] {
  const parsed = JSON.parse(readFileSync(manifests[name], 'utf8')) as {
    spec: { operations: readonly Omit<AssetOperationDescriptor, 'state'>[] }
  }
  return parsed.spec.operations.map(operation => ({
    ...operation,
    state: 'available',
    reason: undefined,
  })) as unknown as readonly AssetOperationDescriptor[]
}

function descriptor(name: keyof typeof manifests): AnyDescriptor {
  const group =
    name === 'png'
      ? { id: 'png-text', label: 'Text', entries: [editable('Description', 'old')] }
      : name === 'mp3'
        ? { id: 'id3', label: 'ID3', entries: [editable('TIT2', 'old')] }
        : name === 'jpeg'
          ? { id: 'jpeg-comment', label: 'Comment', entries: [editable('comment', 'old')] }
          : undefined
  return {
    schemaVersion: 2,
    subjectUri: `file:///${name}`,
    interpretation: 'codec',
    identity: {} as never,
    origin: {} as never,
    traits: [],
    operations: operations(name),
    constraints: {} as never,
    dataSources: [],
    diagnostics: [],
    revision: 'sha256:test' as never,
    metadata: group === undefined ? [] : [group],
  } as unknown as AnyDescriptor
}

function editable(key: string, value: string) {
  return {
    key,
    value,
    type: { kind: 'text' as const },
    editable: { write: { operation: 'edit.field' as const } },
  }
}

describe('shared schema-driven edit forms in the PWA', () => {
  it('discovers all eight shipped forms from operation input schemas', () => {
    expect(
      (['png', 'mp3', 'jpeg', 'zip'] as const).flatMap(name =>
        editOffer(descriptor(name), { editable: true }).forms.map(form => form.id),
      ),
    ).toEqual([
      'png-set-text',
      'mp3-set-text-frame',
      'jpeg-set-comment',
      'jpeg-remove-segment',
      'zip-add-entry',
      'zip-remove-entry',
      'zip-rename-entry',
      'zip-replace-entry',
    ])
  })

  it('builds FieldWriteRequest inputs and nested archive inputs generically', () => {
    const png = editOffer(descriptor('png'), { editable: true }).forms[0]
    expect(
      png?.build(
        new Map([
          ['key', 'Title'],
          ['value', 'hello'],
        ]),
      ),
    ).toEqual({
      groupId: 'png-text',
      key: 'Title',
      value: 'hello',
    })
    const zip = editOffer(descriptor('zip'), { editable: true }).forms
    expect(
      zip[0]?.build(
        new Map([
          ['path', 'a.txt'],
          ['content', '✓'],
        ]),
      ),
    ).toEqual({
      add: [{ path: 'a.txt', bytes: base64OfUtf8('✓') }],
    })
    expect(zip[1]?.build(new Map([['path', 'a.txt']]))).toEqual({ remove: ['a.txt'] })
    expect(
      zip[2]?.build(
        new Map([
          ['from', 'a'],
          ['to', 'b'],
        ]),
      ),
    ).toEqual({
      rename: [{ from: 'a', to: 'b' }],
    })
  })

  it('fails closed without a published schema or editable descriptor binding', () => {
    const subject = descriptor('png') as unknown as {
      operations: unknown[]
      metadata: MetadataGroup[]
    }
    subject.operations = [
      { id: 'edit.field', handlerId: 'private', mutatesSource: true, state: 'available' },
    ]
    expect(
      editOffer(subject as unknown as AnyDescriptor, { editable: true }).unsupported[0]?.reason,
    ).toBe('the operation did not publish an input schema')
    const png = descriptor('png') as unknown as { metadata: MetadataGroup[] }
    png.metadata = []
    expect(editOffer(png as unknown as AnyDescriptor, { editable: true }).forms).toEqual([])
  })

  it('retains shared descriptor and refusal helpers', () => {
    const subject = descriptor('zip')
    expect(declaredMutatingOperations(subject)).toHaveLength(2)
    expect(metadataEntries(descriptor('png'), 'png-text')[0]?.value).toBe('old')
    expect(invokeRefusalMessage({ reason: 'permission-missing' })).toContain('permission-missing')
  })
})
