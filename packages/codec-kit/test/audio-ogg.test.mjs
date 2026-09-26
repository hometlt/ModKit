import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeOgg } from '../dist/audio/index.js'
import { createCrc32Msb } from '../dist/checksum/index.js'

const digest = (bytes, options) => {
  const crc = createCrc32Msb(options)
  for (const byte of bytes) crc.update(byte)
  return crc.digest()
}

test('createCrc32Msb gives the BZip2 CRC by default and the Ogg CRC with init and xorOut 0', () => {
  const check = new TextEncoder().encode('123456789')
  assert.equal(digest(check), 0xfc891918)
  // CRC-32/POSIX without its final XOR: 0x765E7680 ^ 0xFFFFFFFF.
  assert.equal(digest(check, { init: 0, xorOut: 0 }), 0x89a1897f)
})

/** Pages as RFC 3533 lays them out, each CRC checked. */
function pages(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = []
  for (let at = 0; at < bytes.byteLength;) {
    assert.equal(String.fromCharCode(...bytes.subarray(at, at + 4)), 'OggS')
    const segments = bytes[at + 26]
    const lacing = [...bytes.subarray(at + 27, at + 27 + segments)]
    const size = 27 + segments + lacing.reduce((sum, value) => sum + value, 0)
    const page = bytes.slice(at, at + size)
    const stored = view.getUint32(at + 22, true)
    page.fill(0, 22, 26)
    assert.equal(digest(page, { init: 0, xorOut: 0 }), stored)
    out.push({
      flags: bytes[at + 5],
      granule: view.getBigInt64(at + 6, true),
      serial: view.getUint32(at + 14, true),
      sequence: view.getUint32(at + 18, true),
      lacing,
    })
    at += size
  }
  return out
}

test('encodeOgg lays packets into pages with lacing, flags, granules and CRCs', () => {
  const ogg = encodeOgg(
    [
      { bytes: new Uint8Array(30).fill(1), granule: 0n, flush: true },
      { bytes: new Uint8Array(255).fill(2), granule: 0n },
      { bytes: new Uint8Array(10).fill(3), granule: 1024n },
    ],
    7,
  )
  assert.deepEqual(pages(ogg), [
    { flags: 2, granule: 0n, serial: 7, sequence: 0, lacing: [30] },
    // A 255-byte packet ends with a 0 segment; the page takes the last packet's granule.
    { flags: 4, granule: 1024n, serial: 7, sequence: 1, lacing: [255, 0, 10] },
  ])
})

test('encodeOgg continues a packet past 255 segments with no granule on the open page', () => {
  const big = new Uint8Array(255 * 255 + 100).map((_, index) => index & 0xff)
  const ogg = encodeOgg([{ bytes: big, granule: 5n }], 1)
  const [first, second] = pages(ogg)
  assert.deepEqual([first.flags, first.granule, first.lacing.length], [2, -1n, 255])
  assert.deepEqual([second.flags, second.granule, second.lacing], [1 | 4, 5n, [100]])
  // The body is the packet, unchanged.
  const body = [...ogg.subarray(27 + 255, 27 + 255 + 255 * 255), ...ogg.subarray(-100)]
  assert.deepEqual(body, [...big])
})

test('encodeOgg refuses an empty stream and a bad serial', () => {
  assert.throws(() => encodeOgg([], 1), /at least one packet/u)
  assert.throws(() => encodeOgg([{ bytes: new Uint8Array(1), granule: 0n }], -1), /serial/u)
})
