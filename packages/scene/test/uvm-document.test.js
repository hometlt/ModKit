import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { it } from 'node:test'
import { openUvmDocument } from '../src/uvm/document.js'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  readUvmContainer,
  writeUvmContainer,
} from '@modkit/uv/model/container'
import {
  attachUvmFormatResidual,
  readUvmFormatResidual,
} from '@modkit/uv/model/format-residual'

const document = {
  asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
  nodes: [{ name: 'original', extras: { future: { 'a/b~c': [1, 2] } } }],
  buffers: [{ byteLength: 4 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
  extensionsUsed: ['UV_asset', 'UV_provenance', 'VENDOR_future'],
  extensions: {
    UV_asset: { id: 'fixture', class: 'model' },
    UV_provenance: { source: { format: 'm3' }, importer: { id: 'fixture', version: '1' } },
    VENDOR_future: { token: [null, 19, 'unknown'] },
  },
  extras: { BlizzardM3: { schemaVersion: 1, opaque: { flags: 0xdeadbeef } } },
}
const fixture = () =>
  writeUvmContainer({
    format: 'glb',
    document,
    binary: Uint8Array.from([1, 2, 3, 4]),
    extraChunks: [{ type: 0x12345678, bytes: Uint8Array.from([7, 8, 9, 10]) }],
  })
const rename = (expectedRevision, name) => ({
  expectedRevision,
  json: [{ op: 'replace', path: '/nodes/0/name', value: name }],
})

it('attaches a bounded format residual without embedding native source bytes', () => {
  const base = readUvmContainer(fixture())
  const clean = {
    ...base,
    document: { ...base.document, extras: {} },
  }
  const attached = attachUvmFormatResidual(clean, {
    namespace: 'BlizzardM3',
    format: 'm3',
    profile: 'portable-scene-v1',
    residual: { mdVersion: 34, flags: [3] },
    mapping: { nodes: { 'bone/0': 0 } },
  })
  assert.equal(attached.document.extensions.UV_source_blob, undefined)
  assert.deepEqual(readUvmFormatResidual(attached, 'BlizzardM3'), {
    format: 'm3',
    profile: 'portable-scene-v1',
    residual: { flags: [3], mdVersion: 34 },
    mapping: { nodes: { 'bone/0': 0 } },
  })
  assert.equal(attached.binary.length, clean.binary.length)
})

it('reads Buffer slices without rewriting the source header or aliasing BIN and opaque chunks', () => {
  const original = fixture()
  const storage = Buffer.concat([Buffer.from([99]), Buffer.from(original), Buffer.from([88])])
  const input = storage.subarray(1, -1)
  const decoded = readUvmContainer(input)
  assert.deepEqual(Uint8Array.from(input), original)
  decoded.binary.fill(0)
  decoded.extraChunks[0].bytes.fill(0)
  assert.deepEqual(Uint8Array.from(input), original)
  const fresh = readUvmContainer(input)
  input.fill(0)
  assert.deepEqual(fresh.binary, Uint8Array.of(1, 2, 3, 4))
  assert.deepEqual(fresh.extraChunks[0].bytes, Uint8Array.of(7, 8, 9, 10))
})

it('preserves complete JSON, binary and opaque chunks through edits and exact undo', () => {
  const original = fixture()
  const session = openUvmDocument(original)
  assert.deepEqual(session.serialize(0), original)
  const state = session.apply({
    ...rename(0, 'edited'),
    binary: [{ byteOffset: 1, bytes: Uint8Array.of(60) }],
  })
  assert.equal(state.revision, 1)
  assert.equal(state.modified, true)
  const reopened = readUvmContainer(session.serialize(1))
  assert.equal(reopened.document.nodes[0].name, 'edited')
  assert.deepEqual(reopened.document.extras.BlizzardM3, document.extras.BlizzardM3)
  assert.deepEqual(reopened.document.extensions.VENDOR_future, document.extensions.VENDOR_future)
  assert.deepEqual(reopened.binary, Uint8Array.from([1, 60, 3, 4]))
  assert.deepEqual(reopened.extraChunks, readUvmContainer(original).extraChunks)
  assert.equal(session.undo(1).modified, false)
  assert.deepEqual(session.serialize(2), original)
  assert.equal(session.redo(2).modified, true)
  assert.deepEqual(session.serialize(3), writeUvmContainer(reopened))
})

it('owns input bytes, exposed byte views and edit payloads', () => {
  const original = fixture()
  const expected = original.slice()
  const session = openUvmDocument(original)
  original.fill(0)
  session.snapshot().binary.fill(0)
  session.snapshot().extraChunks[0].bytes.fill(0)
  session.serialize(0).fill(0)
  assert.deepEqual(session.serialize(0), expected)
  assert.throws(() => {
    session.snapshot().document.nodes[0].name = 'leak'
  }, TypeError)
  const value = { nested: [1] }
  const bytes = Uint8Array.of(99)
  session.apply({
    expectedRevision: 0,
    json: [{ op: 'add', path: '/extras/new', value }],
    binary: [{ byteOffset: 0, bytes }],
  })
  value.nested[0] = 10
  bytes[0] = 0
  assert.deepEqual(session.snapshot().document.extras.new, { nested: [1] })
  assert.equal(session.snapshot().binary[0], 99)
})

it('rejects stale revisions before building bytes and has no ABA after undo', () => {
  const session = openUvmDocument(fixture())
  session.apply(rename(0, 'one'))
  let read = false
  assert.throws(
    () =>
      session.apply({
        expectedRevision: 0,
        get binary() {
          read = true
          throw Error('read')
        },
      }),
    /stale/,
  )
  assert.equal(read, false)
  assert.throws(() => session.serialize(0), /stale/)
  session.undo(1)
  assert.throws(() => session.apply(rename(0, 'old revision')), /stale/)
  session.apply(rename(2, 'branch'))
  assert.equal(session.status().canRedo, false)
  assert.equal(session.snapshot().document.nodes[0].name, 'branch')
})

it('a failed batch, invalid root or overlapping binary writes leaves history untouched', () => {
  const session = openUvmDocument(fixture())
  const before = session.serialize(0)
  for (const edit of [
    {
      expectedRevision: 0,
      json: [...rename(0, 'lost').json, { op: 'replace', path: '/missing/name', value: 'x' }],
    },
    { expectedRevision: 0, json: [{ op: 'replace', path: '', value: [] }] },
    { expectedRevision: 0, json: [{ op: 'remove', path: '/asset' }] },
    { expectedRevision: 0, binary: [{ byteOffset: 3, bytes: Uint8Array.of(1, 2) }] },
    {
      expectedRevision: 0,
      binary: [
        { byteOffset: 0, bytes: Uint8Array.of(1, 2) },
        { byteOffset: 1, bytes: Uint8Array.of(3) },
      ],
    },
  ])
    assert.throws(() => session.apply(edit))
  assert.equal(session.status().revision, 0)
  assert.equal(session.status().canUndo, false)
  assert.deepEqual(session.serialize(0), before)
})

it('handles escaped pointer keys, array insertion and prototype-looking keys as data', () => {
  const session = openUvmDocument(fixture())
  session.apply({
    expectedRevision: 0,
    json: [
      { op: 'add', path: '/nodes/0/extras/future/a~1b~0c/1', value: 3 },
      { op: 'add', path: '/nodes/0/extras/future/a~1b~0c/-', value: 4 },
      { op: 'remove', path: '/nodes/0/extras/future/a~1b~0c/0' },
      { op: 'add', path: '/extras/__proto__', value: { polluted: true } },
    ],
  })
  assert.deepEqual(session.snapshot().document.nodes[0].extras.future['a/b~c'], [3, 2, 4])
  assert.equal(Object.hasOwn(session.snapshot().document.extras, '__proto__'), true)
  assert.equal({}.polluted, undefined)
  for (const path of ['/nodes/01/name', '/nodes/-/name', '/nodes/0/~2', '/constructor/prototype/x'])
    assert.throws(() =>
      session.apply({ expectedRevision: 1, json: [{ op: 'add', path, value: 1 }] }),
    )
})

it('bounds retained history, evicts old states and releases a disposed document', () => {
  const session = openUvmDocument(fixture(), { maxHistoryEntries: 1 })
  session.apply(rename(0, 'one'))
  session.apply(rename(1, 'two'))
  session.undo(2)
  assert.equal(session.snapshot().document.nodes[0].name, 'one')
  assert.equal(session.status().canUndo, false)
  session.redo(3)
  session.dispose()
  session.dispose()
  for (const run of [
    () => session.status(),
    () => session.snapshot(),
    () => session.serialize(4),
    () => session.undo(4),
  ])
    assert.throws(run, /disposed/)
  assert.throws(() => openUvmDocument(fixture(), { maxHistoryBytes: 1 }), /maxHistoryBytes/)
  const bounded = openUvmDocument(fixture(), { maxEdits: 0 })
  assert.throws(() => bounded.apply(rename(0, 'x')), /maxEdits/)
})

it('cancelled operations and semantic validation failures do not install changes', () => {
  const abort = new AbortController()
  const session = openUvmDocument(fixture(), {
    signal: abort.signal,
    validate(value) {
      value.binary.fill(0) // validator has no mutable access to stored bytes
      if (value.document.nodes[0].name === 'invalid') throw new TypeError('invalid model name')
    },
  })
  assert.throws(() => session.apply(rename(0, 'invalid')), /invalid model name/)
  assert.deepEqual(session.snapshot().binary, Uint8Array.from([1, 2, 3, 4]))
  assert.equal(session.status().revision, 0)
  abort.abort()
  assert.throws(() => session.apply(rename(0, 'x')), { name: 'AbortError' })
})

it('rechecks the revision after a reentrant validation callback', () => {
  let session
  let reenter = false
  session = openUvmDocument(fixture(), {
    validate() {
      if (reenter) {
        reenter = false
        session.apply(rename(0, 'inner'))
      }
    },
  })
  reenter = true
  assert.throws(() => session.apply(rename(0, 'outer')), /stale/)
  assert.equal(session.snapshot().document.nodes[0].name, 'inner')
  assert.equal(session.status().revision, 1)
})

it('preserves authored JSON glTF formatting until edited and after undo', () => {
  const bytes = new TextEncoder().encode(
    ' { "asset": {"version":"2.0"}, "extras": {"unknown":42} }\n',
  )
  const session = openUvmDocument(bytes)
  assert.deepEqual(session.serialize(0), bytes)
  session.apply({ expectedRevision: 0, json: [{ op: 'add', path: '/extras/new', value: 'a' }] })
  const reopened = readUvmContainer(session.serialize(1))
  assert.equal(reopened.format, 'gltf')
  assert.equal(reopened.document.extras.unknown, 42)
  session.undo(1)
  assert.deepEqual(session.serialize(2), bytes)
})

it('refuses malformed chunk order, sizes, duplicates and container budgets', () => {
  const bytes = fixture()
  const invalidLength = bytes.slice()
  new DataView(invalidLength.buffer).setUint32(8, bytes.length + 4, true)
  assert.throws(() => readUvmContainer(invalidLength), /declared length/)
  const invalidOrder = bytes.slice()
  new DataView(invalidOrder.buffer).setUint32(16, 0x004e4942, true)
  assert.throws(() => readUvmContainer(invalidOrder), /must be first/)
  const duplicateBin = bytes.slice()
  new DataView(duplicateBin.buffer).setUint32(bytes.length - 8, 0x004e4942, true)
  assert.throws(() => readUvmContainer(duplicateBin), /second and unique/)
  assert.throws(
    () => readUvmContainer(bytes, { ...DEFAULT_UVM_CONTAINER_BUDGET, maxInputBytes: 1 }),
    /maxInputBytes/,
  )
  assert.throws(
    () => readUvmContainer(bytes, { ...DEFAULT_UVM_CONTAINER_BUDGET, maxJsonBytes: 1 }),
    /maxJsonBytes/,
  )
  assert.throws(
    () =>
      writeUvmContainer(readUvmContainer(bytes), {
        ...DEFAULT_UVM_CONTAINER_BUDGET,
        maxInputBytes: 1,
      }),
    /maxInputBytes/,
  )
})
