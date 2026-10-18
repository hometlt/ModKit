/** One native text ceiling covers direct names, schema labels and nested artist strings. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGrannyPackedReader } from '../dist/model/granny.js'
const limits = { maxBytes: 4096, maxNodes: 100, maxDepth: 16 }
/** Hand-authored packed string member; multibyte text makes byte/character confusion observable. */
function fixture() {
  const bytes = new Uint8Array(4096), view = new DataView(bytes.buffer)
  const ptr = (at, value) => view.setBigUint64(at, BigInt(value), true)
  const text = (at, value) => bytes.set(new TextEncoder().encode(value + '\0'), at)
  ptr(0, 512); text(512, '\u00e9')
  view.setUint32(32, 8, true); ptr(36, 600); text(600, 'Artist')
  ptr(1024, 700); text(700, '\u503c')
  return bytes
}
const reader = (bytes, maxTextBytes) => createGrannyPackedReader(bytes, 'packed-le64', { ...limits, maxTextBytes })
test('direct names, schema labels and values share UTF-8 bytes; cached views retain identity', () => {
  const bytes = fixture(), session = reader(bytes, 11)
  assert.equal(session.string(0), '\u00e9')
  const fields = session.variantFields(32, 1024)
  assert.equal(fields.members[0].value, '\u503c')
  assert.equal(session.variantFields(32, 1024), fields)
  assert.equal(session.string(8), null)
  assert.throws(() => session.string(0), /text budget/)
  assert.throws(() => session.variantFields(32, 1024), /closed/)
  const short = reader(bytes, 10)
  assert.equal(short.string(0), '\u00e9')
  assert.throws(() => short.variant(32, 1024), /text budget/)
  assert.throws(() => short.pointer(0), /closed/)
})
test('snapshot, repeated decodes, empty/null strings and invalid limits stay explicit', () => {
  const bytes = fixture(), budget = { ...limits, maxTextBytes: 2 }
  const session = createGrannyPackedReader(bytes, 'packed-le64', budget)
  budget.maxTextBytes = 1000
  assert.equal(session.string(0), '\u00e9')
  assert.throws(() => session.string(0), /text budget/)
  new DataView(bytes.buffer).setBigUint64(0, 1000n, true)
  const empty = reader(bytes, 0)
  assert.equal(empty.string(0), ''); assert.equal(empty.string(8), null)
  for (const max of [-1, NaN, Infinity, 0.5, 4097]) assert.throws(() => reader(bytes, max))
  assert.equal(reader(fixture(), undefined).variant(32, 1024).Artist, '\u503c')
})
