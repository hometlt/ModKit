import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeCanonicalValue, decodeCanonicalValue } from './uv-value.mjs'

const hex = bytes => Buffer.from(bytes).toString('hex')
const types = [{ name: 'Filter', fields: [
  { name: 'player', type: 'ref<player>', optional: true },
  { name: 'alive', type: 'bool', optional: true },
] }, { name: 'Mask', fields: [
  { name: 'player', type: 'ref<player>', optional: true },
  { name: 'alive', type: 'bool', optional: true },
] }]

test('UVB 2 State value bytes pin scalar tags and exact signed integers', () => {
  const cases = [
    [{ type: 'bool', value: true }, '0004000000626f6f6c01'],
    [{ type: 'i64', value: '-2' }, '0103000000693634feffffffffffffff'],
    [{ type: 'fixed64', value: '6442450944' }, '0207000000666978656436340000008001000000'],
    [{ type: 'strref', value: 'A' }, '03060000007374727265660100000041'],
    [{ type: 'ref<entity>', value: '7' }, '040b0000007265663c656e746974793e0700000000000000'],
  ]
  for (const [value, expected] of cases) {
    const encoded = encodeCanonicalValue(value)
    assert.equal(hex(encoded), expected)
    assert.deepEqual(decodeCanonicalValue(encoded), value)
    assert.equal(hex(encodeCanonicalValue(decodeCanonicalValue(encoded))), expected)
  }
})

test('nominal identity, list order and optional presence survive canonical roundtrip', () => {
  const absent = encodeCanonicalValue({ type: 'Filter', value: {} }, types)
  const presentFalse = encodeCanonicalValue({ type: 'Filter', value: { alive: false } }, types)
  assert.equal(hex(absent), '060600000046696c7465720000')
  assert.equal(hex(presentFalse), '060600000046696c746572000100')
  assert.notEqual(hex(absent), hex(presentFalse))
  assert.deepEqual(decodeCanonicalValue(absent, types).value, {})
  assert.deepEqual(decodeCanonicalValue(presentFalse, types).value, { alive: false })
  assert.notEqual(hex(presentFalse), hex(encodeCanonicalValue({ type: 'Mask', value: { alive: false } }, types)))
  const first = encodeCanonicalValue({ type: 'Filter', value: { alive: true, player: '7' } }, types)
  const reordered = encodeCanonicalValue({ type: 'Filter', value: { player: '7', alive: true } }, types)
  assert.equal(hex(first), hex(reordered))
  const list = { type: 'list<Filter>', value: [{ player: '7' }, { alive: false }] }
  assert.equal(hex(encodeCanonicalValue(list, types)),
    '050c0000006c6973743c46696c7465723e0200000001070000000000000000000100')
  assert.deepEqual(decodeCanonicalValue(encodeCanonicalValue(list, types), types), list)
  assert.notEqual(hex(encodeCanonicalValue({ ...list, value: [...list.value].reverse() }, types)),
    hex(encodeCanonicalValue(list, types)))
})

test('nullable references distinguish absent from present and reject noncanonical identity bytes', () => {
  const absent = { type: 'ref<entity>?', value: null }
  const present = { type: 'ref<entity>?', value: '1' }
  for (const [value, bytes] of [
    [absent, '070c0000007265663c656e746974793e3f00'],
    [present, '070c0000007265663c656e746974793e3f010100000000000000'],
  ]) {
    assert.equal(hex(encodeCanonicalValue(value)), bytes)
    assert.deepEqual(decodeCanonicalValue(encodeCanonicalValue(value)), value)
  }
  for (const value of ['0', 0, undefined, {}, false, '01', '18446744073709551616'])
    assert.throws(() => encodeCanonicalValue({ type: 'ref<entity>?', value }))
  for (const bytes of [
    '070c0000007265663c656e746974793e3f02',
    '070c0000007265663c656e746974793e3f010000000000000000',
    '070c0000007265663c656e746974793e3f0101000000',
    '070c0000007265663c656e746974793e3f0000',
  ]) assert.throws(() => decodeCanonicalValue(Uint8Array.from(Buffer.from(bytes, 'hex'))))
})

test('invalid values and noncanonical bytes refuse before entering State', () => {
  for (const value of [
    { type: 'i64', value: '01' }, { type: 'i64', value: '9223372036854775808' },
    { type: 'ref<entity>', value: '0' }, { type: 'ref<entity>', value: '18446744073709551616' },
    { type: 'value', value: true }, { type: 'result<bool>', value: true },
    { type: 'list<value>', value: [] }, { type: 'strref', value: 'x'.repeat(1025) },
    { type: 'strref', value: '\ud800' },
    { type: 'Filter', value: { unknown: true } },
    { type: 'Filter', value: { player: '0' } },
  ]) assert.throws(() => encodeCanonicalValue(value, types))
  const accessor = {}
  Object.defineProperty(accessor, 'alive', { enumerable: true, get() { return true } })
  assert.throws(() => encodeCanonicalValue({ type: 'Filter', value: accessor }, types))
  assert.throws(() => encodeCanonicalValue({ type: 'list<i64>', value: [,'1'] }))
  assert.throws(() => encodeCanonicalValue({ type: 'bool', value: true },
    [{ name: 'Broken', fields: [{ name: 'field', type: 'value' }] }]))
  assert.throws(() => encodeCanonicalValue({ type: 'bool', value: true },
    [{ name: 'Empty', fields: [] }]))
  assert.throws(() => encodeCanonicalValue({ type: `${'list<'.repeat(17)}bool${'>'.repeat(17)}`, value: [] }))
  const invalid = [
    Uint8Array.of(0, 4, 0, 0, 0, 98, 111, 111, 108, 2),
    Uint8Array.of(1, 4, 0, 0, 0, 98, 111, 111, 108, 1),
    Uint8Array.of(...encodeCanonicalValue({ type: 'bool', value: true }), 0),
    Uint8Array.of(3, 6, 0, 0, 0, 115, 116, 114, 114, 101, 102, 1, 0, 0, 0, 255),
  ]
  const optional = encodeCanonicalValue({ type: 'Filter', value: {} }, types)
  optional[optional.length - 1] = 2
  invalid.push(optional)
  for (const bytes of invalid) assert.throws(() => decodeCanonicalValue(bytes, types))
})
