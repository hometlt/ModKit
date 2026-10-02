import test from 'node:test'
import assert from 'node:assert/strict'
import { isJsonSerializable } from '../dist/legacy/assets/index.js'

test('the MK2 assets JSON guard accepts data and rejects runtime state', () => {
  assert.equal(isJsonSerializable({ value: 1, optional: undefined, nested: [true, null] }), true)
  assert.equal(isJsonSerializable([undefined]), false)
  assert.equal(isJsonSerializable(new Uint8Array([1])), false)

  const cyclic = {}
  cyclic.self = cyclic
  assert.equal(isJsonSerializable(cyclic), false)
})
