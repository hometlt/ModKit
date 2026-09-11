import { expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { openUvmDocument, type UvmDocument } from '../../scene/src/uvm/document.js'
import {
  readUvmContainer,
  writeUvmContainer,
  type UvmContainer,
} from '../../uv/src/model/container.js'

function container(bytes = new Uint8Array([1, 2, 3, 4])): UvmContainer {
  return {
    format: 'glb',
    document: {
      asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
      buffers: [{ byteLength: bytes.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bytes.length }],
      extensionsUsed: ['UV_asset', 'UV_provenance'],
      extensions: {
        UV_asset: { id: 'document-fixture', class: 'model' },
        UV_provenance: { source: { format: 'fixture' }, importer: { id: 'test', version: '1' } },
      },
      extras: { marker: 'initial' },
    },
    binary: bytes,
    extraChunks: [{ type: 0x12345678, bytes: new Uint8Array([9, 8, 7, 6]) }],
  }
}
function marker(source: UvmContainer): unknown {
  const extras = source.document['extras']
  return extras !== null && typeof extras === 'object' && !Array.isArray(extras)
    ? (extras as JsonObject)['marker']
    : undefined
}
function needed<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('test document is unavailable')
  return value
}

it('commits owned appended storage into the existing history and restores exact original bytes', () => {
  const original = writeUvmContainer(container())
  const document = openUvmDocument(original)
  const next = container(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  const nextJson = { ...next.document, extras: { marker: 'attached' } }
  const result = document.replace({
    expectedRevision: 0,
    container: { ...next, document: nextJson },
  })
  expect(result).toMatchObject({ revision: 1, modified: true, canUndo: true, canRedo: false })
  next.binary.fill(99)
  needed(next.extraChunks[0]).bytes.fill(99)
  nextJson.extras.marker = 'mutated'
  const snapshot = document.snapshot()
  expect(snapshot.binary).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  expect(needed(snapshot.extraChunks[0]).bytes).toEqual(new Uint8Array([9, 8, 7, 6]))
  expect(marker(snapshot)).toBe('attached')
  snapshot.binary.fill(0)
  const attached = document.serialize(1)
  expect(readUvmContainer(attached).binary).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  expect(document.undo(1)).toMatchObject({ revision: 2, modified: false, canRedo: true })
  expect(document.serialize(2)).toEqual(original)
  expect(document.redo(2).revision).toBe(3)
  expect(document.serialize(3)).toEqual(attached)
  document.dispose()
})

it('refuses stale or invalid replacements without changing revision, redo or retained bytes', () => {
  let validations = 0
  const document = openUvmDocument(writeUvmContainer(container()), {
    validate: () => {
      validations++
    },
  })
  document.apply({
    expectedRevision: 0,
    json: [{ op: 'replace', path: '/extras/marker', value: 'edited' }],
  })
  document.undo(1)
  const before = document.status(),
    bytes = document.serialize(2),
    count = validations
  expect(() => document.replace({ expectedRevision: 0, container: container() })).toThrow('stale')
  expect(validations).toBe(count)
  expect(() =>
    document.replace({
      expectedRevision: 2,
      container: { ...container(), document: { asset: { version: '1.0' } } },
    }),
  ).toThrow('2.0')
  expect(document.status()).toEqual(before)
  expect(document.serialize(2)).toEqual(bytes)
  expect(document.redo(2).revision).toBe(3)
  document.dispose()
})

it('shares bounded history with JSON edits and rejects oversized candidates atomically', () => {
  const document = openUvmDocument(writeUvmContainer(container()), {
    maxHistoryEntries: 1,
    maxHistoryBytes: 4096,
  })
  document.replace({ expectedRevision: 0, container: container(new Uint8Array(12)) })
  document.apply({
    expectedRevision: 1,
    json: [{ op: 'replace', path: '/extras/marker', value: 'third' }],
  })
  const before = document.status()
  expect(() =>
    document.replace({
      expectedRevision: 2,
      container: {
        ...container(),
        document: { ...container().document, extras: { large: 'x'.repeat(5000) } },
      },
    }),
  ).toThrow('maxHistoryBytes')
  expect(document.status()).toEqual(before)
  document.undo(2)
  expect(document.snapshot().binary.length).toBe(12)
  expect(document.status().canUndo).toBe(false)
  document.dispose()
})

it('captures revision before a reentrant validator can mutate the replacement request', () => {
  const replacement = {
    expectedRevision: 0,
    container: {
      ...container(),
      document: { ...container().document, extras: { marker: 'outer' } },
    },
  }
  const document: UvmDocument = openUvmDocument(writeUvmContainer(container()), {
    validate(candidate) {
      if (marker(candidate) !== 'outer') return
      const current = needed(document)
      current.apply({
        expectedRevision: 0,
        json: [{ op: 'replace', path: '/extras/marker', value: 'inner' }],
      })
      replacement.expectedRevision = current.status().revision
    },
  })
  expect(() => needed(document).replace(replacement)).toThrow('stale')
  expect(document.status().revision).toBe(1)
  expect(marker(document.snapshot())).toBe('inner')
  document.undo(1)
  expect(marker(document.snapshot())).toBe('initial')
  document.dispose()
})

it('refuses a replacement when validation disposes the document', () => {
  const document: UvmDocument = openUvmDocument(writeUvmContainer(container()), {
    validate(candidate) {
      if (marker(candidate) === 'dispose') needed(document).dispose()
    },
  })
  expect(() =>
    needed(document).replace({
      expectedRevision: 0,
      container: {
        ...container(),
        document: { ...container().document, extras: { marker: 'dispose' } },
      },
    }),
  ).toThrow('disposed')
  expect(() => needed(document).status()).toThrow('disposed')
})
