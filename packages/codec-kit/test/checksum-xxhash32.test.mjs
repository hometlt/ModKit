import test from 'node:test'
import assert from 'node:assert/strict'
import { xxHash32 } from '../dist/checksum/index.js'

const text = value => new TextEncoder().encode(value)

test('xxHash32 is XXH32: the reference vectors, both paths (under and from 16 bytes) and a seed', () => {
  assert.equal(xxHash32(new Uint8Array(0)), 0x02cc5d05)
  assert.equal(xxHash32(new Uint8Array(0), 0x9e3779b1), 0x36b78ae7)
  assert.equal(xxHash32(text('a')), 0x550d7456)
  assert.equal(xxHash32(text('abc')), 0x32d153ff)
  assert.equal(xxHash32(text('Nobody inspects the spammish repetition')), 0xe2293b2f)
})

test('xxHash32 reads a view over part of a buffer in place', () => {
  const buffer = text('--Nobody inspects the spammish repetition')
  assert.equal(xxHash32(buffer.subarray(2)), 0xe2293b2f)
})
