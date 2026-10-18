import assert from 'node:assert/strict'
import test from 'node:test'
import { createGrannyPackedReader } from '../dist/model/granny.js'

/** One explicit native Float32 member and a separate pointer exercise the existing counters. */
function reader(signal) {
  const bytes = new Uint8Array(256), view = new DataView(bytes.buffer)
  view.setBigUint64(0, 128n, true)
  view.setUint32(32, 10, true)
  view.setBigUint64(36, 128n, true)
  bytes.set(new TextEncoder().encode('Value\0'), 128)
  view.setFloat32(160, 1.25, true)
  return createGrannyPackedReader(bytes, 'packed-le64', { maxBytes: 4096, maxNodes: 100, maxDepth: 16 }, signal)
}

test('packed usage snapshots expose cumulative primitive/ordered graph charges without spending them', () => {
  const session = reader(), initial = session.usage()
  assert.deepEqual(initial, { bytes: 0, nodes: 0 })
  assert.ok(Object.isFrozen(initial))
  session.pointer(0)
  const pointer = session.usage()
  assert.deepEqual(pointer, { bytes: 8, nodes: 1 })
  assert.deepEqual(session.usage(), pointer)
  assert.deepEqual(initial, { bytes: 0, nodes: 0 })
  assert.throws(() => { pointer.bytes = 0 }, TypeError)
  assert.deepEqual(session.floats(160, 1), [1.25])
  const primitive = session.usage()
  assert.ok(primitive.bytes > pointer.bytes && primitive.nodes > pointer.nodes)
  const value = session.variantFields(32, 160), graph = session.usage()
  assert.ok(graph.bytes > primitive.bytes && graph.nodes > primitive.nodes)
  assert.equal(session.variantFields(32, 160), value)
  const cached = session.usage()
  assert.equal(cached.bytes, graph.bytes)
  assert.equal(cached.nodes, graph.nodes + 1)
  assert.deepEqual(session.usage(), cached)
})

test('packed usage preserves poisoned and aborted session refusal', () => {
  const failed = reader()
  assert.throws(() => failed.pointer(1024), RangeError)
  assert.throws(() => failed.usage(), /closed/)
  const controller = new AbortController(), cancelled = reader(controller.signal)
  controller.abort()
  assert.throws(() => cancelled.usage(), /abort/i)
})
