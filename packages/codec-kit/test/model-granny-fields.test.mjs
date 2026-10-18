/** Ordered native metadata shares schema/value parsing and refuses legacy keyed data loss. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGrannyPackedReader, readGrannyVariant } from '../dist/model/granny.js'

const limits = { maxBytes: 1 << 20, maxNodes: 1000, maxDepth: 16 }
/** Native44-byte descriptors: duplicate scalar names, optionally behind a nested member kind. */
function fixture(kind = 0) {
  const bytes = new Uint8Array(4096), v = new DataView(bytes.buffer)
  const text = (at, value) => bytes.set(new TextEncoder().encode(value + '\0'), at)
  const ptr = (at, target) => v.setBigUint64(at, BigInt(target), true)
  const member = (at, type, name, nested = 0) => {
    v.setUint32(at, type, true); ptr(at + 4, name); ptr(at + 12, nested)
  }
  text(2800, 'Nested'); text(2900, 'Repeated'); text(3000, 'Other')
  const schema = kind ? 512 : 32, data = kind ? 1200 : 1024
  member(schema, 10, 2900); member(schema + 44, 10, 2900)
  ;[1.25, 2.5, 3.5, 4.5].forEach((x, i) => v.setFloat32(data + i * 4, x, true))
  if (kind) {
    member(32, kind, 2800, [1, 2, 3, 4].includes(kind) ? 512 : 0)
    if (kind === 1) { v.setFloat32(1024, 1.25, true); v.setFloat32(1028, 2.5, true) }
    if (kind === 2) ptr(1024, 1200)
    if ([3, 4].includes(kind)) {
      v.setUint32(1024, 2, true); ptr(1028, kind === 4 ? 1400 : 1200)
      ptr(1400, 1200); ptr(1408, 1200)
    }
    if (kind === 5) { ptr(1024, 512); ptr(1032, 1200) }
    if (kind === 7) { ptr(1024, 512); v.setUint32(1032, 2, true); ptr(1036, 1200) }
  }
  return bytes
}
const reader = bytes => createGrannyPackedReader(bytes, 'packed-le64', limits)
const pairs = struct => struct.members.map(m => [m.name, m.value])

test('ordered roots retain repeated names and values; default standalone/session views refuse', () => {
  const bytes = fixture(), session = reader(bytes), fields = session.variantFields(32, 1024)
  assert.equal(fields.kind, 'struct'); assert.deepEqual(pairs(fields), [['Repeated', 1.25], ['Repeated', 2.5]])
  assert.equal(session.variantFields(32, 1024), fields)
  assert.throws(() => session.variant(32, 1024), /duplicate/)
  assert.throws(() => session.pointer(0), /closed/)
  assert.throws(() => readGrannyVariant(bytes, 32, 1024, 'packed-le64', limits), /duplicate/)
  const failed = reader(bytes)
  assert.throws(() => failed.variant(32, 1024), /duplicate/)
  assert.throws(() => failed.variantFields(32, 1024), /closed/)
})

test('inline/reference/variant and all array kinds recursively retain order and shared identity', () => {
  for (const kind of [1, 2, 3, 4, 5, 7]) {
    const bytes = fixture(kind), root = reader(bytes).variantFields(32, 1024)
    const value = root.members[0].value
    const nested = Array.isArray(value) ? value[0] : value
    assert.deepEqual(pairs(nested), [['Repeated', 1.25], ['Repeated', 2.5]], `kind${kind}`)
    if (kind === 4) assert.equal(value[0], value[1])
    if ([3, 7].includes(kind)) assert.deepEqual(pairs(value[1]), [['Repeated', 3.5], ['Repeated', 4.5]])
    assert.throws(() => reader(bytes).variant(32, 1024), /duplicate/)
  }
})

test('valid keyed and ordered views have independent caches, and ordered output is deeply frozen', () => {
  const bytes = fixture(), view = new DataView(bytes.buffer)
  view.setBigUint64(80, 3000n, true)
  const session = reader(bytes), keyed = session.variant(32, 1024), fields = session.variantFields(32, 1024)
  assert.equal(keyed.Repeated, 1.25); assert.equal(keyed.Other, 2.5)
  assert.deepEqual(pairs(fields), [['Repeated', 1.25], ['Other', 2.5]])
  assert.equal(session.variant(32, 1024), keyed); assert.equal(session.variantFields(32, 1024), fields)
  for (const action of [() => { fields.kind = 'x' }, () => fields.members.push(null),
    () => { fields.members[0].name = 'x' }, () => { fields.members[0].value = 99 }])
    assert.throws(action, { name: 'TypeError' })
  const nested = reader(fixture(3)).variantFields(32, 1024).members[0].value
  assert.throws(() => { nested[0].members[0].value = 99 }, { name: 'TypeError' })
})

test('strict parsed element schemas reject duplicates for empty and all-null reference arrays', () => {
  for (const kind of [3, 4]) {
    const bytes = fixture(kind), view = new DataView(bytes.buffer)
    if (kind === 3) view.setUint32(1024, 0, true)
    else { view.setBigUint64(1400, 0n, true); view.setBigUint64(1408, 0n, true) }
    assert.throws(() => reader(bytes).variant(32, 1024), /duplicate/)
    const session = reader(bytes), value = session.variantFields(32, 1024).members[0].value
    assert.deepEqual(value, kind === 3 ? [] : [null, null])
    assert.throws(() => session.variant(32, 1024), /duplicate/)
    assert.throws(() => session.variantFields(32, 1024), /closed/)
  }
})

test('wrapper costs, cached reads and direct reads share cumulative node/materialized ceilings', () => {
  const bytes = fixture()
  assert.throws(() => createGrannyPackedReader(bytes, 'packed-le64', { ...limits, maxNodes: 6 }).variantFields(32, 1024), /node budget/)
  const repeated = createGrannyPackedReader(bytes, 'packed-le64', { ...limits, maxNodes: 10 })
  const first = repeated.variantFields(32, 1024)
  assert.equal(repeated.variantFields(32, 1024), first)
  assert.equal(repeated.pointer(0), null)
  assert.throws(() => repeated.pointer(0), /node budget/)
  const budget = createGrannyPackedReader(bytes, 'packed-le64', { ...limits, maxBytes: 4096 })
  budget.variantFields(32, 1024)
  assert.throws(() => { for (let i = 0; i < 1000; i++) budget.pointer(0) }, /materialized/)
})

test('unknown kinds, cycles, inline recursion, depth, cancellation and immutable inputs still refuse', () => {
  for (const kind of [6, 99]) {
    const bytes = fixture(); new DataView(bytes.buffer).setUint32(32, kind, true)
    assert.throws(() => reader(bytes).variantFields(32, 1024), /Unsupported/)
  }
  for (const kind of [1, 2]) {
    const bytes = fixture(kind), view = new DataView(bytes.buffer)
    view.setBigUint64(44, 32n, true); view.setBigUint64(1024, 1024n, true)
    assert.throws(() => reader(bytes).variantFields(32, 1024), /recursive inline|cyclic/)
  }
  const deep = fixture(1), view = new DataView(deep.buffer)
  view.setUint32(512, 1, true); view.setBigUint64(524, 1792n, true); view.setUint32(556, 0, true)
  view.setUint32(1792, 10, true); view.setBigUint64(1796, 2900n, true)
  assert.throws(() => createGrannyPackedReader(deep, 'packed-le64', { ...limits, maxDepth: 1 }).variantFields(32, 1024), /depth/)
  const controller = new AbortController(), session = createGrannyPackedReader(fixture(), 'packed-le64', limits, controller.signal)
  controller.abort(); assert.throws(() => session.variantFields(32, 1024), { name: 'AbortError' })
  const buffer = Buffer.from(fixture()), owned = reader(buffer)
  buffer.fill(0); assert.deepEqual(pairs(owned.variantFields(32, 1024)), [['Repeated', 1.25], ['Repeated', 2.5]])
})

test('transforms keep semantic components, flat Real32 arrays and null references keep old shapes', () => {
  const bytes = fixture(), view = new DataView(bytes.buffer)
  view.setUint32(32, 9, true); view.setUint32(76, 0, true); view.setUint32(1024, 7, true)
  for (let i = 0; i < 16; i++) view.setFloat32(1028 + i * 4, i + 0.25, true)
  const transform = reader(bytes).variantFields(32, 1024).members[0].value
  assert.equal(transform.flags, 7); assert.deepEqual(transform.position, [0.25, 1.25, 2.25])
  assert.equal(transform.orientation.length, 4); assert.equal(transform.scaleShear.length, 9)
  assert.throws(() => { transform.position[0] = 99 }, { name: 'TypeError' })
  const arrayBytes = fixture(3), a = new DataView(arrayBytes.buffer)
  a.setUint32(556, 0, true); a.setBigUint64(516, 3000n, true)
  arrayBytes.set(new TextEncoder().encode('Real32\0'), 3000)
  assert.deepEqual(reader(arrayBytes).variantFields(32, 1024).members[0].value, [1.25, 2.5])
  a.setUint32(1024, 0, true); a.setBigUint64(1028, 0n, true)
  const empty = reader(arrayBytes).variantFields(32, 1024).members[0].value
  assert.deepEqual(empty, []); assert.ok(Object.isFrozen(empty))
  const nullBytes = fixture(2); new DataView(nullBytes.buffer).setBigUint64(1024, 0n, true)
  assert.equal(reader(nullBytes).variantFields(32, 1024).members[0].value, null)
})
