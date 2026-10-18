import assert from 'node:assert/strict'
import test from 'node:test'
import { crc16Genibus } from '../dist/checksum/index.js'

test('CRC-16/GENIBUS standard check vector and empty input', () => {
  assert.equal(crc16Genibus(new Uint8Array()), 0)
  assert.equal(crc16Genibus(new TextEncoder().encode('123456789')), 0xd64e)
})

test('CRC-16/GENIBUS respects sliced Buffer ranges and leaves input owned by caller', () => {
  const bytes = Buffer.from('prefix123456789suffix')
  const before = Buffer.from(bytes)
  assert.equal(crc16Genibus(bytes.subarray(6, 15)), 0xd64e)
  assert.deepEqual(bytes, before)
})
