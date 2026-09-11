import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createUvmConversionCache } from '../src/uvm/conversion-cache.js'

it('owns both retained input and returned bytes and evicts distinct conversion options', () => {
  const cache = createUvmConversionCache(4)
  const input = Buffer.from([1, 2, 3])
  cache.set('scale:1', input)
  input.fill(0)
  const first = cache.get('scale:1')
  assert.deepEqual(first, Uint8Array.of(1, 2, 3))
  first.fill(4)
  assert.deepEqual(cache.get('scale:1'), Uint8Array.of(1, 2, 3))
  cache.set('scale:2', Uint8Array.of(2))
  assert.equal(cache.get('scale:1'), undefined)
  assert.deepEqual(cache.get('scale:2'), Uint8Array.of(2))
  cache.clear()
  assert.equal(cache.get('scale:2'), undefined)
})

it('bounds retained bytes and never serves or publishes an aborted result', () => {
  for (const limit of [-1, 1.5, NaN, Infinity])
    assert.throws(() => createUvmConversionCache(limit), /byte limit/)
  const cache = createUvmConversionCache(2)
  cache.set('small', Uint8Array.of(1, 2))
  const controller = new AbortController()
  controller.abort(new Error('cancelled conversion'))
  assert.throws(() => cache.get('small', controller.signal), /cancelled conversion/)
  assert.throws(
    () => cache.set('other', Uint8Array.of(9), controller.signal),
    /cancelled conversion/,
  )
  assert.deepEqual(cache.get('small'), Uint8Array.of(1, 2))
  cache.set('large', Uint8Array.of(1, 2, 3))
  assert.equal(cache.get('large'), undefined)
  assert.equal(cache.get('small'), undefined)
})
